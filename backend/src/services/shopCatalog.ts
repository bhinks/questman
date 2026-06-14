/**
 * The Shop catalog — the NIGHT MARKET v2 (design handoff: night market
 * expansion), the primary EDDIE SINK.
 *
 * Economy intent (handoff): the catalog totals ≈ €$37,000 against a payout
 * of round(xp/2) eddies per cleared contract (utils/economy.ts), so players
 * can't max out quickly. Several items are level-gated via `levelReq` —
 * re-validated server-side in routes/shop.ts.
 *
 * Categories:
 *   token_skip | token_reroll | rr_credit | cosmetic | loot_crate | consumable
 *   | font | fx | persona | timer | shell | title | pet
 *
 * Purchases record to the Purchase table + a WalletLedger spend entry; the
 * grant is applied to PlayerProfile, all inside one transaction (see
 * routes/shop.ts). The server owns ALL currency — nothing here mints
 * eddies, it only describes prices/payloads.
 *
 * Equip models (handoff contract):
 *   - skins/shells/timers/personas: single-equip, AUTO-EQUIP on buy
 *   - titles/pets: single-equip, removable (equip null), auto-equip on buy
 *   - fx: STACKABLE — buying auto-ACTIVATES; toggle any subset on/off
 *   - supplies: stock counters, repeat purchase OK
 *
 * Ownership keys in PlayerProfile.cosmetics: themes are BARE keys
 * ('synthwave'); everything else is PREFIXED ('font_orbitron', 'fx_rain',
 * 'persona_drill', 'timer_fuse', 'shell_tty', 'title_eotm', 'pet_byte') —
 * conveniently identical to their catalog item keys.
 *
 * Legacy lines (pre-v2): the 8 v1 themes are back on sale (repriced into
 *  the v2 curve); old single-equip FX packs alias onto the nearest v2
 *  overlay if owned (LEGACY_FX_ALIAS); v1 clock faces stayed on sale.
 */

export interface ShopItem {
  key: string;
  name: string;
  description: string;
  category: 'token_skip' | 'token_reroll' | 'rr_credit' | 'cosmetic' | 'loot_crate' | 'consumable'
    | 'font' | 'fx' | 'persona' | 'timer' | 'shell' | 'title' | 'pet';
  priceEddies: number;
  /** Minimum player level to buy (re-validated server-side). */
  levelReq?: number;
  /** Category-specific payload, e.g. { tokens: 1 }, { themeKey: 'synthwave' },
   *  { kind: 'shield' | 'booster' | 'budget' | 'focus' | 'overclock' } for
   *  consumables, or { fontKey } / { fxKey } / { personaKey } / { timerKey }
   *  / { shellKey } / { titleKey } / { petKey } for the gear lines. */
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

/** NEON SKINS on sale at the v2 market (index.css ships each [data-theme]).
 *  The 11 handoff skins keep their designed prices; the 8 pre-v2 themes are
 *  back on the rack (Brent loved the color options) repriced into the v2
 *  curve (~2× their v1 prices, original relative order preserved) so they
 *  don't undercut the redesigned economy. */
export const NIGHT_MARKET_THEME_KEYS = [
  'matrix', 'arctic', 'toxic', 'vaporwave', 'abyssal', 'militech', 'netrunner',
  'ember', 'sakura', 'ronin', 'synthwave', 'ultraviolet', 'edgerunner',
  'acid', 'arasaka', 'bloodmoon', 'ghostwire', 'gold',
] as const;

/** Retired skins — pulled from sale and the loot pool, but still equippable
 *  for anyone who already owns them (mirrors the 'showman' persona). 'ghost'
 *  was a near-duplicate of 'ghostwire' — the same pale-white monochrome
 *  palette — so it was dropped to keep the skin ladder distinct. */
export const RETIRED_THEME_KEYS = ['ghost'] as const;

/** Every theme key /equip accepts (the on-sale ladder + retired-but-owned). */
export const COSMETIC_THEME_KEYS = [...NIGHT_MARKET_THEME_KEYS, ...RETIRED_THEME_KEYS] as const;

/** Display-font pack keys index.css ships a html[data-font] block for. */
export const FONT_KEYS = ['orbitron', 'vt323', 'spacemono', 'sharetech'] as const;

/** VISUAL FX keys (stackable overlay layers — components in the web app). */
export const FX_KEYS = ['cursor', 'dust', 'rain', 'vhs', 'datarain', 'glitch'] as const;

/** Owned legacy single-equip FX packs unlock the nearest v2 overlay. */
export const LEGACY_FX_ALIAS: Record<string, (typeof FX_KEYS)[number]> = {
  aurora: 'dust',        // ambient drifting light → rising motes
  datastream: 'datarain',// code columns → falling glyph columns
  radar: 'cursor',       // sweeping contact → pointer wake
  crt: 'vhs',            // retrace line → tracking band
};

/** CHRONO session-timer styles (STANDARD ISSUE is the free built-in).
 *  The v1 clock faces (flip/ring/pulse) stay on sale alongside the v2
 *  handoff styles — nothing wrong with them, so they're kept, not replaced. */
export const TIMER_KEYS = ['fuse', 'flatline', 'orbital', 'detonator', 'flip', 'ring', 'pulse'] as const;

/** OS shell keys (NIGHT CITY is the free built-in default = null). */
export const SHELL_KEYS = ['tty', 'outrun'] as const;

/** Vanity title keys worn on the runner ID. */
export const TITLE_KEYS = ['eotm', 'netrunner', 'chromesaint', 'debtslayer', 'streaklord', 'voiddancer'] as const;

/** Data-pet keys living in the nav deck. */
export const PET_KEYS = ['byte', 'nibble', 'koi', 'null'] as const;

export const SHOP_ITEMS: ShopItem[] = [
  // ---- NEON SKINS — accent remap, auto-equip on buy. One ascending
  // price ladder: handoff skins at their designed prices, the returning
  // pre-v2 themes interleaved at ~2× their v1 prices. ------------------
  {
    key: 'theme_matrix',
    name: 'Matrix',
    description: 'Cascading green code-rain. Wake up — you’re in the construct now.',
    category: 'cosmetic',
    priceEddies: 800,
    payload: { themeKey: 'matrix' },
  },
  {
    key: 'theme_arctic',
    name: 'Arctic',
    description: 'Cool glacial blues. A calm, frosted interface for clear-headed days.',
    category: 'cosmetic',
    priceEddies: 900,
    payload: { themeKey: 'arctic' },
  },
  {
    key: 'theme_toxic',
    name: 'Toxic',
    description: 'Acid green-yellow biohazard glow. Looks like it voids warranties.',
    category: 'cosmetic',
    priceEddies: 900,
    payload: { themeKey: 'toxic' },
  },
  {
    key: 'theme_vaporwave',
    name: 'Vaporwave',
    description: 'Soft cyan-and-rose aesthetic. A e s t h e t i c. Easy on the eyes.',
    category: 'cosmetic',
    priceEddies: 1000,
    payload: { themeKey: 'vaporwave' },
  },
  {
    key: 'theme_abyssal',
    name: 'Abyssal',
    description: 'Deep-sea teal over blacklight blue. The net floor, where the light barely reaches.',
    category: 'cosmetic',
    priceEddies: 1000,
    payload: { themeKey: 'abyssal' },
  },
  {
    key: 'theme_militech',
    name: 'Militech',
    description: 'Mil-spec tactical green. Muted, disciplined HUD tones for runners who plan the op.',
    category: 'cosmetic',
    priceEddies: 1000,
    payload: { themeKey: 'militech' },
  },
  {
    key: 'theme_netrunner',
    name: 'Netrunner',
    description: 'Deep-dive electric blue. ICE-cold interface tones from the far side of the blackwall.',
    category: 'cosmetic',
    priceEddies: 1000,
    payload: { themeKey: 'netrunner' },
  },
  {
    key: 'theme_ember',
    name: 'Ember District',
    description: 'Furnace orange with a red undertow. The block that never stopped burning.',
    category: 'cosmetic',
    priceEddies: 1100,
    payload: { themeKey: 'ember' },
  },
  {
    key: 'theme_sakura',
    name: 'Sakura',
    description: 'Soft blossom pink over chrome. Neon petals on black rain.',
    category: 'cosmetic',
    priceEddies: 1100,
    payload: { themeKey: 'sakura' },
  },
  {
    key: 'theme_ronin',
    name: 'Ronin',
    description: 'Burnt ember orange. A masterless blade running on spite and caffeine.',
    category: 'cosmetic',
    priceEddies: 1100,
    payload: { themeKey: 'ronin' },
  },
  {
    key: 'theme_synthwave',
    name: 'Synthwave Sunset',
    description: 'Hot-pink sunset neon. The classic outrun palette for the HUD.',
    category: 'cosmetic',
    priceEddies: 1200,
    payload: { themeKey: 'synthwave' },
  },
  {
    key: 'theme_ultraviolet',
    name: 'Ultraviolet',
    description: 'Electric purple past the visible spectrum. Blacklight for the HUD.',
    category: 'cosmetic',
    priceEddies: 1300,
    payload: { themeKey: 'ultraviolet' },
  },
  {
    key: 'theme_edgerunner',
    name: 'Edgerunner',
    description: 'Construct-yellow with a cyan pop. The street-samurai HUD, straight off the box art.',
    category: 'cosmetic',
    priceEddies: 1300,
    payload: { themeKey: 'edgerunner' },
  },
  {
    key: 'theme_acid',
    name: 'Acid Rain',
    description: 'Caustic chartreuse fallout. Don’t look up without eye protection.',
    category: 'cosmetic',
    priceEddies: 1400,
    levelReq: 16,
    payload: { themeKey: 'acid' },
  },
  {
    key: 'theme_arasaka',
    name: 'Arasaka',
    description: 'Cold corporate crimson. Compliance red on tower black — security is always watching.',
    category: 'cosmetic',
    priceEddies: 1400,
    payload: { themeKey: 'arasaka' },
  },
  {
    key: 'theme_bloodmoon',
    name: 'Blood Moon',
    description: 'Crimson danger-red. For those who run hot.',
    category: 'cosmetic',
    priceEddies: 1500,
    payload: { themeKey: 'bloodmoon' },
  },
  {
    key: 'theme_ghostwire',
    name: 'Ghostwire',
    description: 'Pale signal-white over static. The HUD as an apparition.',
    category: 'cosmetic',
    priceEddies: 2200,
    levelReq: 20,
    payload: { themeKey: 'ghostwire' },
  },
  {
    key: 'theme_gold',
    name: 'Gold Chrome',
    description: 'Molten amber luxury. A high-roller palette — flaunt your eddies.',
    category: 'cosmetic',
    priceEddies: 2500,
    payload: { themeKey: 'gold' },
  },

  // ---- OS SHELLS — deep interface rewires (handoff copy verbatim) -----
  {
    key: 'shell_tty',
    name: 'Bare Metal',
    description: 'Strip everything. Phosphor mono, square corners, zero glow. Palette locked.',
    category: 'shell',
    priceEddies: 3200,
    payload: { shellKey: 'tty' },
  },
  {
    key: 'shell_outrun',
    name: 'Outrun',
    description: 'Sunset on the horizon, grid rolling at 120 mph. Palette locked.',
    category: 'shell',
    priceEddies: 3800,
    payload: { shellKey: 'outrun' },
  },

  // ---- VISUAL FX — stackable overlays (handoff copy verbatim) ---------
  {
    key: 'fx_cursor',
    name: 'Ghost Cursor',
    description: 'Your pointer leaves a decaying neon wake.',
    category: 'fx',
    priceEddies: 350,
    payload: { fxKey: 'cursor' },
  },
  {
    key: 'fx_dust',
    name: 'Holo Dust',
    description: 'Drifting motes of light rise through the frame.',
    category: 'fx',
    priceEddies: 450,
    payload: { fxKey: 'dust' },
  },
  {
    key: 'fx_rain',
    name: 'Neon Downpour',
    description: 'It is always raining somewhere in Night City.',
    category: 'fx',
    priceEddies: 500,
    payload: { fxKey: 'rain' },
  },
  {
    key: 'fx_vhs',
    name: 'VHS Tracking',
    description: 'A tracking band crawls the screen every few seconds.',
    category: 'fx',
    priceEddies: 650,
    payload: { fxKey: 'vhs' },
  },
  {
    key: 'fx_datarain',
    name: 'Data Rain',
    description: 'Glyph columns fall behind your panels. You are in it.',
    category: 'fx',
    priceEddies: 800,
    payload: { fxKey: 'datarain' },
  },
  {
    key: 'fx_glitch',
    name: 'Glitch Protocol',
    description: 'Every cleared contract detonates a chromatic burst.',
    category: 'fx',
    priceEddies: 900,
    payload: { fxKey: 'glitch' },
  },

  // ---- CHRONO — session-timer styles (handoff copy verbatim) ----------
  {
    key: 'timer_fuse',
    name: 'Short Fuse',
    description: 'A burning line, sparking at the tip. No pressure.',
    category: 'timer',
    priceEddies: 550,
    payload: { timerKey: 'fuse' },
  },
  {
    key: 'timer_flatline',
    name: 'Flatline Monitor',
    description: 'An EKG trace keeps pace with your session.',
    category: 'timer',
    priceEddies: 700,
    payload: { timerKey: 'flatline' },
  },
  {
    key: 'timer_orbital',
    name: 'Orbital',
    description: 'One satellite, one orbit, one contract.',
    category: 'timer',
    priceEddies: 750,
    payload: { timerKey: 'orbital' },
  },
  {
    key: 'timer_detonator',
    name: 'Detonator',
    description: 'Red seven-seg countdown. Blinks under a minute.',
    category: 'timer',
    priceEddies: 850,
    payload: { timerKey: 'detonator' },
  },
  // v1 clock faces — kept on sale alongside the v2 lineup.
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

  // ---- HANDLERS — comms voices (handoff copy verbatim; V1KTOR free) ---
  // Keys reuse the pre-v2 persona keys where a voice already existed
  // (drill → SGT. CHROME, zen → KOAN-9, noir → RAYMOND) so prior owners
  // keep their unlock.
  {
    key: 'persona_hrbot',
    name: 'HR-BOT 3000',
    description: 'Synergy. Alignment. Circling back. Forever.',
    category: 'persona',
    priceEddies: 600,
    payload: { personaKey: 'hrbot', tag: 'CORPORATE' },
  },
  {
    key: 'persona_drill',
    name: 'SGT. CHROME',
    description: 'Volume permanently at maximum. Believes in you, loudly.',
    category: 'persona',
    priceEddies: 750,
    payload: { personaKey: 'drill', tag: 'DRILL UNIT' },
  },
  {
    key: 'persona_zen',
    name: 'KOAN-9',
    description: 'A monastery that achieved sentience. Speaks in riddles.',
    category: 'persona',
    priceEddies: 750,
    payload: { personaKey: 'zen', tag: 'ZEN PROCESS' },
  },
  {
    key: 'persona_noir',
    name: 'RAYMOND',
    description: 'Hardboiled. Narrates your chores like a rainy stakeout.',
    category: 'persona',
    priceEddies: 800,
    payload: { personaKey: 'noir', tag: 'NOIR PI' },
  },
  {
    key: 'persona_motherboard',
    name: 'MOTHERBOARD',
    description: 'Warm, proud, mildly disappointed when you skip stretches.',
    category: 'persona',
    priceEddies: 900,
    payload: { personaKey: 'motherboard', tag: 'MATERNAL' },
  },
  {
    key: 'persona_patch',
    name: 'PATCH v0.12',
    description: 'Twelve years old. Better at this than you. Knows it.',
    category: 'persona',
    priceEddies: 900,
    payload: { personaKey: 'patch', tag: 'SCRIPT KIDDIE' },
  },

  // ---- TITLES — worn on the runner ID (handoff copy verbatim) ---------
  {
    key: 'title_eotm',
    name: 'Employee of the Month',
    description: 'Of which month, no one will say.',
    category: 'title',
    priceEddies: 66,
    payload: { titleKey: 'eotm' },
  },
  {
    key: 'title_netrunner',
    name: 'Netrunner',
    description: 'Standard-issue flex. A classic.',
    category: 'title',
    priceEddies: 400,
    payload: { titleKey: 'netrunner' },
  },
  {
    key: 'title_chromesaint',
    name: 'Chrome Saint',
    description: 'For the tastefully augmented.',
    category: 'title',
    priceEddies: 800,
    payload: { titleKey: 'chromesaint' },
  },
  {
    key: 'title_debtslayer',
    name: 'Debt Slayer',
    description: 'Earned in the red. Worn in the black.',
    category: 'title',
    priceEddies: 1000,
    payload: { titleKey: 'debtslayer' },
  },
  {
    key: 'title_streaklord',
    name: 'Streaklord',
    description: 'The chain speaks for itself.',
    category: 'title',
    priceEddies: 1200,
    levelReq: 16,
    payload: { titleKey: 'streaklord' },
  },
  {
    key: 'title_voiddancer',
    name: 'Void Dancer',
    description: 'Nobody knows what it means. That is the point.',
    category: 'title',
    priceEddies: 1800,
    levelReq: 20,
    payload: { titleKey: 'voiddancer' },
  },

  // ---- DATA PETS — live in the deck, do nothing, beloved --------------
  {
    key: 'pet_byte',
    name: 'BYTE',
    description: 'A net pigeon. Delivers packets. Some of them are crumbs.',
    category: 'pet',
    priceEddies: 1200,
    payload: { petKey: 'byte' },
  },
  {
    key: 'pet_nibble',
    name: 'NIBBLE',
    description: 'A cyber-rat. Finds eddies in the vents. Keeps them.',
    category: 'pet',
    priceEddies: 1500,
    payload: { petKey: 'nibble' },
  },
  {
    key: 'pet_koi',
    name: 'K0I',
    description: 'A stream fish. Swims the data stream, circles the cache.',
    category: 'pet',
    priceEddies: 1800,
    levelReq: 18,
    payload: { petKey: 'koi' },
  },
  {
    key: 'pet_null',
    name: 'NULL',
    description: 'A glitch cat. Stares at nothing. Possibly something.',
    category: 'pet',
    priceEddies: 2200,
    levelReq: 16,
    payload: { petKey: 'null' },
  },

  // ---- Display fonts (kept from v1; shown under the SHELLS section) ---
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

  // ---- SUPPLIES — consumables, repeat purchase OK (handoff prices) ----
  {
    key: 'reroll_1',
    name: 'Reroll Token',
    description: 'Swap a contract for a fresh pull.',
    category: 'token_reroll',
    priceEddies: 100,
    payload: { tokens: 1 },
  },
  {
    key: 'skip_1',
    name: 'Skip Token',
    description: 'Skip a contract, keep the streak.',
    category: 'token_skip',
    priceEddies: 150,
    payload: { tokens: 1 },
  },
  {
    key: 'focus_1',
    name: 'Focus Stim',
    description: 'Next jack-in session pays +50% XP.',
    category: 'consumable',
    priceEddies: 250,
    payload: { kind: 'focus' },
  },
  {
    key: 'overclock_1',
    name: 'Overclock Chip',
    description: 'Unlocks a fourth side-job slot tomorrow.',
    category: 'consumable',
    priceEddies: 350,
    payload: { kind: 'overclock' },
  },
  {
    key: 'shield_1',
    name: 'Streak Shield',
    description: 'One missed day forgiven. Auto-fires. Max 3 banked.',
    category: 'consumable',
    priceEddies: 400,
    payload: { kind: 'shield' },
  },
  // NOTE: the handoff lists this SKU as "XP BOOSTER — 2× XP for 24 hours",
  // but the live mechanic is 2× EDDIES (XP stays honest — Brent's standing
  // rule, see GamificationService). Name/copy kept truthful to the mechanic.
  {
    key: 'booster_1',
    name: 'Overdrive Chip',
    description: '2× eddie earnings for 24 hours. Stack a big day — XP stays honest, the wallet runs hot.',
    category: 'consumable',
    priceEddies: 600,
    payload: { kind: 'booster' },
  },
  {
    key: 'rr_1',
    name: 'R&R Credit',
    description: 'Buy guilt-free downtime: spend it to pull a backlog item onto the active shelf.',
    category: 'rr_credit',
    priceEddies: 60,
    payload: { credits: 1 },
  },
  {
    key: 'time_dilation_1',
    name: 'Time Dilation',
    description: '+2 hours of day-planner budget, today only. Bend the schedule, fit the bigger contract.',
    category: 'consumable',
    priceEddies: 120,
    payload: { kind: 'budget' },
  },

  // ---- Loot crates (weighted random reward; kept from v1) -------------
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
    description: 'High-roller crate: better odds, bigger token hauls, and a shot at a random neon skin.',
    category: 'loot_crate',
    priceEddies: 400,
    payload: {
      table: [
        { kind: 'eddies',   weight: 20, label: '+120 eddies back', amount: 120 },
        { kind: 'skip',     weight: 22, label: '+3 Skip Tokens', amount: 3 },
        { kind: 'reroll',   weight: 22, label: '+3 Reroll Tokens', amount: 3 },
        { kind: 'rr',       weight: 20, label: '+2 R&R Credits', amount: 2 },
        { kind: 'cosmetic', weight: 16, label: 'A random neon skin', themePool: [...NIGHT_MARKET_THEME_KEYS] },
      ] satisfies LootDrop[],
    },
  },
];
