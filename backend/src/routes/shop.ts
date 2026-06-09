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
import { SHOP_ITEMS, ShopItem, LootDrop, COSMETIC_THEME_KEYS } from '../services/shopCatalog';

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

    // 4) Apply the grant by updating PlayerProfile in the same tx.
    const granted = await applyGrant(tx, userId, item, owned);

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
): Promise<{ grant: Record<string, unknown>; message: string }> {
  switch (item.category) {
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
      const themeKey = item.payload?.themeKey as string;
      const next = [...owned, themeKey];
      await tx.playerProfile.update({ where: { userId }, data: { cosmetics: JSON.stringify(next) } });
      return { grant: { themeKey }, message: `Unlocked theme: ${themeKey}` };
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

const equipSchema = z.object({ themeKey: z.string().max(100).nullable() });

/**
 * POST /equip { themeKey }
 *
 * Set the active cosmetic theme. `null` or 'default' unequips (back to the
 * stock neon palette). A non-default theme must be owned, else 400.
 */
router.post('/equip', asyncHandler(async (req: AuthRequest, res) => {
  const { themeKey } = equipSchema.parse(req.body);
  const userId = req.user!.id;

  await game().ensurePlayer(userId);
  const isClear = themeKey == null || themeKey === 'default';

  if (!isClear) {
    // Validate it's a real, owned theme.
    if (!(COSMETIC_THEME_KEYS as readonly string[]).includes(themeKey)) {
      throw new AppError('Not owned', 400);
    }
    const profile = await prisma.playerProfile.findUniqueOrThrow({ where: { userId } });
    if (!parseCosmetics(profile.cosmetics).includes(themeKey)) {
      throw new AppError('Not owned', 400);
    }
  }

  await prisma.playerProfile.update({
    where: { userId },
    data: { equippedTheme: isClear ? null : themeKey },
  });

  const player = await game().getSnapshot(userId);
  res.json({ player });
}));

export default router;
