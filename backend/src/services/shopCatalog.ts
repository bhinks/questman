/**
 * The Shop catalog — the primary EDDIE SINK.
 *
 * Fixed-price catalog of eddie sinks. Quests pay ~10-25 eddies each, so
 * prices are tuned so that a single burnout-relief token costs roughly a
 * couple of full days of questing, a cosmetic theme is a multi-week goal,
 * and loot crates are a gamble for the eddie-rich.
 *
 * Categories:
 *   token_skip | token_reroll | rr_credit | cosmetic | loot_crate
 *
 * Purchases record to the Purchase table + a WalletLedger spend entry; the
 * grant (tokens/credits/cosmetic/loot roll) is applied to PlayerProfile,
 * all inside one transaction (see routes/shop.ts). The server owns ALL
 * currency — nothing here mints eddies, it only describes prices/payloads.
 *
 * Cosmetic themeKeys are FIXED to the set index.css already supports:
 *   synthwave | matrix | vaporwave | gold | bloodmoon | arctic
 */

export interface ShopItem {
  key: string;
  name: string;
  description: string;
  category: 'token_skip' | 'token_reroll' | 'rr_credit' | 'cosmetic' | 'loot_crate';
  priceEddies: number;
  /** Category-specific payload, e.g. { tokens: 1 } or { themeKey: 'synthwave' }. */
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

/** The six fixed cosmetic theme keys index.css ships a [data-theme] for. */
export const COSMETIC_THEME_KEYS = [
  'synthwave', 'matrix', 'vaporwave', 'gold', 'bloodmoon', 'arctic',
] as const;

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
