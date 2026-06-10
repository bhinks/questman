/**
 * The Shop catalog — the primary EDDIE SINK.
 *
 * Fixed-price catalog of eddie sinks. Quests pay ~10-25 eddies each, so
 * prices are tuned so that a single burnout-relief token costs roughly a
 * couple of full days of questing, a cosmetic theme is a multi-week goal,
 * and loot crates are a gamble for the eddie-rich.
 *
 * Categories:
 *   token_skip | token_reroll | rr_credit | cosmetic | loot_crate | consumable
 *   | font | fx | persona | timer
 *
 * Purchases record to the Purchase table + a WalletLedger spend entry; the
 * grant (tokens/credits/cosmetic/loot roll) is applied to PlayerProfile,
 * all inside one transaction (see routes/shop.ts). The server owns ALL
 * currency — nothing here mints eddies, it only describes prices/payloads.
 *
 * Cosmetic themeKeys are FIXED to the set index.css already supports:
 *   synthwave | matrix | vaporwave | gold | bloodmoon | arctic
 *   | toxic | sakura | ronin | ultraviolet
 *   | edgerunner | arasaka | militech | netrunner | ghost
 *
 * Ownership keys in PlayerProfile.cosmetics: themes are BARE keys
 * ('synthwave'); the newer lines are PREFIXED ('font_orbitron', 'fx_rain',
 * 'persona_drill', 'timer_flip') — conveniently identical to their catalog
 * item keys.
 */

export interface ShopItem {
  key: string;
  name: string;
  description: string;
  category: 'token_skip' | 'token_reroll' | 'rr_credit' | 'cosmetic' | 'loot_crate' | 'consumable'
    | 'font' | 'fx' | 'persona' | 'timer';
  priceEddies: number;
  /** Category-specific payload, e.g. { tokens: 1 }, { themeKey: 'synthwave' },
   *  { kind: 'shield' | 'booster' | 'budget' } for consumables, or
   *  { fontKey } / { fxKey } / { personaKey } / { timerKey } for the
   *  display/persona/timer lines. */
  payload?: Record<string, unknown>;
}

/**
 * A loot-crate reward bucket. `weight` is relative (need not sum to 1).
 * `kind` decides which grant is applied; `amount`/`themePool` describe it.
 *   eddies  → eddies-back (a partial refund, the booby prize)
 *   skip    → +N skip tokens
 *   reroll  → +N reroll tokens
 *   rr      → +N R&R credits
 *   cosmetic→ roll an UNOWNED theme from themePool (skipped if all owned)
 */
export interface LootDrop {
  kind: 'eddies' | 'skip' | 'reroll' | 'rr' | 'cosmetic';
  weight: number;
  label: string;
  amount?: number;
  themePool?: string[];
}

/** The fixed cosmetic theme keys index.css ships a [data-theme] for. */
export const COSMETIC_THEME_KEYS = [
  'synthwave', 'matrix', 'vaporwave', 'gold', 'bloodmoon', 'arctic',
  'toxic', 'sakura', 'ronin', 'ultraviolet',
  'edgerunner', 'arasaka', 'militech', 'netrunner', 'ghost',
] as const;

/** Display-font pack keys index.css ships a html[data-font] block for. */
export const FONT_KEYS = ['orbitron', 'vt323', 'spacemono', 'sharetech'] as const;

/** Ambient FX pack keys index.css ships a html[data-fx] block for. */
export const FX_KEYS = ['rain', 'aurora', 'vhs', 'datastream', 'radar', 'crt'] as const;

/** Focus-chamber timer style keys the FocusView clock supports. */
export const TIMER_KEYS = ['flip', 'ring', 'pulse'] as const;

export const SHOP_ITEMS: ShopItem[] = [
  // ---- Skip tokens (drop a quest, no penalty) ------------------------
  {
    key: 'skip_1',
    name: 'Skip Token',
    description: 'Drop one quest from the day with zero penalty. For when life gets in the way.',
    category: 'token_skip',
    priceEddies: 40,
    payload: { tokens: 1 },
  },
  {
    key: 'skip_3',
    name: 'Skip Token ×3',
    description: 'Three skips, bundled at a discount. Stock up before a busy week.',
    category: 'token_skip',
    priceEddies: 100,
    payload: { tokens: 3 },
  },

  // ---- Reroll tokens (swap a quest for another) ----------------------
  {
    key: 'reroll_1',
    name: 'Reroll Token',
    description: 'Swap one quest for a fresh draw. Hate today’s assignment? Reroll it.',
    category: 'token_reroll',
    priceEddies: 50,
    payload: { tokens: 1 },
  },
  {
    key: 'reroll_3',
    name: 'Reroll Token ×3',
    description: 'Three rerolls at a discount. Curate your day to taste.',
    category: 'token_reroll',
    priceEddies: 130,
    payload: { tokens: 3 },
  },

  // ---- R&R credits (activate a backlog media item) -------------------
  {
    key: 'rr_1',
    name: 'R&R Credit',
    description: 'Buy guilt-free downtime: spend it to pull a backlog item onto the active shelf.',
    category: 'rr_credit',
    priceEddies: 60,
    payload: { credits: 1 },
  },
  {
    key: 'rr_3',
    name: 'R&R Credit ×3',
    description: 'Three downtime credits. A weekend’s worth of earned leisure, banked.',
    category: 'rr_credit',
    priceEddies: 150,
    payload: { credits: 3 },
  },

  // ---- Cosmetic neon themes (one per theme, priced by rarity) --------
  {
    key: 'theme_synthwave',
    name: 'Theme: Synthwave',
    description: 'Hot-pink sunset neon. The classic outrun palette for the HUD.',
    category: 'cosmetic',
    priceEddies: 300,
    payload: { themeKey: 'synthwave' },
  },
  {
    key: 'theme_matrix',
    name: 'Theme: Matrix',
    description: 'Cascading green code-rain. Wake up — you’re in the construct now.',
    category: 'cosmetic',
    priceEddies: 350,
    payload: { themeKey: 'matrix' },
  },
  {
    key: 'theme_vaporwave',
    name: 'Theme: Vaporwave',
    description: 'Soft cyan-and-rose aesthetic. A e s t h e t i c. Easy on the eyes.',
    category: 'cosmetic',
    priceEddies: 350,
    payload: { themeKey: 'vaporwave' },
  },
  {
    key: 'theme_arctic',
    name: 'Theme: Arctic',
    description: 'Cool glacial blues. A calm, frosted interface for clear-headed days.',
    category: 'cosmetic',
    priceEddies: 450,
    payload: { themeKey: 'arctic' },
  },
  {
    key: 'theme_gold',
    name: 'Theme: Gold',
    description: 'Molten amber luxury. A high-roller palette — flaunt your eddies.',
    category: 'cosmetic',
    priceEddies: 550,
    payload: { themeKey: 'gold' },
  },
  {
    key: 'theme_bloodmoon',
    name: 'Theme: Bloodmoon',
    description: 'Crimson danger-red. The rarest skin — for those who run hot.',
    category: 'cosmetic',
    priceEddies: 600,
    payload: { themeKey: 'bloodmoon' },
  },

  // ---- Cosmetic themes, second wave (slightly premium) ----------------
  {
    key: 'theme_toxic',
    name: 'Theme: Toxic',
    description: 'Acid green-yellow biohazard glow. Looks like it voids warranties.',
    category: 'cosmetic',
    priceEddies: 450,
    payload: { themeKey: 'toxic' },
  },
  {
    key: 'theme_sakura',
    name: 'Theme: Sakura',
    description: 'Soft blossom pink over chrome. Neon petals on black rain.',
    category: 'cosmetic',
    priceEddies: 500,
    payload: { themeKey: 'sakura' },
  },
  {
    key: 'theme_ronin',
    name: 'Theme: Ronin',
    description: 'Burnt ember orange. A masterless blade running on spite and caffeine.',
    category: 'cosmetic',
    priceEddies: 550,
    payload: { themeKey: 'ronin' },
  },
  {
    key: 'theme_ultraviolet',
    name: 'Theme: Ultraviolet',
    description: 'Electric purple past the visible spectrum. Blacklight for the HUD.',
    category: 'cosmetic',
    priceEddies: 650,
    payload: { themeKey: 'ultraviolet' },
  },

  // ---- Cosmetic themes, third wave (corpo/runner editions) ------------
  {
    key: 'theme_edgerunner',
    name: 'Theme: Edgerunner',
    description: 'Construct-yellow with a cyan pop. The street-samurai HUD, straight off the box art.',
    category: 'cosmetic',
    priceEddies: 600,
    payload: { themeKey: 'edgerunner' },
  },
  {
    key: 'theme_arasaka',
    name: 'Theme: Arasaka',
    description: 'Cold corporate crimson. Compliance red on tower black — security is always watching.',
    category: 'cosmetic',
    priceEddies: 650,
    payload: { themeKey: 'arasaka' },
  },
  {
    key: 'theme_militech',
    name: 'Theme: Militech',
    description: 'Mil-spec tactical green. Muted, disciplined HUD tones for runners who plan the op.',
    category: 'cosmetic',
    priceEddies: 500,
    payload: { themeKey: 'militech' },
  },
  {
    key: 'theme_netrunner',
    name: 'Theme: Netrunner',
    description: 'Deep-dive electric blue. ICE-cold interface tones from the far side of the blackwall.',
    category: 'cosmetic',
    priceEddies: 500,
    payload: { themeKey: 'netrunner' },
  },
  {
    key: 'theme_ghost',
    name: 'Theme: Ghost',
    description: 'Monochrome white phosphor. A war-room mainframe HUD — shall we play a game?',
    category: 'cosmetic',
    priceEddies: 700,
    payload: { themeKey: 'ghost' },
  },

  // ---- Handler personas (new AI voice styles; auto-equip on buy) ------
  {
    key: 'persona_drill',
    name: 'Drill Sergeant',
    description: 'A relentless PT instructor in your ear. Barked orders, zero sympathy, secretly proud.',
    category: 'persona',
    priceEddies: 350,
    payload: { personaKey: 'drill' },
  },
  {
    key: 'persona_zen',
    name: 'Zen Monk',
    description: 'A serene minimalist. Koans, stillness, and the quiet insistence that the work is the way.',
    category: 'persona',
    priceEddies: 350,
    payload: { personaKey: 'zen' },
  },
  {
    key: 'persona_noir',
    name: 'Noir Detective',
    description: 'Hardboiled first-person narration. Your to-do list, retold in rain-slicked metaphors.',
    category: 'persona',
    priceEddies: 400,
    payload: { personaKey: 'noir' },
  },
  {
    key: 'persona_showman',
    name: 'The Showman',
    description: 'A glam media-star hype-man. Every quest is a broadcast and you are the headline act.',
    category: 'persona',
    priceEddies: 400,
    payload: { personaKey: 'showman' },
  },

  // ---- Display fonts (auto-equip on buy; toggle via /equip) -----------
  {
    key: 'font_orbitron',
    name: 'Orbitron Display',
    description: 'Geometric sci-fi display face for headers and HUD titles. Clean orbital chrome.',
    category: 'font',
    priceEddies: 250,
    payload: { fontKey: 'orbitron' },
  },
  {
    key: 'font_vt323',
    name: 'VT323 Terminal',
    description: 'Pixel terminal face straight off a CRT. Headers go full retro-green-screen.',
    category: 'font',
    priceEddies: 250,
    payload: { fontKey: 'vt323' },
  },
  {
    key: 'font_spacemono',
    name: 'Space Mono Hardline',
    description: 'The hardline hacker duospace. Headers read like a terminal session that means business.',
    category: 'font',
    priceEddies: 250,
    payload: { fontKey: 'spacemono' },
  },
  {
    key: 'font_sharetech',
    name: 'Share Tech Mono',
    description: 'Condensed engineering mono. Tight, technical, straight off a corpo schematic.',
    category: 'font',
    priceEddies: 250,
    payload: { fontKey: 'sharetech' },
  },

  // ---- Ambient FX (auto-equip on buy; toggle via /equip) --------------
  {
    key: 'fx_rain',
    name: 'Neon Drizzle',
    description: 'Subtle animated rain streaks over the whole HUD. Night City weather, indoors.',
    category: 'fx',
    priceEddies: 300,
    payload: { fxKey: 'rain' },
  },
  {
    key: 'fx_aurora',
    name: 'Aurora Shift',
    description: 'Slow drifting accent-tinted light fields. Re-tints itself to match your skin.',
    category: 'fx',
    priceEddies: 300,
    payload: { fxKey: 'aurora' },
  },
  {
    key: 'fx_vhs',
    name: 'VHS Tracking',
    description: 'Drifting interference bands with a tape-deck wobble. Your life, recorded over a rental.',
    category: 'fx',
    priceEddies: 300,
    payload: { fxKey: 'vhs' },
  },
  {
    key: 'fx_datastream',
    name: 'Data Stream',
    description: 'Thin code columns sliding across the HUD. Corpo net traffic, always passing through.',
    category: 'fx',
    priceEddies: 300,
    payload: { fxKey: 'datastream' },
  },
  {
    key: 'fx_radar',
    name: 'Tac-Sweep',
    description: 'A slow tactical radar wedge sweeping the whole display. Contacts unconfirmed.',
    category: 'fx',
    priceEddies: 350,
    payload: { fxKey: 'radar' },
  },
  {
    key: 'fx_crt',
    name: 'CRT Retrace',
    description: 'A phosphor refresh line crawling down the tube over a faint scanline wash.',
    category: 'fx',
    priceEddies: 350,
    payload: { fxKey: 'crt' },
  },

  // ---- Focus-chamber timer styles (auto-equip on buy) -----------------
  {
    key: 'timer_flip',
    name: 'Split-Flap Chrono',
    description: 'Departure-board digits in chamfered panels. Every minute clacks over like a platform change.',
    category: 'timer',
    priceEddies: 400,
    payload: { timerKey: 'flip' },
  },
  {
    key: 'timer_ring',
    name: 'Orbital Gauge',
    description: 'The clock sits inside a slow accent ring that drains your countdown — or laps the minute on open runs.',
    category: 'timer',
    priceEddies: 450,
    payload: { timerKey: 'ring' },
  },
  {
    key: 'timer_pulse',
    name: 'Biorhythm',
    description: 'Digits that beat like a monitored heart. Deep work, vitals on screen.',
    category: 'timer',
    priceEddies: 400,
    payload: { timerKey: 'pulse' },
  },

  // ---- Power consumables (real mechanics, server-enforced) -----------
  {
    key: 'shield_1',
    name: 'Streak Shield',
    description: 'One missed day forgiven — auto-fires at the roll-over and preserves your overclock chain. Max 3 banked.',
    category: 'consumable',
    priceEddies: 400,
    payload: { kind: 'shield' },
  },
  {
    key: 'booster_1',
    name: 'Overdrive Chip',
    description: '2× eddie earnings for 24 hours. Stack a big day — XP stays honest, the wallet runs hot.',
    category: 'consumable',
    priceEddies: 600,
    payload: { kind: 'booster' },
  },
  {
    key: 'time_dilation_1',
    name: 'Time Dilation',
    description: '+2 hours of day-planner budget, today only. Bend the schedule, fit the bigger contract.',
    category: 'consumable',
    priceEddies: 120,
    payload: { kind: 'budget' },
  },

  // ---- Loot crates (weighted random reward) --------------------------
  {
    key: 'crate_standard',
    name: 'Standard Crate',
    description: 'A gamble: rolls tokens, R&R credits, or an eddies-back consolation.',
    category: 'loot_crate',
    priceEddies: 150,
    payload: {
      table: [
        { kind: 'eddies',  weight: 30, label: '+40 eddies back', amount: 40 },
        { kind: 'skip',    weight: 28, label: '+1 Skip Token', amount: 1 },
        { kind: 'reroll',  weight: 24, label: '+1 Reroll Token', amount: 1 },
        { kind: 'rr',      weight: 14, label: '+1 R&R Credit', amount: 1 },
        { kind: 'skip',    weight: 4,  label: '+3 Skip Tokens', amount: 3 },
      ] satisfies LootDrop[],
    },
  },
  {
    key: 'crate_prime',
    name: 'Prime Crate',
    description: 'High-roller crate: better odds, bigger token hauls, and a shot at a random cosmetic theme.',
    category: 'loot_crate',
    priceEddies: 400,
    payload: {
      table: [
        { kind: 'eddies',   weight: 20, label: '+120 eddies back', amount: 120 },
        { kind: 'skip',     weight: 22, label: '+3 Skip Tokens', amount: 3 },
        { kind: 'reroll',   weight: 22, label: '+3 Reroll Tokens', amount: 3 },
        { kind: 'rr',       weight: 20, label: '+2 R&R Credits', amount: 2 },
        { kind: 'cosmetic', weight: 16, label: 'A random neon theme', themePool: [...COSMETIC_THEME_KEYS] },
      ] satisfies LootDrop[],
    },
  },
];
