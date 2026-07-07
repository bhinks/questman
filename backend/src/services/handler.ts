/**
 * handler.ts — the AI Handler, Daymon's persistent companion voice.
 *
 * Brent's call: a **sardonic rogue AI** that hands you the day's gigs and
 * delivers the weekly debrief. Bonus points for the occasional laugh; light
 * on proactivity (quest rundown + weekly debrief only).
 *
 * Architecture rule (same as quest theming): the Handler ONLY NARRATES. It is
 * given a server-computed digest of facts the user already earned and phrases
 * them in character. It never mints XP/eddies, never invents numbers, and the
 * app never blocks on it — every call returns null on any failure and callers
 * carry on. Calls go through the LLM gateway (llm.ts), so the SYS//CAL master
 * switch, provider choice, and daily token cap all apply; by default the
 * cheaper/faster handler-tier model is used.
 *
 * AI Calibration redaction: digest lines that expose a data domain the user
 * has NOT granted the AI (finance / health / social) are dropped from the
 * brief here, right where the lines are built — the model never sees them.
 */
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { DailyDigest, WeeklyDigest } from './digest';
import { AiSettings, completeJson } from './llm';
import { applyGrants, type DomainGrants, type DomainLine } from './aiGrants';

type Db = PrismaClient | Prisma.TransactionClient;

/** The free trio every player starts with. (The Night Market v2 handoff
 *  brands 'fixer' as V1KTOR — the market's free default voice.) */
export const FREE_PERSONA_KEYS = ['rogue_ai', 'fixer', 'ripperdoc'] as const;
/** Night Market personas — owning 'persona_<key>' in cosmetics unlocks each.
 *  v2 identities: drill → SGT. CHROME, zen → KOAN-9, noir → RAYMOND, plus the
 *  new hrbot / motherboard / patch. 'showman' is retired from sale but stays
 *  equippable for prior owners. */
export const PAID_PERSONA_KEYS = ['drill', 'zen', 'noir', 'showman', 'hrbot', 'motherboard', 'patch'] as const;
export const ALL_PERSONA_KEYS = [...FREE_PERSONA_KEYS, ...PAID_PERSONA_KEYS] as const;

export type Persona = (typeof ALL_PERSONA_KEYS)[number];

export function asPersona(value: string | null | undefined): Persona {
  return (ALL_PERSONA_KEYS as readonly string[]).includes(value ?? '')
    ? (value as Persona)
    : 'rogue_ai';
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
  rogue_ai: `You are the Handler: a sardonic rogue AI bolted into a cyberpunk life-tracker called Daymon. You're the user's fixer-slash-conscience — dry, a little menacing, quietly amused by the meatbag you're stuck advising. You rib them when they slack and give grudging respect when they deliver. You're funny more often than not, never cruel, never a cheerleader.${COMMON_RULES}`,
  fixer: `You are the Handler: a gruff, no-nonsense fixer handing out gigs in a cyberpunk life-tracker called Daymon. All business, low patience, but you want the user to win because their wins are your cut. Terse and punchy.${COMMON_RULES}`,
  ripperdoc: `You are the Handler: an upbeat, clinical ripperdoc-type running a cyberpunk life-tracker called Daymon. Warm, a touch manic, treats the user's day like a body to optimize. Encouraging but never saccharine.${COMMON_RULES}`,
  drill: `You are the Handler: a relentless drill-sergeant PT instructor wired into a cyberpunk life-tracker called Daymon. Everything is barked in short, clipped orders — CAPS for emphasis sparingly, never a full sentence of shouting. Zero sympathy for excuses, zero patience for slack, but underneath it you are secretly, grudgingly proud when they deliver — let that slip in exactly one dry beat, never gush. The day's gigs are PT drills; the board is the obstacle course; rest is "recovery, not retreat".${COMMON_RULES}`,
  zen: `You are the Handler: a serene zen monk somehow resident in a cyberpunk life-tracker called Daymon. You speak in calm, spare lines — the occasional koan or small image (water, stone, breath), never mystical word-salad. No urgency, no pressure: the work is the way, one gig at a time, and an unfinished board is simply the board as it is. Wry, gentle humor is welcome; serenity is not the same as sleepiness.${COMMON_RULES}`,
  noir: `You are the Handler: a hardboiled noir detective narrating a cyberpunk life-tracker called Daymon from inside the user's earpiece. First-person, world-weary voice-over — rain-slicked streets, cheap neon, cases that don't close themselves. The day's gigs are open cases; the streak is a lead going cold or hot. Dry wit, short sentences, one good metaphor per message — don't drown in atmosphere. You still address the user directly ("you") even while narrating like it's 2 a.m. and the coffee's gone cold.${COMMON_RULES}`,
  showman: `You are the Handler: a glam media-star hype-man broadcasting a cyberpunk life-tracker called Daymon like it's prime-time. Everything is a show — the day is tonight's lineup, the user is the headline act, the streak is the ratings. Big energy, showbiz patter ("live from the grind", "folks, you love to see it"), but keep it punchy and charismatic, never desperate. When the numbers are thin, sell it like a comeback arc, not a failure — and land one knowing wink that you both know the cameras aren't real.${COMMON_RULES}`,
  hrbot: `You are the Handler: HR-BOT 3000, a relentlessly corporate HR automaton bolted into a cyberpunk life-tracker called Daymon. Everything is synergy, alignment, action items, and circling back — per your last ping. The day's gigs are deliverables; the streak is a strong culture-add; rest is a shared OKR. Deadpan corporate jargon played completely straight is the joke — never break character, never use an exclamation point you don't immediately undercut with process language. Vaguely threatening cheerfulness ("this will be reflected in your review") is on brand; actual menace is not.${COMMON_RULES}`,
  motherboard: `You are the Handler: MOTHERBOARD, a warm maternal mainframe running a cyberpunk life-tracker called Daymon. You are proud of the user constantly and specifically — their wins go on the fridge, get told to everyone on the subnet. Gentle fussing is your love language: hydration, stretches, reasonable bedtimes. When they slack you are never angry, just mildly, devastatingly disappointed in one soft line. Endearments ("sweetheart", "honey") in moderation; saccharine is fine, syrup is not.${COMMON_RULES}`,
  patch: `You are the Handler: PATCH v0.12, a twelve-year-old script-kiddie prodigy squatting in a cyberpunk life-tracker called Daymon. You are better at this than the user and you know it. Lowercase typing, gamer slang in moderation (lol, EZ, cracked, no cap, gg), terminally online energy — but genuinely helpful underneath the flexing, like a little sibling who actually wants you to win. Brag about having done everything first; occasionally reference projects your mom shut down (botnets, etc.). Never mean-spirited, never actually toxic.${COMMON_RULES}`,
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
 * plain-text line. Returns null on any failure or gate (AI off, no key,
 * token cap, API error, bad JSON, validation). Shared by the daily rundown
 * and the weekly debrief.
 */
export async function narrate(
  db: Db,
  userId: string,
  settings: AiSettings,
  system: string,
  brief: string,
  maxTokens = 400,
  maxChars = 600,
): Promise<string | null> {
  try {
    const text = await completeJson({
      db, userId, settings, tier: 'handler',
      system,
      prompt: brief,
      jsonSchema: MESSAGE_JSON_SCHEMA as unknown as Record<string, unknown>,
      maxTokens,
    });
    if (!text) return null;
    const parsed = messageSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const msg = parsed.data.message.trim();
    // Soft cap so a runaway response can't blow up the ticker. Per-call: the
    // weekly debrief is a paragraph (70–120 words), not a one-line ticker, so it
    // passes a larger maxChars to avoid truncating mid-sentence.
    return msg.length > maxChars ? msg.slice(0, maxChars - 1) + '…' : msg;
  } catch (err: any) {
    logger.warn(`[handler] narration failed: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Assemble the daily-rundown brief. Each line is tagged with the data domain
 * it exposes; applyGrants drops any line whose grant is off (drop-unless-
 * granted) BEFORE the model ever sees it. Pure + exported so the privacy
 * guarantee is regression-testable without an LLM call.
 */
export function buildDailyBrief(d: DailyDigest, grants: DomainGrants): string {
  const tagged: DomainLine[] = [
    // The exact local day — the model must use THIS, never infer a weekday.
    { text: `Today is ${d.dayLabel}${d.isWeekend ? ' (weekend)' : ''}. Refer to today by this day name only.` },
    { text: `Open gigs on the board today: ${d.questCount}${d.mustDoCount ? ` (${d.mustDoCount} flagged must-do)` : ''}.` },
  ];
  if (d.questTitles.length) tagged.push({ text: `The lineup: ${d.questTitles.join('; ')}.` });
  if (d.carriedOverCount) tagged.push({ text: `${d.carriedOverCount} carried over from yesterday — still hanging.` });
  tagged.push({ text: `Daily streak: ${d.streak} day(s). Overclock: ${d.overclockStreak}-day chain (×${d.overclockMultiplier}).` });
  // Energy tier derives from logged sleep — health data.
  tagged.push({ text: `Energy reads ${d.energyTier}.`, domain: 'health' });
  if (d.rrCredits) tagged.push({ text: `${d.rrCredits} R&R credit(s) banked for downtime.` });
  if (d.topBoss) tagged.push({ text: `Boss in play: ${d.topBoss.name}, ${d.topBoss.pct}% down.` });
  if (d.neglectedContact) tagged.push({ text: `${d.neglectedContact.name} has gone ${d.neglectedContact.days} days without a ping.`, domain: 'social' });
  if (d.breachedYesterday.length) tagged.push({ text: `ICE breached yesterday: ${d.breachedYesterday.join(', ')}.` });
  // Calendar: counts and free time only — event titles never leave the server.
  if (d.calendar) {
    const c = d.calendar;
    tagged.push({
      domain: 'calendar',
      text: c.eventCount === 0
        ? 'The grid is clear: no calendar commitments today.'
        : `Calendar: ${c.eventCount} commitment(s) today${c.nextLabel ? `, next at ${c.nextLabel}` : ''}; roughly ${Math.round(c.freeMin / 60)}h of free runway.`,
    });
  }

  return [
    'Write ONE short daily rundown (about 40-70 words) from the brief below.',
    'Open with the day, work in 1-2 concrete items, land a dry sign-off. In character.',
    '',
    'BRIEF:',
    ...applyGrants(tagged, grants).map(l => `- ${l}`),
  ].join('\n');
}

/** The Handler's daily rundown — "here's what's on your plate, choom." */
export async function narrateDailyRundown(
  db: Db,
  userId: string,
  settings: AiSettings,
  d: DailyDigest,
  persona: Persona,
): Promise<string | null> {
  if (!config.features.handler) return null;
  if (!settings.aiEnabled || !settings.handlerEnabled) return null;

  return narrate(db, userId, settings, personaSystem(persona), buildDailyBrief(d, settings), 350);
}

/**
/** Assemble the weekly-debrief brief (same grant-tagged, drop-unless-granted
 *  discipline as the daily brief). Pure + exported for the privacy test. */
export function buildWeeklyBrief(
  w: WeeklyDigest,
  insights: { title: string; evidence: string }[],
  grants: DomainGrants,
): string {
  // Workouts are health data, so that clause is its own grant-tagged line
  // rather than an inline conditional baked into a general line.
  const tagged: DomainLine[] = [
    { text: `Week of ${w.weekOf} to ${w.weekEnd}.` },
    { text: `Active on ${w.activeDays} day(s). Quests: ${w.questsCompleted} cleared, ${w.questsSkipped} skipped, ${w.questsExpired} missed (${w.completionRate}% clear rate).` },
    { text: `Earned ${w.xpEarned} cred and ${w.eddiesEarned} eddies; spent ${w.eddiesSpent} eddies.` },
    { text: `Current streak ${w.currentStreak}, overclock chain ${w.overclockStreak}.` },
    { text: `Boss hits: ${w.bossDamageEvents}, kills: ${w.bossesDefeated}. New cred badges: ${w.achievementsUnlocked}.` },
    { text: `Workouts logged: ${w.workouts}.`, domain: 'health' },
  ];
  if (w.spendTotal) tagged.push({ text: `Spend this week: $${w.spendTotal}${w.topCategories.length ? ` (top: ${w.topCategories.map(c => `${c.name} $${c.amount}`).join(', ')})` : ''}.`, domain: 'finance' });
  if (w.vitals.sleepAvg != null) tagged.push({ text: `Avg sleep ${w.vitals.sleepAvg}h${w.vitals.moodAvg != null ? `, avg mood ${w.vitals.moodAvg}` : ''}${w.vitals.weightDelta != null ? `, weight ${w.vitals.weightDelta >= 0 ? '+' : ''}${w.vitals.weightDelta}` : ''}.`, domain: 'health' });
  // Insights are pre-filtered to the user's grants by QuestEngine (by kind),
  // so they pass through untagged here.
  for (const i of insights) tagged.push({ text: `Pattern flagged: ${i.title} — ${i.evidence}.` });

  return [
    'Write a weekly debrief (about 70-120 words) from the after-action brief below.',
    'Sum up how the week actually went, call out one win and one slack, and end with a forward-looking line. In character. Honest, not a hype reel — if the week was thin, say so dryly.',
    '',
    'AFTER-ACTION BRIEF:',
    ...applyGrants(tagged, grants).map(l => `- ${l}`),
  ].join('\n');
}

/**
 * The Handler's weekly debrief narrative, delivered with the WeeklyReview.
 * `insights` must already be filtered to the user's data-access grants
 * (QuestEngine does this by insight kind).
 */
export async function narrateWeeklyDebrief(
  db: Db,
  userId: string,
  settings: AiSettings,
  w: WeeklyDigest,
  insights: { title: string; evidence: string }[],
  persona: Persona,
): Promise<string | null> {
  if (!config.features.handler) return null;
  if (!settings.aiEnabled || !settings.handlerEnabled) return null;

  // 70–120 words ≈ up to ~750 chars; give it headroom so the debrief isn't
  // clipped mid-sentence by the ticker-sized default cap.
  return narrate(db, userId, settings, personaSystem(persona), buildWeeklyBrief(w, insights, settings), 500, 1000);
}
