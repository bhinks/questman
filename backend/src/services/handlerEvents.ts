/**
 * handlerEvents.ts — persona-voiced "event" transmissions.
 *
 * The Handler's message log used to carry only the daily rundown and the
 * weekly debrief. This adds the missing middle layer: short, in-character
 * reactions to notable things the quest engine and the rest of the app do —
 * boss kills, milestone clears, level-ups, streak milestones, workouts, etc.
 *
 * Same architecture rule as the rest of the Handler (see handler.ts): it ONLY
 * NARRATES a fact the user already earned. It never mints economy, never
 * invents numbers, and is ALWAYS fire-and-forget — callers do
 * `void emitHandlerEvent(...)` AFTER their own transaction commits, so a slow
 * or failed Claude call can never add latency to (or roll back) the action
 * that triggered it. Every path swallows its own errors.
 *
 * Gating mirrors the daily rundown: the SYS//CAL master switch + handler
 * toggle + provider availability + the daily token cap (enforced in the LLM
 * gateway) all apply. AI Calibration redaction applies too — an event that
 * exposes a data domain the user hasn't granted (health / social / finance) is
 * dropped here, before the model ever sees it.
 *
 * Which voice produced each line is persisted on HandlerMessage.persona so the
 * feed can attribute it even after the user switches personas.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getAiSettings, aiAvailable } from './llm';
import { asPersona, narrate, personaSystem, type Persona } from './handler';
import { grantAllowed, type DataDomain } from './aiGrants';

type Db = PrismaClient | Prisma.TransactionClient;

/** Every notable thing the app can react to, with just the facts the line
 *  needs. Kept narrow on purpose — high-frequency churn (quest progress,
 *  habit checks, individual vitals logs) is intentionally NOT here. */
export type HandlerEvent =
  | { type: 'boss_defeated'; name: string; bossId: string }
  | { type: 'boss_phase'; name: string; pct: number; bossId: string }
  | { type: 'antigoal_breached'; name: string; antigoalId: string }
  | { type: 'milestone_cleared'; title: string; projectName?: string | null; projectId: string }
  | { type: 'workout_logged'; label: string; workoutId: string }
  | { type: 'media_completed'; title: string; mediaId: string }
  | { type: 'npc_interaction'; name: string; npcId: string }
  | { type: 'achievement_unlocked'; name: string; key: string }
  | { type: 'level_up'; from: number; to: number }
  | { type: 'streak_milestone'; days: number };

interface EventSpec {
  /** The single fact the model is allowed to narrate. */
  fact: string;
  refType: string;
  refId: string | null;
  /** Data-access grant required to even narrate it (AI Calibration redaction). */
  grant?: DataDomain;
}

/** Daily-streak lengths worth a dedicated shout (rundown already mentions the
 *  running count, so only these crossings get their own transmission). */
export const STREAK_MILESTONES = new Set([7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365]);

function specFor(e: HandlerEvent): EventSpec {
  switch (e.type) {
    case 'boss_defeated':
      return { fact: `The user just took down a boss fight: "${e.name}". It's done — flatlined for good.`, refType: 'boss', refId: e.bossId };
    case 'boss_phase':
      return { fact: `The user landed a hit on the boss "${e.name}". It's now ${e.pct}% down — wounded, not dead.`, refType: 'boss', refId: e.bossId };
    case 'antigoal_breached':
      return { fact: `An anti-goal (a line the user drew for themselves) was just breached: "${e.name}". The discipline slipped this time.`, refType: 'antigoal', refId: e.antigoalId };
    case 'milestone_cleared':
      return { fact: `The user cleared a project milestone: "${e.title}"${e.projectName ? ` on the project "${e.projectName}"` : ''}.`, refType: 'projectMilestone', refId: e.projectId };
    case 'workout_logged':
      return { fact: `The user just logged a workout: ${e.label}.`, refType: 'workout', refId: e.workoutId, grant: 'health' };
    case 'media_completed':
      return { fact: `The user finished a piece of media: "${e.title}".`, refType: 'media', refId: e.mediaId };
    case 'npc_interaction':
      return { fact: `The user reached out and logged some time with a contact named ${e.name}.`, refType: 'npc', refId: e.npcId, grant: 'social' };
    case 'achievement_unlocked':
      return { fact: `The user unlocked a new street-cred badge: "${e.name}".`, refType: 'achievement', refId: e.key };
    case 'level_up':
      return { fact: `The user just leveled up — now level ${e.to} (was ${e.from}).`, refType: 'level', refId: null };
    case 'streak_milestone':
      return { fact: `The user's daily streak just reached ${e.days} days in a row.`, refType: 'streak', refId: null };
  }
}

/** Build the one-line, in-character reaction for an event. ~15-35 words. */
async function narrateEvent(
  db: Db,
  userId: string,
  settings: Parameters<typeof narrate>[2],
  spec: EventSpec,
  persona: Persona,
): Promise<string | null> {
  const brief = [
    'Write ONE short transmission (about 15-35 words) reacting to the single event below.',
    'In character. Plain text, one or two sentences. React to THIS event only — do not summarize the day or invent other numbers.',
    '',
    `EVENT: ${spec.fact}`,
  ].join('\n');
  return narrate(db, userId, settings, personaSystem(persona), brief, 160);
}

/**
 * Narrate + persist + broadcast a single Handler event. Fire-and-forget:
 * resolves to void and never throws. Call AFTER your tx commits, passing the
 * base PrismaClient (not a tx handle).
 */
export async function emitHandlerEvent(db: Db, userId: string, event: HandlerEvent): Promise<void> {
  try {
    if (!config.features.handler) return;
    const settings = await getAiSettings(db, userId);
    if (!aiAvailable(settings) || !settings.handlerEnabled) return;

    const spec = specFor(event);
    // AI Calibration redaction: never narrate a domain the user hasn't granted.
    if (!grantAllowed(spec.grant, settings)) return;

    const persona = asPersona(settings.handlerPersona);
    const text = await narrateEvent(db, userId, settings, spec, persona);
    if (!text) return;

    const msg = await db.handlerMessage.create({
      data: {
        userId,
        kind: 'event',
        text,
        persona,
        refType: spec.refType,
        refId: spec.refId,
        meta: JSON.stringify({ event: event.type }),
      },
    });
    const ws = (globalThis as any).wsService;
    ws?.broadcastGameEvent?.(userId, 'handler-message', { id: msg.id, kind: 'event', text, persona });
  } catch (err: any) {
    logger.warn(`[handlerEvents] ${event.type} narration failed for user ${userId}: ${err?.message ?? err}`);
  }
}
