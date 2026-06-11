/**
 * The Shop route — the primary eddie sink.
 *
 *   GET  /        → catalog (cosmetics flagged owned) + player snapshot.
 *   POST /buy      → spend eddies + grant the item, atomically in one tx.
 *   POST /equip    → set/clear the active cosmetic theme.
 *
 * Conventions mirror routes/media.ts:
 *   - userId-scoped (req.user!.id), router is auth-mounted.
 *   - The economy is server-owned: eddies are spent ONLY via
 *     GamificationService.awardXp (reason 'shop_purchase', touchStreak:false
 *     so a spend never ticks the daily streak; that reason is also excluded
 *     from the overclock multiplier so spends pass through raw).
 *   - PlayerProfile.cosmetics is a JSON-string array of owned theme keys,
 *     parsed/stringified by hand (SQLite has no JSON column).
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { GamificationService } from '../services/GamificationService';
import { SHOP_ITEMS, ShopItem, LootDrop, COSMETIC_THEME_KEYS, FONT_KEYS, FX_KEYS, TIMER_KEYS } from '../services/shopCatalog';
import { startOfLocalDay } from '../utils/dates';

const router = express.Router();

let _game: GamificationService | null = null;
const game = () => (_game ??= new GamificationService(prisma));

/** Parse PlayerProfile.cosmetics (JSON-string array) defensively. */
function parseCosmetics(raw: string | null | undefined): string[] {
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

/** GET / → { items, player }. Cosmetics already owned carry owned:true. */
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const player = await game().getSnapshot(userId);
  const owned = new Set(player.cosmetics);

  const items: ShopItem[] = SHOP_ITEMS.map(item => {
    if (item.category === 'cosmetic') {
      const themeKey = item.payload?.themeKey as string | undefined;
      return { ...item, owned: themeKey ? owned.has(themeKey) : false };
    }
    // font/fx/persona/timer ownership keys are prefixed and equal the item
    // key ('font_orbitron', 'fx_rain', 'persona_drill', 'timer_flip').
    if (item.category === 'font' || item.category === 'fx' || item.category === 'persona' || item.category === 'timer') {
      return { ...item, owned: owned.has(item.key) };
    }
    return { ...item };
  });

  res.json({ items, player });
}));

// --- buy ----------------------------------------------------------------

const buySchema = z.object({ itemKey: z.string().min(1).max(100) });

/**
 * POST /buy { itemKey }
 *
 * Spend eddies and apply the grant atomically. Everything — the balance
 * check, the spend ledger entry, the profile grant, and the receipt — runs
 * inside one prisma.$transaction so a crash can never charge without
 * granting (or vice-versa). The player snapshot is re-read AFTER commit so
 * token/cosmetic counts and the new balance are fresh.
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

    // Read the current profile (owned cosmetics, for the owned-guard + loot).
    await game().ensurePlayer(userId, tx);
    const profile = await tx.playerProfile.findUniqueOrThrow({ where: { userId } });
    const owned = parseCosmetics(profile.cosmetics);

    // 2) Cosmetic owned-guard — refuse to charge for a re-buy.
    if (item.category === 'cosmetic') {
      const themeKey = item.payload?.themeKey as string | undefined;
      if (themeKey && owned.includes(themeKey)) throw new AppError('Already owned', 400);
    }

    // 3) Spend through the economy (raw — 'shop_purchase' is excluded from
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

    // 4) Apply the grant by updating PlayerProfile in the same tx. A guard
    //    throw here (shield rack full / overdrive already running / dilation
    //    already active) rolls the whole tx back, so the spend never lands.
    const granted = await applyGrant(tx, userId, item, owned, profile);

    // 5) Record the receipt.
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
 */
async function applyGrant(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  item: ShopItem,
  owned: string[],
  profile: { streakShields: number; boosterUntil: Date | null; budgetBoostOn: Date | null },
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
      // Auto-equips server-side, like fonts/FX/personas (polish pass §5) —
      // kills the client's buy→equip chained mutation and its cache race.
      const themeKey = item.payload?.themeKey as string;
      const next = [...owned, themeKey];
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify(next), equippedTheme: themeKey },
      });
      return { grant: { themeKey }, message: `Theme unlocked + equipped: ${item.name}` };
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
      return { grant: { personaKey }, message: `Handler persona unlocked + equipped: ${item.name}` };
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
      // Owned key is 'fx_<key>' (== the catalog item key). Auto-equips.
      const fxKey = item.payload?.fxKey as string;
      const ownKey = `fx_${fxKey}`;
      if (owned.includes(ownKey)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, ownKey]), equippedFx: fxKey },
      });
      return { grant: { fxKey }, message: `Ambient FX unlocked + equipped: ${item.name}` };
    }
    case 'timer': {
      // Owned key is 'timer_<key>' (== the catalog item key). Auto-equips.
      const timerKey = item.payload?.timerKey as string;
      const ownKey = `timer_${timerKey}`;
      if (owned.includes(ownKey)) throw new AppError('Already owned', 400);
      await tx.playerProfile.update({
        where: { userId },
        data: { cosmetics: JSON.stringify([...owned, ownKey]), equippedTimer: timerKey },
      });
      return { grant: { timerKey }, message: `Timer style unlocked + equipped: ${item.name}` };
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
          return { grant: { kind: 'cosmetic', themeKey }, message: `Unlocked theme: ${themeKey}` };
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
  fxKey: z.string().max(100).nullable().optional(),
  timerKey: z.string().max(100).nullable().optional(),
});

/**
 * POST /equip { themeKey? | fontKey? | fxKey? | timerKey? }
 *
 * Set/clear an equipped cosmetic slot. Omitted keys are left untouched;
 * an explicit `null` clears the slot. For the theme slot, 'default' also
 * clears (back to the stock neon palette). Any non-null key must be a real,
 * owned cosmetic, else 400 'Not owned'.
 */
router.post('/equip', asyncHandler(async (req: AuthRequest, res) => {
  const { themeKey, fontKey, fxKey, timerKey } = equipSchema.parse(req.body);
  const userId = req.user!.id;

  await game().ensurePlayer(userId);

  // One profile read covers every ownership check this request needs.
  const wantsTheme = themeKey != null && themeKey !== 'default';
  let ownedKeys: string[] = [];
  if (wantsTheme || fontKey != null || fxKey != null || timerKey != null) {
    const profile = await prisma.playerProfile.findUniqueOrThrow({ where: { userId } });
    ownedKeys = parseCosmetics(profile.cosmetics);
  }

  const data: { equippedTheme?: string | null; equippedFont?: string | null; equippedFx?: string | null; equippedTimer?: string | null } = {};

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

  if (fxKey !== undefined) {
    if (fxKey != null) {
      if (!(FX_KEYS as readonly string[]).includes(fxKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`fx_${fxKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedFx = fxKey ?? null;
  }

  if (timerKey !== undefined) {
    if (timerKey != null) {
      if (!(TIMER_KEYS as readonly string[]).includes(timerKey)) throw new AppError('Not owned', 400);
      if (!ownedKeys.includes(`timer_${timerKey}`)) throw new AppError('Not owned', 400);
    }
    data.equippedTimer = timerKey ?? null;
  }

  if (Object.keys(data).length === 0) throw new AppError('Nothing to equip', 400);

  await prisma.playerProfile.update({ where: { userId }, data });

  const player = await game().getSnapshot(userId);
  res.json({ player });
}));

export default router;
