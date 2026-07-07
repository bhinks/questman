/**
 * Daily quest theming through the LLM gateway (services/llm.ts).
 *
 * Design constraints (see plan.md):
 *   - The SERVER owns the XP economy. The model only SELECTS from
 *     provided candidates and THEMES them (cyberpunk title +
 *     description + emoji). It never invents XP values.
 *   - Every AI-referenced sourceId is validated against the candidate
 *     set before persisting; unknown refs are dropped.
 *   - On ANY gateway failure/gate (AI disabled, no key, token cap, API
 *     error, Zod validation), callers must fall back to a deterministic
 *     rule-based path. We never block the user on the model.
 *   - AI Calibration: callers pass only the candidates the user's
 *     data-access grants allow (QuestEngine partitions them); the
 *     master switch / quest toggle / provider / cap live in llm.ts.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
// Note: we don't use `zodOutputFormat` from @anthropic-ai/sdk/helpers/zod
// because that helper requires Zod v4 (it reads `schema.def`), and this
// backend is on Zod v3 (used by every existing route's request schema).
// We pass a hand-rolled JSON schema to the API for response shaping and
// still validate the response ourselves with Zod v3.
import { logger } from '../utils/logger';
import { AiSettings, completeJson, modelFor } from './llm';

/** Candidate quest as passed TO the model. */
export interface QuestCandidate {
  /** Stable id Claude must echo back. We synthesize this per-batch. */
  candidateId: string;
  source: 'habit' | 'goal' | 'workout' | 'finance' | 'project' | 'media' | 'npc' | 'vitals' | 'bill' | 'steam';
  sourceId: string | null;
  moduleKey: string;        // "habits"|"fitness"|"chores"|"finance"|"projects"|"media"|"social"|"vitals"
  baseTitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Server-assigned. Surfaced to the model only as context; the model
   *  cannot change it (see schema — there's no xpReward field). */
  xpReward: number;
  /** Optional context to help the model write a flavorful description. */
  context?: string;
  /** Best weather window for outdoor habits, e.g. "1–3pm". Themable. */
  bestWindow?: string;
  /** Outdoor candidate on a genuinely nice day (dry, mild, calm) — the
   *  selection should strongly prefer it so the day isn't wasted. */
  niceDay?: boolean;
  // --- Planner attributes (roadmap §5), persisted onto the Quest ---
  /** Estimated minutes to complete; feeds the day-planner time budget. */
  estMinutes?: number;
  /** Check-in counter target (e.g. 8 glasses of water). Default 1 = one-shot. */
  targetCount?: number;
  /** Priority tier — must-do quests rank first and always carry over. */
  mustDo?: boolean;
  /** Whether an incomplete quest rolls to tomorrow instead of expiring. */
  carryOver?: boolean;
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

const SYSTEM = `You are the quest curator for a cyberpunk life-tracker called Daymon.
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
 * Generate themed quests via the user's configured model. Returns null on
 * any failure or gate (AI off, missing key, cap, API error, validation).
 * Caller must fall back.
 */
export async function generateThemedQuests(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  settings: AiSettings,
  candidates: QuestCandidate[],
  ctx: { level: number; currentStreak: number; date: Date },
): Promise<ThemedBatch | null> {
  if (!settings.aiEnabled || !settings.aiQuestsEnabled) return null;
  if (candidates.length === 0) return null;

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
      const niceLine = c.niceDay ? '\n     ☀ NICE DAY: outdoor conditions are ideal today — strongly prefer this candidate' : '';
      return `${i + 1}. ${c.baseTitle}\n     ${meta}${ctxLine}${windowLine}${niceLine}`;
    }),
    '',
    ...(candidates.some(c => c.niceDay)
      ? ['It is a genuinely nice day out (dry, mild, calm). Include at least one ☀ NICE DAY outdoor candidate in your selection — a good day must not go to waste.', '']
      : []),
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
    const text = await completeJson({
      db, userId, settings, tier: 'quests',
      system: SYSTEM,
      prompt,
      jsonSchema: jsonSchema as unknown as Record<string, unknown>,
      maxTokens: 1500,
    });
    if (!text) return null;

    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
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

    logger.info(`[anthropic] themed ${cleaned.quests.length} quests via ${settings.aiProvider}/${modelFor(settings, 'quests')}`);
    return cleaned;
  } catch (err: any) {
    logger.warn(`[anthropic] generation failed, will fall back: ${err?.message ?? err}`);
    return null;
  }
}
