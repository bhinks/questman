// handler-data.jsx — mock data for the consolidated HANDLER page.
// The Handler is the voice/intelligence layer: it transmits lines, surfaces
// patterns from your data-shadow, and files a weekly after-action. Persona
// flavors the copy. Shapes mirror the app (Insight, HandlerMessage,
// WeeklyReview/WeeklyStats, PersonaResponse). All invented sample data.

/* ---- personas (owned + locked Night-Market voices). Each carries a voice:
   latest() = freshest transmission, debriefIntro() = top of the weekly narrative. */
const PERSONAS = [
  {
    key: 'v1ktor', label: 'V1KTOR', tag: 'FIXER', color: 'var(--cyan)',
    blurb: 'Terse. Professional. Gets you paid.', owned: true, free: true,
    latest: (s) => `Streak holds at ${s.streak}. Three contracts open — clear the priority before noon.`,
    debriefIntro: (s) => `Week's in the books. ${s.questsCompleted} contracts cleared, ${s.activeDays} active days. Clean run. Don't get comfortable.`,
  },
  {
    key: 'motherboard', label: 'MOTHERBOARD', tag: 'MATERNAL', color: 'var(--pink)',
    blurb: 'Warm, proud, mildly worried you skipped lunch.', owned: true, free: false,
    latest: (s) => `${s.streak} days straight, sweetheart — I'm so proud. Did you drink water yet? Go drink water.`,
    debriefIntro: (s) => `Look at you this week — ${s.questsCompleted} things done and ${s.activeDays} days up and moving. I told the whole subnet. Now rest.`,
  },
  {
    key: 'koan', label: 'KOAN-9', tag: 'ZEN', color: 'var(--teal)',
    blurb: 'A monastery that became sentient. Speaks in riddles.', owned: true, free: false,
    latest: (s) => `The streak is ${s.streak} days. It is also one day, ${s.streak} times. Begin again.`,
    debriefIntro: (s) => `${s.questsCompleted} tasks rose and fell this week like breath. You were present for ${s.activeDays} of seven dawns. This is enough.`,
  },
  {
    key: 'raymond', label: 'RAYMOND', tag: 'NOIR PI', color: 'var(--amber)',
    blurb: 'Hardboiled. Narrates your chores like a rainy stakeout.', owned: false, priceEddies: 800,
    latest: (s) => `The streak was ${s.streak} days old and twice as stubborn.`,
    debriefIntro: (s) => `${s.questsCompleted} jobs closed. The week didn't go easy. They never do.`,
  },
  {
    key: 'patch', label: 'PATCH v0.12', tag: 'SCRIPT KIDDIE', color: 'var(--lime)',
    blurb: 'Twelve years old. Better at this than you.', owned: false, priceEddies: 900,
    latest: (s) => `lol ${s.streak}d streak?? ok thats actually cracked. EZ.`,
    debriefIntro: (s) => `gg this week. ${s.questsCompleted} cleared no cap. i couldve done more but mom said bedtime`,
  },
];

/* ---- handler transmission log (newest first). kind: rundown|debrief|event ---- */
const HOURS = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const TRANSMISSIONS = [
  { id: 't1', kind: 'daily_rundown', seen: false, createdAt: HOURS(2),
    text: 'Morning. Priority contract is the lien paydown — it ages out at midnight. Two side-jobs are low-effort XP; grab them between calls.' },
  { id: 't2', kind: 'event', seen: false, createdAt: HOURS(9),
    text: 'Boss phase advanced: THE LIEN dropped to 41%. Keep the pressure on — one more clean week and it flatlines.' },
  { id: 't3', kind: 'daily_rundown', seen: true, createdAt: HOURS(26),
    text: 'Yesterday: 6 of 8 contracts cleared, +80 XP. Hydration logged late. Sleep window slipped past 1am again.' },
  { id: 't4', kind: 'weekly_debrief', seen: true, createdAt: HOURS(34),
    text: 'After-action filed for the week of Jun 1. Completion rate 78%. Full report in DEBRIEF.' },
  { id: 't5', kind: 'event', seen: true, createdAt: HOURS(50),
    text: 'Achievement unlocked: IRON CADENCE — 21-day streak. Street cred up.' },
  { id: 't6', kind: 'daily_rundown', seen: true, createdAt: HOURS(74),
    text: 'Quiet day on the board. You still cleared the essentials. That counts.' },
];

/* ---- insights / possible patterns ---- */
const INSIGHTS = [
  {
    id: 'i1', status: 'new', confidence: 'medium', windowDays: 30, actionType: 'quest',
    title: 'Short sleep precedes low-mood days',
    body: 'On nights under 6.5h, your next-day mood logs land a full point lower on average.',
    evidence: '14 of 18 sub-6.5h nights → next-day mood ≤ 2 (vs. 3.6 baseline).',
    suggestion: 'Spawn a quest to protect a 7-hour sleep window on weeknights.',
  },
  {
    id: 'i2', status: 'new', confidence: 'medium', windowDays: 60, actionType: 'quest',
    title: 'Weekend spend runs 2.4× weekdays',
    body: 'Discretionary spend clusters hard on Fri–Sun, mostly food + rideshare.',
    evidence: 'Sat avg $94 vs. weekday avg $39 across 8 weeks.',
    suggestion: 'Set a weekend discretionary cap and track it as a side-job.',
  },
  {
    id: 'i3', status: 'spawned', confidence: 'low', windowDays: 45, actionType: 'quest',
    title: 'Gym days bookend longer streaks',
    body: 'Your longest unbroken streaks tend to start within a day of a logged workout.',
    evidence: '4 of 5 streaks ≥ 10 days began ≤ 24h after a gym session.',
    suggestion: 'Front-load a workout when a streak resets.',
  },
  {
    id: 'i4', status: 'dismissed', confidence: 'low', windowDays: 30, actionType: 'none',
    title: 'Late screen time tracks shorter sleep',
    body: 'Phone activity after 11pm loosely correlates with a later sleep onset.',
    evidence: 'Weak signal — needs more nights logged.',
    suggestion: null,
  },
];

/* ---- weekly debriefs (newest first). First is the open one awaiting reflection. ---- */
const DEBRIEFS = [
  {
    id: 'w0', weekOf: '2076-06-08', status: 'awaiting', notes: '', focusForNext: '',
    insightCount: 2,
    stats: {
      xpEarned: 1180, eddiesEarned: 540, questsCompleted: 41, completionRate: 82,
      questsExpired: 5, workouts: 4, bossesDefeated: 1, achievementsUnlocked: 2,
      spendTotal: 612, activeDays: 6,
      vitals: { sleepAvg: 6.8, moodAvg: 3.6, weightDelta: -1.4 },
      topCategories: [{ name: 'Food', amount: 214 }, { name: 'Rideshare', amount: 96 }, { name: 'Gear', amount: 80 }],
    },
  },
  {
    id: 'w1', weekOf: '2076-06-01', status: 'submitted', notes: 'Front end of the week was strong; faded Thursday after a short night.', focusForNext: 'Protect the sleep window.',
    insightCount: 1,
    stats: {
      xpEarned: 1020, eddiesEarned: 470, questsCompleted: 37, completionRate: 78,
      questsExpired: 7, workouts: 3, bossesDefeated: 0, achievementsUnlocked: 1,
      spendTotal: 705, activeDays: 6,
      vitals: { sleepAvg: 6.4, moodAvg: 3.3, weightDelta: -0.6 },
      topCategories: [{ name: 'Food', amount: 268 }, { name: 'Subscriptions', amount: 110 }],
    },
  },
  {
    id: 'w2', weekOf: '2076-05-25', status: 'submitted', notes: 'Travel week. Held the streak on the road.', focusForNext: 'Rebuild gym cadence.',
    insightCount: 0,
    stats: {
      xpEarned: 760, eddiesEarned: 300, questsCompleted: 28, completionRate: 64,
      questsExpired: 11, workouts: 1, bossesDefeated: 0, achievementsUnlocked: 0,
      spendTotal: 940, activeDays: 5,
      vitals: { sleepAvg: 6.1, moodAvg: 3.0, weightDelta: 0.4 },
      topCategories: [{ name: 'Travel', amount: 520 }, { name: 'Food', amount: 244 }],
    },
  },
];

const PLAYER = {
  level: 14, handle: 'BRENT', streak: 23, eddies: 4250,
  xpIntoLevel: 380, xpForNextLevel: 620, skipTokens: 2, rerollTokens: 1, streakShields: 1,
};

window.QM_HANDLER = { PERSONAS, TRANSMISSIONS, INSIGHTS, DEBRIEFS, PLAYER };
