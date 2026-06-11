/**
 * The Shop route — the NIGHT MARKET v2, the primary eddie sink.
 *
 *   GET  /          → catalog (ownership flagged) + player snapshot.
 *   POST /buy       → spend eddies + grant the item, atomically in one tx.
 *   POST /equip     → set/clear an equip slot (theme/font/timer/shell/title/pet).
 *   POST /fx-toggle → flip one owned VISUAL FX overlay on/off (stackable).
 *
 * Conventions mirror routes/media.ts:
 *   - userId-scoped (req.user!.id), router is auth-mounted.
 *   - The economy is server-owned: eddies are spent ONLY via
 *     GamificationService.awardXp (reason 'shop_purchase', touchStreak:false
 *     so a spend never ticks the daily streak; that reason is also excluded
 *     from the overclock multiplier so spends pass through raw).
 *   - PlayerProfile.cosmetics / .fxActive are JSON-string arrays, parsed/
 *     stringified by hand (SQLite has no JSON column).
 *   - Level gates (`levelReq`) are re-validated here against the XP ledger —
 *     the client's level display is cosmetic, the ledger is the truth.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import {
  SHOP_ITEMS, ShopItem, LootDrop,
  COSMETIC_THEME_KEYS, FONT_KEYS, FX_KEYS, TIMER_KEYS,
  SHELL_KEYS, TITLE_KEYS, PET_KEYS,
  LEGACY_FX_ALIAS,
} from '../services/shopCatalog';
import { levelFromXp } from '../utils/leveling';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/** Parse a JSON-string array column (cosmetics / fxActive) defensively. */
function parseKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Current eddie balance = SUM(WalletLedger.amount). */
async function eddieBalance(userId: string, tx: { walletLedger: typeof prisma.walletLedger }): Promise<number> {
  const agg = await tx.walletLedger.aggregate({ where: { userId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

/** Player level from the XP ledger (authoritative) — for levelReq gates. */
async function playerLevel(userId: string, tx: { xpLedger: typeof prisma.xpLedger }): Promise<number> {
  const agg = await tx.xpLedger.aggregate({ where: { userId }, _sum: { amount: true } });
  return levelFromXp(agg._sum.amount ?? 0);
}

/** Does `owned` unlock VISUAL FX `fxKey`? ('fx_<key>' or a legacy pack alias.) */
function ownsFx(owned: string[], fxKey: string): boolean {
  if (owned.includes(`fx_${fxKey}`)) return true;
  return Object.entries(LEGACY_FX_ALIAS).some(([legacy, v2]) => v2 === fxKey && owned.includes(`fx_${legacy}`));
}

/** Does `owned` unlock CHRONO style `timerKey`? (Ownership key 'timer_<key>'.) */
function ownsTimer(owned: string[], timerKey: string): boolean {
  return owned.includes(`timer_${timerKey}`);
}

/** Weighted random pick from a loot table. */
function rollLoot(table: LootDrop[], ownedCosmetics: string[]): LootDrop | null {
  // Drop cosmetic buckets whose entire pool is already owned, so a paid
  // crate never "wins" something the player can't actually receive.
  const eligible = table.filter(d => {
    if (d.kind !== 'cosmetic') return true;
    const pool = (d.themePool ?? []).filter(k => !ownedCosmetics.includes(k));
    return pool.length > 0;
  });
  if (eligible.length === 0) return null;
  const total = eligible.reduce((s, d) => s + Math.max(0, d.weight), 0);
  if (total <= 0) return eligible[0];
  let r = Math.random() * total;
  for (const d of eligible) {
    r -= Math.max(0, d.weight);
    if (r <= 0) return d;
  }
  return eligible[eligible.length - 1];
}

// --- catalog ------------------------------------------------------------

/** GET / → { items, player }. Ownership flagged per category's key scheme. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const player = await game().getSnapshot(userId);
  const owned = player.cosmetics;
  const ownedSet = new Set(owned);

  const items: ShopItem[] = SHOP_ITEMS.map(item => {
    switch (item.category) {
      case 'cosmetic': {
        const themeKey = item.payload?.themeKey as string | undefined;
        return { ...item, owned: themeKey ? ownedSet.has(themeKey) : false };
      }
      case 'fx':
        return { ...item, owned: ownsFx(owned, item.payload?.fxKey as string) };
      case 'timer':
        return { ...item, owned: ownsTimer(owned, item.payload?.timerKey as string) };
      // The prefixed lines own exactly their catalog item key.
      case 'font': case 'persona': case 'shell': case 'title': case 'pet':
        return { ...item, owned: ownedSet.has(item.key) };
      default:
        return { ...item };
    }
  });

  res.json({ items, player });
}));

// --- buy ----------------------------------------------------------------

const buySchema = z.object({ itemKey: z.string().min(1).max(100) });

/**
 * POST /buy { itemKey }
 *
 * Spend eddies and apply the grant atomically. Everything — the balance
 * check, the level gate, the spend ledger entry, the profile grant, and the
 * receipt — runs inside one prisma.$transaction so a crash can never charge
 * without granting (or vice-versa). The player snapshot is re-read AFTER
 * commit so token/cosmetic counts and the new balance are fresh.
 */
router.post('/buy', asyncHandler(async (req: AuthRequest, res) => {
  const { itemKey } = buySchema.parse(req.body);
  const userId = req.user!.id;

  const item = SHOP_ITEMS.find(i => i.key === itemKey);
  if (!item) throw new AppError('Unknown shop item', 400);

  const { purchase, granted, message } = await prisma.$transaction(async (tx) => {
    // 1) Balance gate (ledger is authoritative).
    const balance = await eddieBalance(userId, tx);
    if (balance < item.priceEddies) throw new AppError('Not enough eddies', 400);

    // 2) Level gate (ledger is authoritative; the UI lock is cosmetic).
    if (item.levelReq) {
      const level = await playerLevel(userId, tx);
      if (level < item.levelReq) throw new AppError(`Locked until level ${item.levelReq}`, 400);
    }

    // Read the current profile (owned cosmetics, for the owned-guard + loot).
    await game().ensurePlayer(userId, tx);
    const profile = await tx.playerProfile.findUniqueOrThrow({ where: { userId } });
    const owned = parseKeys(profile.cosmetics);

    // 3) Owned-guards — refuse to charge for a re-buy of a single-buy item.
    if (item.category === 'cosmetic') {
      const themeKey = item.payload?.themeKey as string | undefined;
      if (themeKey && owned.includes(themeKey)) throw new AppError('Already owned', 400);
    }
    if (item.category === 'fx' && ownsFx(owned, item.payload?.fxKey as string)) {
      throw new AppError('Already owned', 400);
    }
    if (item.category === 'timer' && ownsTimer(owned, item.payload?.timerKey as string)) {
      throw new AppError('Already owned', 400);
    }

    // 4) Spend through the economy (raw — 'shop_purchase' is excluded from
    //    the overclock multiplier; touchStreak:false so a spend isn't activity).
    await game().awardXp(userId, {
      amount: 0,
      eddies: -item.priceEddies,
      reason: 'shop_purchase',
      module: 'shop',
      refType: 'shop_item',
      refId: item.key,
      touchStreak: false,
      meta: { itemKey: item.key },
    }, tx);

    // 5) Apply the grant by updating PlayerProfile in the same tx. A guard
    //    throw here (shield rack full / overdrive already running / dilation
    //    already active / already owned) rolls the whole tx back, so the
    //    spend never lands.
    const granted = await applyGrant(tx, userId, item, owned, profile);

    // 6) Record the receipt.
    const purchase = await tx.purchase.create({
      data: {
        userId,
        itemKey: item.key,
        name: item.name,
        category: item.category,
        priceEddies: item.priceEddies,
        grantedJson: JSON.stringify(granted),
      },
    });

    return { purchase, granted: granted.grant, message: granted.message };
  });

  // Re-snapshot AFTER commit so balances/tokens/cosmetics are fresh.
  const player = await game().getSnapshot(userId);

  res.json({ purchase, player, granted, message });
}));

/**
 * Apply a purchased item's grant to the player profile inside `tx`.
 * Returns the human-facing `message` plus a structured `grant` describing
 * exactly what dropped (used for the receipt + the BuyResponse.granted).
 *
 * Auto-equip on buy is the handoff contract for every gear line; FX
 * auto-ACTIVATE instead (they're stackable, not a slot).
 */
async function applyGrant(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  item: ShopItem,
  owned: string[],
  profile: { streakShields: number; boosterUntil: Date | null; budgetBoostOn: Date | null; fxActive: string | null },
): Promise<{ grant: Record<string, unknown>; message: string }> {
  switch (item.category) {
    case 'consumable': {
      const kind = item.payload?.kind as string | undefined;
      const now = new Date();
      if (kind === 'shield') {
        // Cap the rack so shields can't trivialize streak upkeep.
        if (profile.streakShields >= 3) throw new AppError('Shield rack full (max 3)', 400);
        await tx.playerProfile.update({ where: { userId }, data: { streakShields: { increment: 1 } } });
        return { grant: { streakShields: 1 }, message: '+1 Streak Shield — auto-fires on your next missed day' };
      }
      if (kind === 'booster') {
        if (profile.boosterUntil && profile.boosterUntil > now) {
          throw new AppError('Overdrive already running — wait for it to burn out', 400);
        }
        const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await tx.playerProfile.update({ where: { userId }, data: { boosterUntil: until } });
        return { grant: { boosterUntil: until.toISOString() }, message: 'OVERDRIVE ENGAGED — 2× eddies for 24 hours' };
      }
      if (kind === 'budget') {
        const today = startOfLocalDay();
        if (profile.budgetBoostOn && startOfLocalDay(profile.budgetBoostOn).getTime() === today.getTime()) {
          throw new AppError('Time dilation already active today', 400);
        }
        await tx.playerProfile.update({ where: { userId }, data: { budgetBoostOn: today } });
        return { grant: { budgetBoostMin: 120 }, message: '+2h planner budget for today' };
      }
      // Night Market v2 supplies — stock counters only (effects are
      // explicitly out of scope in the design handoff; backend work TBD).
      if (kind === 'focus') {
        await tx.playerProfile.update({ where: { userId }, data: { focusStims: { increment: 1 } } });
        return { grant: { focusStims: 1 }, message: '+1 Focus Stim banked' };
      }
      if (kind === 'overclock') {
        await tx.playerProfile.update({ where: { userId }, data: { overclockChips: { increment: 1 } } });
        return { grant: { overclockChips: 1 }, message: '+1 Overclock Chip banked' };
      }
      throw new AppError('Unknown consumable', 400);
    }
    case 'token_skip': {
      const n = Number(item.payload?.tokens ?? 1);
      await tx.playerProfile.update({ where: { userId }, data: { skipTokens: { increment: n } } });
      return { grant: { skipTokens: n }, message: `+${n} skip token${n === 1 ? '' : 's'}` };
    }
    case 'token_reroll': {
      const n = Number(item.payload?.tokens ?? 1);
      await tx.playerProfile.update({ where: { userId }, data: { rerollTokens: { increment: n } } });
      return { grant: { rerollTokens: n }, message: `+${n} reroll token${n === 1 ? '' : 's'}` };
    }
    case 'rr_credit': {
      const n = Number(item.payload?.credits ?? 1);
      await tx.playerProfile.update({ where: { userId }, data: { rrCredits: { increment: n } } });
      return { grant: { rrCredits: n }, message: `+${n} R&R credit${n === 1 ? '' : 's'}` };
    }
    case 'cosmetic': {
      // Auto-equips server-side, like all gear lines (polish pass §5) —
      // kills the client's buy→equip chained mutation and its cache race.
      const themeKey = item.payload?.themeKey as string;
      const next = [...owned, themeKey];
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify(next), equippedTheme: themeKey },
      });
      return { grant: { themeKey }, message: `Skin unlocked + equipped: ${item.name}` };
    }
    case 'shell': {
      const shellKey = item.payload?.shellKey as string;
      if (owned.includes(item.key)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, item.key]), equippedShell: shellKey },
      });
      return { grant: { shellKey }, message: `OS shell unlocked + booted: ${item.name}` };
    }
    case 'title': {
      const titleKey = item.payload?.titleKey as string;
      if (owned.includes(item.key)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, item.key]), equippedTitle: titleKey },
      });
      return { grant: { titleKey }, message: `Title unlocked + worn: ${item.name}` };
    }
    case 'pet': {
      const petKey = item.payload?.petKey as string;
      if (owned.includes(item.key)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, item.key]), equippedPet: petKey },
      });
      return { grant: { petKey }, message: `${item.name} adopted — now living in your deck` };
    }
    case 'persona': {
      // Owned key is 'persona_<key>' (== the catalog item key). Auto-equips.
      const personaKey = item.payload?.personaKey as string;
      const ownKey = `persona_${personaKey}`;
      if (owned.includes(ownKey)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, ownKey]) },
      });
      // Auto-equip: point the Handler's voice at the new persona.
      await tx.userSettings.upsert({
        where: { userId },
        update: { handlerPersona: personaKey },
        create: { userId, handlerPersona: personaKey },
      });
      return { grant: { personaKey }, message: `Handler unlocked + on comms: ${item.name}` };
    }
    case 'font': {
      // Owned key is 'font_<key>' (== the catalog item key). Auto-equips.
      const fontKey = item.payload?.fontKey as string;
      const ownKey = `font_${fontKey}`;
      if (owned.includes(ownKey)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, ownKey]), equippedFont: fontKey },
      });
      return { grant: { fontKey }, message: `Display font unlocked + equipped: ${item.name}` };
    }
    case 'fx': {
      // Owned key is 'fx_<key>'. STACKABLE: buying auto-ACTIVATES the layer
      // (appends to fxActive) rather than filling a slot.
      const fxKey = item.payload?.fxKey as string;
      const ownKey = `fx_${fxKey}`;
      const active = parseKeys(profile.fxActive);
      await tx.playerProfile.update({
        where: { userId },
        data: {
          cosmetics: JSON.stringify([...owned, ownKey]),
          fxActive: JSON.stringify(active.includes(fxKey) ? active : [...active, fxKey]),
        },
      });
      return { grant: { fxKey }, message: `Visual FX unlocked + online: ${item.name}` };
    }
    case 'timer': {
      // Owned key is 'timer_<key>' (== the catalog item key). Auto-equips.
      const timerKey = item.payload?.timerKey as string;
      const ownKey = `timer_${timerKey}`;
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, ownKey]), equippedTimer: timerKey },
      });
      return { grant: { timerKey }, message: `Chrono style unlocked + on the clock: ${item.name}` };
    }
    case 'loot_crate': {
      const table = (item.payload?.table as LootDrop[] | undefined) ?? [];
      const drop = rollLoot(table, owned);
      if (!drop) {
        // Degenerate case (e.g. every cosmetic owned and the table was all
        // cosmetics): refund a token of value so the buy is never a total loss.
        await tx.playerProfile.update({ where: { userId }, data: { rrCredits: { increment: 1 } } });
        return { grant: { kind: 'rr', rrCredits: 1 }, message: 'Crate fizzled — +1 R&R credit (consolation)' };
      }
      switch (drop.kind) {
        case 'eddies': {
          const n = drop.amount ?? 0;
          // Eddies-back is a real earn refunded into the wallet, but it must
          // bypass the overclock multiplier — use 'shop_purchase' (excluded).
          await game().awardXp(userId, {
            amount: 0, eddies: n, reason: 'shop_purchase', module: 'shop',
            refType: 'loot_crate', refId: item.key, touchStreak: false,
            meta: { lootBack: true, itemKey: item.key },
          }, tx);
          return { grant: { kind: 'eddies', eddies: n }, message: drop.label };
        }
        case 'skip': {
          const n = drop.amount ?? 1;
          await tx.playerProfile.update({ where: { userId }, data: { skipTokens: { increment: n } } });
          return { grant: { kind: 'skip', skipTokens: n }, message: drop.label };
        }
        case 'reroll': {
          const n = drop.amount ?? 1;
          await tx.playerProfile.update({ where: { userId }, data: { rerollTokens: { increment: n } } });
          return { grant: { kind: 'reroll', rerollTokens: n }, message: drop.label };
        }
        case 'rr': {
          const n = drop.amount ?? 1;
          await tx.playerProfile.update({ where: { userId }, data: { rrCredits: { increment: n } } });
          return { grant: { kind: 'rr', rrCredits: n }, message: drop.label };
        }
        case 'cosmetic': {
          const pool = (drop.themePool ?? []).filter(k => !owned.includes(k));
          const themeKey = pool[Math.floor(Math.random() * pool.length)];
          const next = [...owned, themeKey];
          await tx.playerProfile.update({ where: { userId }, data: { cosmetics: JSON.stringify(next) } });
          return { grant: { kind: 'cosmetic', themeKey }, message: `Unlocked skin: ${themeKey}` };
        }
      }
    }
  }
  // Unreachable for known categories; keep the compiler + runtime safe.
  return { grant: {}, message: 'Purchased' };
}

// --- equip --------------------------------------------------------------

const equipSchema = z.object({
  themeKey: z.string().max(100).nullable().optional(),
  fontKey: z.string().max(100).nullable().optional(),
  timerKey: z.string().max(100).nullable().optional(),
  shellKey: z.string().max(100).nullable().optional(),
  titleKey: z.string().max(100).nullable().optional(),
  petKey: z.string().max(100).nullable().optional(),
});

/**
 * POST /equip { themeKey? | fontKey? | timerKey? | shellKey? | titleKey? | petKey? }
 *
 * Set/clear an equipped gear slot. Omitted keys are left untouched; an
 * explicit `null` clears the slot. 'default' also clears the theme slot
 * (stock neon palette) and 'nightcity' the shell slot (factory firmware).
 * Any non-null key must be a real, owned item, else 400 'Not owned'.
 * (VISUAL FX are stackable, not a slot — see POST /fx-toggle.)
 */
router.post('/equip', asyncHandler(async (req: AuthRequest, res) => {
  const { themeKey, fontKey, timerKey, shellKey, titleKey, petKey } = equipSchema.parse(req.body);
  const userId = req.user!.id;

  await game().ensurePlayer(userId);

  // One profile read covers every ownership check this request needs.
  const profile = await prisma.playerProfile.findUniqueOrThrow({ where: { userId } });
  const ownedKeys = parseKeys(profile.cosmetics);

  const data: {
    equippedTheme?: string | null; equippedFont?: string | null;
    equippedTimer?: string | null; equippedShell?: string | null;
    equippedTitle?: string | null; equippedPet?: string | null;
  } = {};

  if (themeKey !== undefined) {
    const isClear = themeKey == null || themeKey === 'default';
    if (!isClear) {
      // Validate it's a real, owned theme (themes use BARE ownership keys).
      if (!(COSMETIC_THEME_KEYS as readonly string[]).includes(themeKey)) {
        throw new AppError('Not owned', 400);
      }
      if (!ownedKeys.includes(themeKey)) throw new AppError('Not owned', 400);
    }
    data.equippedTheme = isClear ? null : themeKey;
  }

  if (fontKey !== undefined) {
    if (fontKey != null) {
      if (!(FONT_KEYS as readonly string[]).includes(fontKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`font_${fontKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedFont = fontKey ?? null;
  }

  if (timerKey !== undefined) {
    // 'standard' (the free built-in) clears back to the default style.
    const isClear = timerKey == null || timerKey === 'standard';
    if (!isClear) {
      if (!(TIMER_KEYS as readonly string[]).includes(timerKey)) throw new AppError('Not owned', 400);
      if (!ownsTimer(ownedKeys, timerKey)) throw new AppError('Not owned', 400);
    }
    data.equippedTimer = isClear ? null : timerKey;
  }

  if (shellKey !== undefined) {
    // 'nightcity' (factory firmware) clears back to the default shell.
    const isClear = shellKey == null || shellKey === 'nightcity';
    if (!isClear) {
      if (!(SHELL_KEYS as readonly string[]).includes(shellKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`shell_${shellKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedShell = isClear ? null : shellKey;
  }

  if (titleKey !== undefined) {
    if (titleKey != null) {
      if (!(TITLE_KEYS as readonly string[]).includes(titleKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`title_${titleKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedTitle = titleKey ?? null;
  }

  if (petKey !== undefined) {
    if (petKey != null) {
      if (!(PET_KEYS as readonly string[]).includes(petKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`pet_${petKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedPet = petKey ?? null;
  }

  if (Object.keys(data).length === 0) throw new AppError('Nothing to equip', 400);

  await prisma.playerProfile.update({ where: { userId }, data });

  const player = await game().getSnapshot(userId);
  res.json({ player });
}));

// --- visual fx toggle -----------------------------------------------------

const fxToggleSchema = z.object({
  fxKey: z.string().min(1).max(100),
  /** Explicit target state; omitted = flip current membership. */
  active: z.boolean().optional(),
});

/**
 * POST /fx-toggle { fxKey, active? }
 *
 * VISUAL FX are stackable: fxActive holds any subset of the owned overlay
 * keys. This flips (or explicitly sets) one key's membership.
 */
router.post('/fx-toggle', asyncHandler(async (req: AuthRequest, res) => {
  const { fxKey, active } = fxToggleSchema.parse(req.body);
  const userId = req.user!.id;

  if (!(FX_KEYS as readonly string[]).includes(fxKey)) throw new AppError('Not owned', 400);

  await game().ensurePlayer(userId);
  const profile = await prisma.playerProfile.findUniqueOrThrow({ where: { userId } });
  if (!ownsFx(parseKeys(profile.cosmetics), fxKey)) throw new AppError('Not owned', 400);

  const current = parseKeys(profile.fxActive);
  const on = active ?? !current.includes(fxKey);
  const next = on
    ? (current.includes(fxKey) ? current : [...current, fxKey])
    : current.filter(k => k !== fxKey);

  await prisma.playerProfile.update({
    where: { userId },
    data: { fxActive: JSON.stringify(next) },
  });

  const player = await game().getSnapshot(userId);
  res.json({ player });
}));

export default router;
