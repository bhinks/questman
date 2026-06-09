/**
 * Thin wrapper around @anthropic-ai/sdk for daily quest theming.
 *
 * Design constraints (see plan.md):
 *   - The SERVER owns the XP economy. Claude only SELECTS from
 *     provided candidates and THEMES them (cyberpunk title +
 *     description + emoji). It never invents XP values.
 *   - Every AI-referenced sourceId is validated against the candidate
 *     set before persisting; unknown refs are dropped.
 *   - If the API key is absent, the API errors, or the response fails
 *     Zod validation, callers must fall back to a deterministic
 *     rule-based path. We never block the user on Claude.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
// Note: we don't use `zodOutputFormat` from @anthropic-ai/sdk/helpers/zod
// because that helper requires Zod v4 (it reads `schema.def`), and this
// backend is on Zod v3 (used by every existing route's request schema).
// We pass a hand-rolled JSON schema to the API for response shaping and
// still validate the response ourselves with Zod v3.
import { config } from '../config';
import { logger } from '../utils/logger';

/** Candidate quest as passed TO the model. */
export interface QuestCandidate {
  /** Stable id Claude must echo back. We synthesize this per-batch. */
  candidateId: string;
  source: 'habit' | 'goal' | 'workout' | 'finance';
  sourceId: string | null;
  moduleKey: string;        // "habits" | "fitness" | "chores" | "finance"
  baseTitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Server-assigned. Surfaced to the model only as context; the model
   *  cannot change it (see schema — there's no xpReward field). */
  xpReward: number;
  /** Optional context to help the model write a flavorful description. */
  context?: string;
  /** Best weather window for outdoor habits, e.g. "1–3pm". Themable. */
  bestWindow?: string;
}

/**
 * Shape Claude returns. xpReward is intentionally absent so the model
 * can't shift the economy. Lengths are validated loosely (model
 * occasionally goes long); we truncate post-validation rather than
 * dropping a whole batch.
 */
export const themedQuestSchema = z.object({
  candidateId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  emoji: z.string(),
});

export const themedBatchSchema = z.object({
  quests: z.array(themedQuestSchema).min(1),
  flavor: z.string().optional(),
});

export type ThemedQuest = z.infer<typeof themedQuestSchema>;
export type ThemedBatch = z.infer<typeof themedBatchSchema>;

const SYSTEM = `You are the quest curator for a cyberpunk life-tracker called Questman.
You receive a list of CANDIDATE quests the user could attempt today (real things
from their habits, chores, workouts, and finances) and select 3–5 of them as
their daily missions. For each selected mission, write:

  - A short cyberpunk-themed title (e.g. "Ghost Protocol", "Operation Fast Food",
    "Iron Tempo", "Caffeine Embargo"). 60 chars max.
  - A single-line description in the second person, present tense, that motivates
    without being preachy. Reference the underlying activity concretely. 200 chars max.
  - One emoji that fits the theme.

Hard rules:
  1. Echo each selected quest's candidateId VERBATIM. Do not invent ids.
  2. Pick a balanced set: prefer 1 from each available module, then add
     streak-at-risk habits, then variety.
  3. Never mention XP, points, or rewards in titles or descriptions.
  4. No moralizing about money, weight, or habits. Frame as missions.
  5. The whole batch should feel like a coherent terminal of "today's ops".`;

/**
 * Generate themed quests via Claude. Returns null on any failure
 * (missing key, API error, validation error). Caller must fall back.
 */
export async function generateThemedQuests(
  candidates: QuestCandidate[],
  ctx: { level: number; currentStreak: number; date: Date },
): Promise<ThemedBatch | null> {
  if (!config.anthropic.apiKey) {
    logger.info('[anthropic] no API key — skipping AI theming');
    return null;
  }
  if (candidates.length === 0) return null;

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const prompt = [
    `Date: ${ctx.date.toISOString().slice(0, 10)}`,
    `Player level: ${ctx.level}    Current streak: ${ctx.currentStreak} day(s)`,
    '',
    'CANDIDATES:',
    ...candidates.map((c, i) => {
      const meta = [
        `id=${c.candidateId}`,
        `module=${c.moduleKey}`,
        `source=${c.source}`,
        `difficulty=${c.difficulty}`,
      ].join(' ');
      const ctxLine = c.context ? `\n     context: ${c.context}` : '';
      const windowLine = c.bestWindow ? `\n     best outdoor window: ${c.bestWindow} (weave this timing into the description)` : '';
      return `${i + 1}. ${c.baseTitle}\n     ${meta}${ctxLine}${windowLine}`;
    }),
    '',
    'Select 3–5 of these and theme them. Echo each candidateId verbatim.',
  ].join('\n');

  // Hand-rolled JSON schema for the API. Structured-output schemas do
  // not support minItems/maxItems/minLength/maxLength — we encode those
  // constraints in the prompt and re-check them via Zod below.
  const jsonSchema = {
    type: 'object',
    properties: {
      quests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            candidateId: { type: 'string', description: 'The candidateId from the input list, echoed verbatim.' },
            title:       { type: 'string', description: 'Cyberpunk-themed mission name (e.g. "Ghost Protocol"). Max 60 chars.' },
            description: { type: 'string', description: 'One-line description, second person, present tense. Max 200 chars.' },
            emoji:       { type: 'string', description: 'A single emoji or short symbol.' },
          },
          required: ['candidateId', 'title', 'description', 'emoji'],
          additionalProperties: false,
        },
      },
      flavor: { type: 'string', description: 'Optional one-line theme for the day. Max 120 chars.' },
    },
    required: ['quests'],
    additionalProperties: false,
  } as const;

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: jsonSchema } } as any,
    });

    // First text block is guaranteed to be valid JSON by output_config.
    const textBlock = response.content.find((b: any) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn('[anthropic] response had no text block');
      return null;
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(textBlock.text);
    } catch (e) {
      logger.warn('[anthropic] response was not valid JSON');
      return null;
    }
    const validated = themedBatchSchema.safeParse(candidate);
    if (!validated.success) {
      logger.warn(`[anthropic] response failed Zod validation: ${validated.error.message}`);
      return null;
    }
    // Soft length caps applied post-hoc (the API can't enforce them
    // via JSON schema). Truncate rather than drop.
    const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const parsed: ThemedBatch = {
      ...validated.data,
      flavor: validated.data.flavor ? trim(validated.data.flavor, 120) : undefined,
      quests: validated.data.quests.map(q => ({
        ...q,
        title: trim(q.title, 60),
        description: trim(q.description, 200),
        emoji: trim(q.emoji, 8),
      })),
    };

    // Sanitize: drop any quest whose candidateId is not in our set.
    const validIds = new Set(candidates.map(c => c.candidateId));
    const cleaned: ThemedBatch = {
      ...parsed,
      quests: parsed.quests.filter(q => validIds.has(q.candidateId)),
    };
    if (cleaned.quests.length === 0) {
      logger.warn('[anthropic] all themed quests dropped during sanitize');
      return null;
    }

    logger.info(`[anthropic] themed ${cleaned.quests.length} quests via ${config.anthropic.model}`);
    return cleaned;
  } catch (err: any) {
    logger.warn(`[anthropic] generation failed, will fall back: ${err?.message ?? err}`);
    return null;
  }
}
