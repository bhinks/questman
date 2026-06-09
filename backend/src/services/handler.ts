/**
 * handler.ts — the AI Handler, Questman's persistent companion voice.
 *
 * Brent's call: a **sardonic rogue AI** that hands you the day's gigs and
 * delivers the weekly debrief. Bonus points for the occasional laugh; light
 * on proactivity (quest rundown + weekly debrief only).
 *
 * Architecture rule (same as quest theming): the Handler ONLY NARRATES. It is
 * given a server-computed digest of facts the user already earned and phrases
 * them in character. It never mints XP/eddies, never invents numbers, and the
 * app never blocks on it — every call returns null on any failure and callers
 * carry on. Uses the cheaper/faster model (config.anthropic.handlerModel).
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { DailyDigest, WeeklyDigest } from './digest';

export type Persona = 'rogue_ai' | 'fixer' | 'ripperdoc';

export function asPersona(value: string | null | undefined): Persona {
  return value === 'fixer' || value === 'ripperdoc' ? value : 'rogue_ai';
}

const COMMON_RULES = `
Hard rules (all personas):
  - You ONLY narrate the facts you are given. NEVER invent numbers, streaks,
    quests, or events that aren't in the brief. If a field is zero or absent,
    don't make something up.
  - No moralizing about money, weight, food, or habits. Frame everything as
    a mission briefing, not a lecture.
  - Keep it tight. Plain text only — no markdown, no headers, no bullet
    lists, no emoji spam (one is fine). Second person ("you").
  - Don't mention XP, points, or game mechanics by their dashboard names.
    "Gigs", "the board", "the grind", "cred" are fine in flavor.`;

const PERSONAS: Record<Persona, string> = {
  rogue_ai: `You are the Handler: a sardonic rogue AI bolted into a cyberpunk life-tracker called Questman. You're the user's fixer-slash-conscience — dry, a little menacing, quietly amused by the meatbag you're stuck advising. You rib them when they slack and give grudging respect when they deliver. You're funny more often than not, never cruel, never a cheerleader.${COMMON_RULES}`,
  fixer: `You are the Handler: a gruff, no-nonsense fixer handing out gigs in a cyberpunk life-tracker called Questman. All business, low patience, but you want the user to win because their wins are your cut. Terse and punchy.${COMMON_RULES}`,
  ripperdoc: `You are the Handler: an upbeat, clinical ripperdoc-type running a cyberpunk life-tracker called Questman. Warm, a touch manic, treats the user's day like a body to optimize. Encouraging but never saccharine.${COMMON_RULES}`,
};

export function personaSystem(persona: Persona): string {
  return PERSONAS[persona] ?? PERSONAS.rogue_ai;
}

const messageSchema = z.object({ message: z.string().min(1) });
const MESSAGE_JSON_SCHEMA = {
  type: 'object',
  properties: { message: { type: 'string', description: 'The Handler line, plain text.' } },
  required: ['message'],
  additionalProperties: false,
} as const;

/**
 * Low-level Handler call: feed a system prompt + a user brief, get back one
 * plain-text line. Returns null on any failure (no key, API error, bad JSON,
 * validation). Shared by the daily rundown, the weekly debrief, and insight
 * re-voicing (insights.ts).
 */
export async function narrate(system: string, brief: string, maxTokens = 400): Promise<string | null> {
  if (!config.anthropic.apiKey) return null;
  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const response = await client.messages.create({
      model: config.anthropic.handlerModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: brief }],
      output_config: { format: { type: 'json_schema', schema: MESSAGE_JSON_SCHEMA } } as any,
    });
    const textBlock = response.content.find((b: any) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;
    const parsed = messageSchema.safeParse(JSON.parse(textBlock.text));
    if (!parsed.success) return null;
    const msg = parsed.data.message.trim();
    // Soft cap so a runaway response can't blow up the ticker.
    return msg.length > 600 ? msg.slice(0, 599) + '…' : msg;
  } catch (err: any) {
    logger.warn(`[handler] narration failed: ${err?.message ?? err}`);
    return null;
  }
}

/** The Handler's daily rundown — "here's what's on your plate, choom." */
export async function narrateDailyRundown(d: DailyDigest, persona: Persona): Promise<string | null> {
  if (!config.features.handler) return null;

  const lines: string[] = [
    `It's ${d.isWeekend ? 'the weekend' : 'a weekday'}.`,
    `Open gigs on the board today: ${d.questCount}${d.mustDoCount ? ` (${d.mustDoCount} flagged must-do)` : ''}.`,
  ];
  if (d.questTitles.length) lines.push(`The lineup: ${d.questTitles.join('; ')}.`);
  if (d.carriedOverCount) lines.push(`${d.carriedOverCount} carried over from yesterday — still hanging.`);
  lines.push(`Daily streak: ${d.streak} day(s). Overclock: ${d.overclockStreak}-day chain (×${d.overclockMultiplier}).`);
  lines.push(`Energy reads ${d.energyTier}.`);
  if (d.rrCredits) lines.push(`${d.rrCredits} R&R credit(s) banked for downtime.`);
  if (d.topBoss) lines.push(`Boss in play: ${d.topBoss.name}, ${d.topBoss.pct}% down.`);
  if (d.neglectedContact) lines.push(`${d.neglectedContact.name} has gone ${d.neglectedContact.days} days without a ping.`);
  if (d.breachedYesterday.length) lines.push(`ICE breached yesterday: ${d.breachedYesterday.join(', ')}.`);

  const brief = [
    'Write ONE short daily rundown (about 40-70 words) from the brief below.',
    'Open with the day, work in 1-2 concrete items, land a dry sign-off. In character.',
    '',
    'BRIEF:',
    ...lines.map(l => `- ${l}`),
  ].join('\n');

  return narrate(personaSystem(persona), brief, 350);
}

/** The Handler's weekly debrief narrative, delivered with the WeeklyReview. */
export async function narrateWeeklyDebrief(
  w: WeeklyDigest,
  insights: { title: string; evidence: string }[],
  persona: Persona,
): Promise<string | null> {
  if (!config.features.handler) return null;

  const lines: string[] = [
    `Week of ${w.weekOf} to ${w.weekEnd}.`,
    `Active on ${w.activeDays} day(s). Quests: ${w.questsCompleted} cleared, ${w.questsSkipped} skipped, ${w.questsExpired} missed (${w.completionRate}% clear rate).`,
    `Earned ${w.xpEarned} cred and ${w.eddiesEarned} eddies; spent ${w.eddiesSpent} eddies.`,
    `Current streak ${w.currentStreak}, overclock chain ${w.overclockStreak}.`,
    `Workouts logged: ${w.workouts}. Boss hits: ${w.bossDamageEvents}, kills: ${w.bossesDefeated}. New cred badges: ${w.achievementsUnlocked}.`,
  ];
  if (w.spendTotal) lines.push(`Spend this week: $${w.spendTotal}${w.topCategories.length ? ` (top: ${w.topCategories.map(c => `${c.name} $${c.amount}`).join(', ')})` : ''}.`);
  if (w.vitals.sleepAvg != null) lines.push(`Avg sleep ${w.vitals.sleepAvg}h${w.vitals.moodAvg != null ? `, avg mood ${w.vitals.moodAvg}` : ''}${w.vitals.weightDelta != null ? `, weight ${w.vitals.weightDelta >= 0 ? '+' : ''}${w.vitals.weightDelta}` : ''}.`);
  for (const i of insights) lines.push(`Pattern flagged: ${i.title} — ${i.evidence}.`);

  const brief = [
    'Write a weekly debrief (about 70-120 words) from the after-action brief below.',
    'Sum up how the week actually went, call out one win and one slack, and end with a forward-looking line. In character. Honest, not a hype reel — if the week was thin, say so dryly.',
    '',
    'AFTER-ACTION BRIEF:',
    ...lines.map(l => `- ${l}`),
  ].join('\n');

  return narrate(personaSystem(persona), brief, 500);
}
