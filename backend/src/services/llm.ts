/**
 * llm.ts — the single LLM gateway, and the AI Calibration enforcement point.
 *
 * EVERY model call in the app goes through completeJson(). That is what makes
 * the SYS//CAL panel's promises real:
 *   - aiEnabled (master breaker): off = this file never talks to any model.
 *   - Provider choice: Anthropic cloud or a local Ollama node. Both are asked
 *     for schema-shaped JSON; callers keep their own Zod validation + fallback,
 *     so a weak local model degrades exactly like a Claude outage does.
 *   - Daily token cap: a per-user, per-local-day budget (input+output tokens,
 *     both providers report usage). At/over the cap, calls return null and
 *     callers fall back to their deterministic paths.
 *
 * Per-feature toggles (quests/handler) and per-domain data-access grants are
 * enforced by the CALLERS (QuestEngine/handler.ts), because only they know
 * which candidates/digest lines belong to which domain — but they all read
 * the same AiSettings fetched here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/dates';

type Db = PrismaClient | Prisma.TransactionClient;

export type AiProvider = 'anthropic' | 'ollama';
/** Which model slot a call bills against (mirrors config.anthropic.*). */
export type AiTier = 'quests' | 'handler';

export interface AiSettings {
  aiEnabled: boolean;
  aiQuestsEnabled: boolean;
  handlerEnabled: boolean;
  handlerPersona: string;
  aiAccessFinance: boolean;
  aiAccessHealth: boolean;
  aiAccessSocial: boolean;
  aiAccessCalendar: boolean;
  aiProvider: AiProvider;
  aiModelQuests: string | null;
  aiModelHandler: string | null;
  ollamaUrl: string;
  ollamaModel: string;
  aiDailyTokenCap: number;
  aiTokensUsed: number;
  aiTokensUsedOn: Date | null;
}

/**
 * Mirrors the schema defaults — used when a user has no settings row yet.
 * Brent's call (2026-06-10): AI is fully OPT-IN. Master breaker, both
 * subsystems, and every data grant start OFF/SEALED — a fresh install makes
 * zero LLM calls and shares zero data until the user enables each layer.
 */
export const AI_DEFAULTS: AiSettings = {
  aiEnabled: false,
  aiQuestsEnabled: false,
  handlerEnabled: false,
  handlerPersona: 'rogue_ai',
  aiAccessFinance: false,
  aiAccessHealth: false,
  aiAccessSocial: false,
  aiAccessCalendar: false,
  aiProvider: 'anthropic',
  aiModelQuests: null,
  aiModelHandler: null,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  aiDailyTokenCap: 100_000,
  aiTokensUsed: 0,
  aiTokensUsedOn: null,
};

export const AI_SETTINGS_SELECT = {
  aiEnabled: true,
  aiQuestsEnabled: true,
  handlerEnabled: true,
  handlerPersona: true,
  aiAccessFinance: true,
  aiAccessHealth: true,
  aiAccessSocial: true,
  aiAccessCalendar: true,
  aiProvider: true,
  aiModelQuests: true,
  aiModelHandler: true,
  ollamaUrl: true,
  ollamaModel: true,
  aiDailyTokenCap: true,
  aiTokensUsed: true,
  aiTokensUsedOn: true,
} as const;

export async function getAiSettings(db: Db, userId: string): Promise<AiSettings> {
  const row = await db.userSettings.findUnique({
    where: { userId },
    select: AI_SETTINGS_SELECT,
  });
  if (!row) return { ...AI_DEFAULTS };
  return { ...row, aiProvider: row.aiProvider === 'ollama' ? 'ollama' : 'anthropic' };
}

/** Can the chosen provider serve a call at all? (Ollama needs no key.) */
export function providerAvailable(s: AiSettings): boolean {
  return s.aiProvider === 'ollama' ? true : !!config.anthropic.apiKey;
}

/** Master gate: AI switched on AND the provider is usable. */
export function aiAvailable(s: AiSettings): boolean {
  return s.aiEnabled && providerAvailable(s);
}

/** Tokens already burned today (the counter resets when the day rolls). */
export function tokensUsedToday(
  s: Pick<AiSettings, 'aiTokensUsed' | 'aiTokensUsedOn'>,
  today: Date = startOfLocalDay(),
): number {
  if (!s.aiTokensUsedOn) return 0;
  return startOfLocalDay(new Date(s.aiTokensUsedOn)).getTime() === today.getTime()
    ? s.aiTokensUsed
    : 0;
}

/** The model a call will actually use, honoring per-tier cloud overrides. */
export function modelFor(s: AiSettings, tier: AiTier): string {
  if (s.aiProvider === 'ollama') return s.ollamaModel;
  const override = tier === 'quests' ? s.aiModelQuests : s.aiModelHandler;
  return override ?? (tier === 'quests' ? config.anthropic.model : config.anthropic.handlerModel);
}

/**
 * Best-effort usage accounting. Day-boundary races can at worst miscount one
 * call — acceptable for a soft cap on a flavor feature; never throws.
 */
async function recordUsage(db: Db, userId: string, tokens: number, today: Date): Promise<void> {
  try {
    const row = await db.userSettings.findUnique({
      where: { userId },
      select: { aiTokensUsedOn: true },
    });
    const sameDay = row?.aiTokensUsedOn &&
      startOfLocalDay(new Date(row.aiTokensUsedOn)).getTime() === today.getTime();
    await db.userSettings.upsert({
      where: { userId },
      update: sameDay
        ? { aiTokensUsed: { increment: tokens } }
        : { aiTokensUsed: tokens, aiTokensUsedOn: today },
      create: { userId, aiTokensUsed: tokens, aiTokensUsedOn: today },
    });
  } catch (err: any) {
    logger.warn(`[llm] usage accounting failed: ${err?.message ?? err}`);
  }
}

export interface CompleteJsonOpts {
  db: Db;
  userId: string;
  settings: AiSettings;
  tier: AiTier;
  system: string;
  prompt: string;
  /** JSON schema the response must conform to (both providers support it). */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

/**
 * One JSON-shaped completion through the user's chosen provider. Returns the
 * raw JSON text, or null on ANY failure or gate (master switch off, no key,
 * cap reached, provider error) — callers always keep a deterministic fallback.
 */
export async function completeJson(opts: CompleteJsonOpts): Promise<string | null> {
  const { db, userId, settings: s, tier, system, prompt, jsonSchema, maxTokens } = opts;
  if (!aiAvailable(s)) return null;

  const today = startOfLocalDay();
  const used = tokensUsedToday(s, today);
  if (s.aiDailyTokenCap > 0 && used >= s.aiDailyTokenCap) {
    logger.info(`[llm] daily token cap reached (${used}/${s.aiDailyTokenCap}) — skipping ${tier} call`);
    return null;
  }

  const model = modelFor(s, tier);
  try {
    let text: string | null;
    let tokens = 0;

    if (s.aiProvider === 'ollama') {
      const res = await fetch(`${s.ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          // Ollama structured outputs: constrain generation to the schema.
          format: jsonSchema,
          options: { num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        logger.warn(`[llm] ollama responded ${res.status} (${s.ollamaUrl}, model ${model})`);
        return null;
      }
      const body: any = await res.json();
      text = typeof body?.message?.content === 'string' ? body.message.content : null;
      tokens = (body?.prompt_eval_count ?? 0) + (body?.eval_count ?? 0);
    } else {
      const client = new Anthropic({ apiKey: config.anthropic.apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: jsonSchema } } as any,
      });
      const block = response.content.find((b: any) => b.type === 'text');
      text = block && block.type === 'text' ? block.text : null;
      tokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    }

    if (tokens > 0) await recordUsage(db, userId, tokens, today);
    if (text) logger.info(`[llm] ${tier} call ok via ${s.aiProvider}/${model} (${tokens} tokens)`);
    return text;
  } catch (err: any) {
    logger.warn(`[llm] ${s.aiProvider} ${tier} call failed: ${err?.message ?? err}`);
    return null;
  }
}
