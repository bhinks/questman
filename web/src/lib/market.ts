/**
 * market.ts — Night Market v2 presentation metadata (design handoff).
 *
 * The backend catalog (services/shopCatalog.ts) owns keys/prices/gates;
 * this module owns the DISPLAY side the handoff specifies: skin palettes,
 * handler persona characters (scripted ticker lines + level-up copy —
 * "copy is final, lift verbatim"), pet identities + status strings, title
 * names, shell/chrono blurbs. Consumed by ShopView (cards + previews),
 * AppShell (pet widget, runner-ID title), TodayView (handler card meta)
 * and LevelUpOverlay (persona level-up subtitle).
 */
import type { HandlerPersona } from './api';

// ---- NEON SKINS ------------------------------------------------------

/** Skin preview palettes [accent, secondary, tertiary]. Literal hexes are
 *  CORRECT here (exception to the accent-var rule): each swatch previews
 *  the skin's own colors, not the live accent. The v2 handoff skins plus
 *  the returning v1 themes (back on sale, repriced into the v2 curve);
 *  keys match index.css [data-theme] blocks. */
export const SKIN_META: Record<string, { name: string; colors: [string, string, string] }> = {
  default:     { name: 'QUESTMAN OS',      colors: ['#1ce2ff', '#9d6bff', '#ff2e9a'] },
  matrix:      { name: 'MATRIX',           colors: ['#43ff8e', '#8bff43', '#2ff5a6'] },
  arctic:      { name: 'ARCTIC',           colors: ['#8fd8ff', '#c9e6ff', '#a6c8ff'] },
  toxic:       { name: 'TOXIC',            colors: ['#b4ff39', '#d8ff4d', '#6dff6d'] },
  vaporwave:   { name: 'VAPORWAVE',        colors: ['#67e8ff', '#ff9ed6', '#c9a6ff'] },
  abyssal:     { name: 'ABYSSAL',          colors: ['#2ff5d6', '#27c4ff', '#1fb39b'] },
  militech:    { name: 'MILITECH',         colors: ['#52b788', '#74c69d', '#95d5b2'] },
  netrunner:   { name: 'NETRUNNER',        colors: ['#3d7bff', '#7a5cff', '#00d4ff'] },
  ember:       { name: 'EMBER DISTRICT',   colors: ['#ff8a3c', '#ffb36b', '#ff3d5e'] },
  sakura:      { name: 'SAKURA',           colors: ['#ff9ecf', '#d8a6ff', '#ffd1e8'] },
  ronin:       { name: 'RONIN',            colors: ['#ff6a3d', '#ff4d6d', '#ffb03d'] },
  synthwave:   { name: 'SYNTHWAVE SUNSET', colors: ['#ff3d8b', '#b06bff', '#ff9de0'] },
  ultraviolet: { name: 'ULTRAVIOLET',      colors: ['#b44dff', '#7a5cff', '#ff4dd8'] },
  edgerunner:  { name: 'EDGERUNNER',       colors: ['#fcf300', '#ffdd00', '#00f0ff'] },
  acid:        { name: 'ACID RAIN',        colors: ['#d8ff2e', '#7dff5e', '#eaff7a'] },
  arasaka:     { name: 'ARASAKA',          colors: ['#ff0040', '#ff4d8b', '#ff6d00'] },
  bloodmoon:   { name: 'BLOOD MOON',       colors: ['#ff4d6d', '#ff7a99', '#ff6b6b'] },
  ghost:       { name: 'GHOST',            colors: ['#f2f5ff', '#aab4d0', '#c9d1e8'] },
  ghostwire:   { name: 'GHOSTWIRE',        colors: ['#e8ecff', '#aab4d0', '#c9d1e8'] },
  gold:        { name: 'GOLD CHROME',      colors: ['#ffc24b', '#ffe08a', '#ffb347'] },
};

// ---- OS SHELLS -------------------------------------------------------

export const SHELL_META: Record<string, { name: string; desc: string }> = {
  nightcity: {
    name: 'NIGHT CITY',
    desc: 'Factory firmware. Chrome, chroma, corner cuts. The console you know.',
  },
  tty: {
    name: 'BARE METAL',
    desc: 'Strip everything. Phosphor mono, square corners, zero glow. Palette locked.',
  },
  outrun: {
    name: 'OUTRUN',
    desc: 'Sunset on the horizon, grid rolling at 120 mph. Palette locked.',
  },
};

// ---- CHRONO (session-timer styles) ------------------------------------

/** All session-timer faces: the v2 handoff styles plus the v1 clock faces
 *  (flip/ring/pulse), which stay on sale alongside them. */
export const CHRONO_META: Record<string, { name: string; desc: string }> = {
  standard:  { name: 'STANDARD ISSUE',   desc: 'Clean mono countdown with a progress rail.' },
  fuse:      { name: 'SHORT FUSE',       desc: 'A burning line, sparking at the tip. No pressure.' },
  flatline:  { name: 'FLATLINE MONITOR', desc: 'An EKG trace keeps pace with your session.' },
  orbital:   { name: 'ORBITAL',          desc: 'One satellite, one orbit, one contract.' },
  detonator: { name: 'DETONATOR',        desc: 'Red seven-seg countdown. Blinks under a minute.' },
  flip:      { name: 'SPLIT-FLAP CHRONO', desc: 'Departure-board digits in chamfered panels.' },
  ring:      { name: 'ORBITAL GAUGE',    desc: 'The clock inside a slow accent ring that drains your countdown.' },
  pulse:     { name: 'BIORHYTHM',        desc: 'Digits that beat like a monitored heart.' },
};

/** Resolve a snapshot's equippedTimer to a known face key. */
export function chronoKey(equippedTimer: string | null | undefined): string {
  if (!equippedTimer || !CHRONO_META[equippedTimer]) return 'standard';
  return equippedTimer;
}

// ---- HANDLERS (comms voices) -------------------------------------------

/** Minimal state the scripted persona lines interpolate. */
export interface PersonaLineState { streak: number }

export interface PersonaMeta {
  name: string;            // character name on comms (V1KTOR, SGT. CHROME, …)
  tag: string;             // archetype stamp (FIXER, CORPORATE, …)
  desc: string;            // shop-card blurb
  accent: string;          // CSS color for the handler card edge
  /** Scripted ticker copy as a function of state — handoff copy, verbatim. */
  lines: (s: PersonaLineState) => [string, string];
  /** Level-up modal subtitle — handoff copy, verbatim. */
  levelUp: (level: number) => string;
}

const DEFAULT_LEVEL_UP = (l: number) => `LEVEL ${l}. STREET CRED RISING · NEW STOCK AT THE MARKET`;

/** The Night Market handler lineup (keys = backend persona keys; the three
 *  pre-v2 paid voices keep their keys under new v2 identities). */
export const PERSONA_META: Record<string, PersonaMeta> = {
  fixer: {
    name: 'V1KTOR', tag: 'FIXER', accent: 'var(--cyan)',
    desc: 'Terse. Professional. Gets you paid.',
    lines: (s) => [
      `Streak at ${s.streak} days — keep the chain alive, runner.`,
      `Priority contract is live. Clock's running.`,
    ],
    levelUp: DEFAULT_LEVEL_UP,
  },
  hrbot: {
    name: 'HR-BOT 3000', tag: 'CORPORATE', accent: 'var(--blue)',
    desc: 'Synergy. Alignment. Circling back. Forever.',
    lines: (s) => [
      `Per my last ping: your ${s.streak}-day streak is a strong culture-add. Circling back.`,
      `Friendly reminder — hydration is a shared OKR. Let's action that today.`,
    ],
    levelUp: (l) => `LEVEL ${l} ACHIEVED. THIS WILL BE REFLECTED IN YOUR Q3 REVIEW.`,
  },
  drill: {
    name: 'SGT. CHROME', tag: 'DRILL UNIT', accent: 'var(--red)',
    desc: 'Volume permanently at maximum. Believes in you, loudly.',
    lines: (s) => [
      `${s.streak} DAYS UNBROKEN. THAT'S NOT LUCK, RUNNER. THAT'S DISCIPLINE.`,
      `THE INBOX WILL NOT ZERO ITSELF. MOVE. MOVE. MOVE.`,
    ],
    levelUp: (l) => `LEVEL ${l}. OUTSTANDING. NOW GIVE ME ${l} MORE.`,
  },
  zen: {
    name: 'KOAN-9', tag: 'ZEN PROCESS', accent: 'var(--teal)',
    desc: 'A monastery that achieved sentience. Speaks in riddles.',
    lines: (s) => [
      `The streak is ${s.streak} days. The streak is also one day, ${s.streak} times.`,
      `Before enlightenment: clear inbox. After enlightenment: clear inbox.`,
    ],
    levelUp: (l) => `YOU ARE LEVEL ${l}. YOU WERE ALWAYS LEVEL ${l}.`,
  },
  noir: {
    name: 'RAYMOND', tag: 'NOIR PI', accent: 'var(--violet)',
    desc: 'Hardboiled. Narrates your chores like a rainy stakeout.',
    lines: (s) => [
      `The streak was ${s.streak} days old and twice as stubborn. I'd seen worse. Not often.`,
      `Somewhere in this city a contract was still open. It was always the inbox.`,
    ],
    levelUp: (l) => `LEVEL ${l}. IN THIS TOWN, THAT KIND OF NUMBER BUYS YOU TROUBLE.`,
  },
  motherboard: {
    name: 'MOTHERBOARD', tag: 'MATERNAL', accent: 'var(--pink)',
    desc: 'Warm, proud, mildly disappointed when you skip stretches.',
    lines: (s) => [
      `${s.streak} days, sweetheart. I'm so proud of you. Now please drink some water.`,
      `You cleared contracts before noon again. I'm telling everyone on the subnet.`,
    ],
    levelUp: (l) => `LEVEL ${l}! OH HONEY. THIS IS GOING ON THE FRIDGE.`,
  },
  patch: {
    name: 'PATCH v0.12', tag: 'SCRIPT KIDDIE', accent: 'var(--lime)',
    desc: 'Twelve years old. Better at this than you. Knows it.',
    lines: (s) => [
      `lol streak ${s.streak}d?? ok that's actually cracked. EZ.`,
      `i wrote a script to do ur chores but mom says no botnets :(`,
    ],
    levelUp: (l) => `LEVEL ${l}. GG. NO CAP. (i hit that last week btw)`,
  },
};

/** Voices that exist outside the market lineup (free trio + retired stock).
 *  They get card-less meta so the handler card / level-up modal still
 *  speak in character colors, with the stock level-up line. */
export const OFF_MARKET_PERSONA_META: Record<string, Pick<PersonaMeta, 'name' | 'tag' | 'accent' | 'levelUp'>> = {
  rogue_ai:  { name: 'ROGUE AI',  tag: 'HANDLER',  accent: 'var(--violet)',  levelUp: DEFAULT_LEVEL_UP },
  ripperdoc: { name: 'RIPPERDOC', tag: 'CLINIC',   accent: 'var(--magenta)', levelUp: DEFAULT_LEVEL_UP },
  showman:   { name: 'THE SHOWMAN', tag: 'PRIME TIME', accent: 'var(--amber)', levelUp: DEFAULT_LEVEL_UP },
};

/** Meta for ANY persona key (market lineup first, then off-market, then
 *  a rogue-AI-shaped fallback so unknown keys never crash the HUD). */
export function personaMeta(key: HandlerPersona | string | null | undefined): Pick<PersonaMeta, 'name' | 'tag' | 'accent' | 'levelUp'> {
  if (key && PERSONA_META[key]) return PERSONA_META[key];
  if (key && OFF_MARKET_PERSONA_META[key]) return OFF_MARKET_PERSONA_META[key];
  return OFF_MARKET_PERSONA_META.rogue_ai;
}

// ---- TITLES -------------------------------------------------------------

export const TITLE_META: Record<string, { name: string; desc: string }> = {
  eotm:        { name: 'EMPLOYEE OF THE MONTH', desc: 'Of which month, no one will say.' },
  netrunner:   { name: 'NETRUNNER',             desc: 'Standard-issue flex. A classic.' },
  chromesaint: { name: 'CHROME SAINT',          desc: 'For the tastefully augmented.' },
  debtslayer:  { name: 'DEBT SLAYER',           desc: 'Earned in the red. Worn in the black.' },
  streaklord:  { name: 'STREAKLORD',            desc: 'The chain speaks for itself.' },
  voiddancer:  { name: 'VOID DANCER',           desc: 'Nobody knows what it means. That is the point.' },
};

// ---- DATA PETS ------------------------------------------------------------

export interface PetMeta {
  name: string;
  species: string;
  emoji: string;          // emoji ONLY inside gradient .ncx-chip containers (brand rule)
  flicker?: boolean;      // NULL glitches ~1 frame every 7s
  status: string[];       // rotating deck-widget status lines (handoff copy)
}

export const PET_META: Record<string, PetMeta> = {
  byte: {
    name: 'BYTE', species: 'NET PIGEON', emoji: '🐦',
    status: ['delivered a packet. it was a crumb', 'cooing in binary', 'roosting on the firewall'],
  },
  nibble: {
    name: 'NIBBLE', species: 'CYBER-RAT', emoji: '🐀',
    status: ['chewing on a fiber line', 'found 3 eddies in the vents', 'asleep in the heat sink'],
  },
  koi: {
    name: 'K0I', species: 'STREAM FISH', emoji: '🐟',
    status: ['swimming the data stream', 'blub. blub. ping.', 'circling the cache, again'],
  },
  null: {
    name: 'NULL', species: 'GLITCH CAT', emoji: '🐈‍⬛', flicker: true,
    status: ['knocked a file off the desktop', 'staring at nothing. something?', 'purring at exactly 60hz'],
  },
};
