/**
 * ShopView — the NIGHT MARKET (Night City direction), the eddie sink.
 *
 * A fixed-price catalog of burnout-relief tokens, R&R credits, loot
 * crates, and cosmetic neon skins. Buying spends €$ (server-owned via
 * GamificationService); equipping a cosmetic swaps the app's data-theme
 * (the equipped key is read by App.tsx's useEffect that sets the html
 * dataset + fires the ~450ms theming pulse). All currency is
 * authoritative on the server — after every mutation we invalidate
 * ['player'] so the HUD + theme refresh.
 *
 * Handoff behaviors preserved here:
 *  - buying a skin AUTO-EQUIPS it;
 *  - conditional buttons are KEYED by state (never `transition: all`),
 *    so React remounts instead of morphing (verified stuck-transition bug);
 *  - loot-crate rolls surface through the existing inline feedback line.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { ShopItem, ShopResponse, ShopCategory, BuyResponse, PlayerSnapshot } from '../lib/api';
import { Icon } from './Icon';

/**
 * Skin preview palettes [accent, secondary, tertiary]. Literal hexes are
 * CORRECT here (exception to the accent-var rule): each swatch previews the
 * skin's own colors, not the live accent. Keys match the catalog payload
 * themeKeys / index.css [data-theme] blocks.
 */
const SKIN_PALETTES: Record<string, [string, string, string]> = {
  default:   ['#1ce2ff', '#9d6bff', '#ff2e9a'],
  synthwave: ['#ff3d8b', '#b06bff', '#ff9de0'],
  matrix:    ['#43ff8e', '#8bff43', '#2ff5a6'],
  vaporwave: ['#67e8ff', '#c9a6ff', '#ff9ed6'],
  gold:      ['#ffc24b', '#ffe08a', '#ffb347'],
  bloodmoon: ['#ff4d6d', '#ff6b6b', '#ff7a99'],
  arctic:    ['#8fd8ff', '#a6c8ff', '#c9e6ff'],
};

const CONSUMABLE_ORDER: ShopCategory[] = ['token_skip', 'token_reroll', 'rr_credit', 'consumable', 'loot_crate'];

/** Outline icon per consumable category (NO emoji anywhere). */
const CONSUMABLE_ICON: Record<string, string> = {
  token_skip:   'chevR',
  token_reroll: 'repeat',
  rr_credit:    'play',
  loot_crate:   'bag',
};
/** Per-item icon overrides for the power consumables. */
const ITEM_ICON: Record<string, string> = {
  shield_1:        'shield',
  booster_1:       'zap',
  time_dilation_1: 'clock',
};

/** Owned ×n counts we can read off the player snapshot. */
const OWNED_COUNT: Partial<Record<ShopCategory, (p: PlayerSnapshot) => number>> = {
  token_skip:   p => p.skipTokens,
  token_reroll: p => p.rerollTokens,
  rr_credit:    p => p.rrCredits,
};

/** Owned/active status per power-consumable item key. */
function consumableStatus(itemKey: string, p: PlayerSnapshot): { count: number; active: string | null } {
  if (itemKey === 'shield_1') return { count: p.streakShields, active: null };
  if (itemKey === 'booster_1') {
    const until = p.boosterUntil ? new Date(p.boosterUntil) : null;
    if (until && until > new Date()) {
      const hrs = Math.max(1, Math.round((until.getTime() - Date.now()) / 3_600_000));
      return { count: 0, active: `ACTIVE · ${hrs}H LEFT` };
    }
    return { count: 0, active: null };
  }
  if (itemKey === 'time_dilation_1') {
    const on = p.budgetBoostOn ? new Date(p.budgetBoostOn) : null;
    const now = new Date();
    const today = on && on.getFullYear() === now.getFullYear() && on.getMonth() === now.getMonth() && on.getDate() === now.getDate();
    return { count: 0, active: today ? 'ACTIVE TODAY' : null };
  }
  return { count: 0, active: null };
}

/** View-model for one Neon Skin card (catalog cosmetics + built-in default). */
interface SkinVM {
  key: string;                      // catalog itemKey, or 'theme-default'
  name: string;
  themeKey: string | null;          // null = stock QUESTMAN OS palette
  price: number | null;             // null = free/built-in
  owned: boolean;
  palette: [string, string, string];
}

/** Fallback feedback line for loot-crate rolls when the server sent no message. */
function grantedLine(granted?: Record<string, unknown>): string | null {
  if (!granted) return null;
  const parts = Object.entries(granted).map(([k, v]) => `${k.toUpperCase()} +${String(v)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ShopView() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ key: string; message: string; ok: boolean } | null>(null);

  const shopQ = useQuery({
    queryKey: ['shop'],
    queryFn: () => api.get<ShopResponse>('/api/shop'),
  });

  const refreshPlayer = () => {
    qc.invalidateQueries({ queryKey: ['shop'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['player', 'stats'] });
  };

  const equip = useMutation({
    mutationFn: (themeKey: string | null) => api.post<{ player: PlayerSnapshot }>('/api/shop/equip', { themeKey }),
    onSuccess: refreshPlayer,
  });

  const buy = useMutation({
    mutationFn: (itemKey: string) => api.post<BuyResponse>('/api/shop/buy', { itemKey }),
    onSuccess: (res) => {
      refreshPlayer();
      setFeedback({
        key: res.purchase.itemKey,
        message: res.message ?? grantedLine(res.granted) ?? 'Purchased',
        ok: true,
      });
      // Handoff behavior: buying a skin auto-equips it immediately.
      if (res.purchase.category === 'cosmetic') {
        const bought = qc.getQueryData<ShopResponse>(['shop'])?.items
          .find(i => i.key === res.purchase.itemKey);
        const themeKey = bought?.payload?.themeKey;
        if (typeof themeKey === 'string') equip.mutate(themeKey);
      }
    },
    onError: (err: unknown, itemKey) => {
      const msg = err instanceof ApiError ? err.message : 'Purchase failed';
      setFeedback({ key: itemKey, message: msg, ok: false });
    },
  });

  if (shopQ.isLoading) return <Empty>SPINNING UP THE MARKET…</Empty>;
  if (shopQ.isError || !shopQ.data) return <Empty color="var(--red)">FAILED TO REACH THE MARKET</Empty>;

  const { items, player } = shopQ.data;
  const pendingKey = buy.isPending ? buy.variables : null;

  // Stock QUESTMAN OS palette is always owned + free; equipped when no theme key is set.
  const skins: SkinVM[] = [
    { key: 'theme-default', name: 'QUESTMAN OS', themeKey: null, price: null, owned: true, palette: SKIN_PALETTES.default },
    ...items.filter(i => i.category === 'cosmetic').map((i): SkinVM => {
      const tk = typeof i.payload?.themeKey === 'string' ? (i.payload.themeKey as string) : i.key;
      return {
        key: i.key,
        name: i.name,
        themeKey: tk,
        price: i.priceEddies,
        owned: i.owned === true,
        palette: SKIN_PALETTES[tk] ?? SKIN_PALETTES.default,
      };
    }),
  ];

  const consumables = CONSUMABLE_ORDER.flatMap(cat => items.filter(i => i.category === cat));

  return (
    <div className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- header: chroma title + focal balance panel ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div className="ncx-glitch ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700 }}>
            NIGHT MARKET
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 4 }}>
            COSMETICS · CONSUMABLES · NO REFUNDS
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <Ticks focal>
          <div className="panel hud" style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="kicker" style={{ fontSize: 9.5 }}>BALANCE</span>
            <span className="ncx-val" style={{ fontSize: 24, color: 'var(--amber)', textShadow: '0 0 14px rgba(255,194,75,0.4)' }}>
              €${player.eddies.toLocaleString()}
            </span>
          </div>
        </Ticks>
      </div>

      {/* ---- neon skins ---- */}
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        NEON SKINS — FULL ACCENT REMAP · EQUIP TO PREVIEW LIVE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {skins.map(skin => (
          <SkinCard
            key={skin.key}
            skin={skin}
            equipped={player.equippedTheme === skin.themeKey}
            affordable={skin.price === null || player.eddies >= skin.price}
            busy={pendingKey === skin.key || equip.isPending}
            feedback={feedback?.key === skin.key ? feedback : null}
            onBuy={() => { setFeedback(null); buy.mutate(skin.key); }}
            onEquip={() => equip.mutate(skin.themeKey)}
          />
        ))}
      </div>

      {/* ---- consumables ---- */}
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase', marginTop: 4 }}>
        CONSUMABLES
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {consumables.map(item => {
          const status = item.category === 'consumable' ? consumableStatus(item.key, player) : null;
          return (
            <ConsumableCard
              key={item.key}
              item={item}
              ownedCount={status ? status.count : (OWNED_COUNT[item.category]?.(player) ?? 0)}
              activeLabel={status?.active ?? null}
              affordable={player.eddies >= item.priceEddies}
              busy={pendingKey === item.key || equip.isPending}
              feedback={feedback?.key === item.key ? feedback : null}
              onBuy={() => { setFeedback(null); buy.mutate(item.key); }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------- neon skin card ---------- */

function SkinCard({ skin, equipped, affordable, busy, feedback, onBuy, onEquip }: {
  skin: SkinVM;
  equipped: boolean;
  affordable: boolean;
  busy: boolean;
  feedback: { message: string; ok: boolean } | null;
  onBuy: () => void;
  onEquip: () => void;
}) {
  const c = skin.palette;
  return (
    <div className={'panel' + (equipped ? ' hud' : '')} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* mini-HUD preview in the skin's OWN colors */}
      <div className="panel-inset" style={{ height: 70, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120px 60px at 20% 0%, ${c[0]}22, transparent)` }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            width: 14, height: 14, flex: 'none',
            clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
            background: c[0], boxShadow: `0 0 8px ${c[0]}`,
          }} />
          <div style={{ flex: 1, height: 5, background: '#0a0b14', boxShadow: 'inset 0 0 0 1px rgba(150,168,224,0.12)' }}>
            <div style={{ width: '62%', height: '100%', background: c[0], boxShadow: `0 0 8px ${c[0]}aa` }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {c.map((col, i) => (
            <span key={i} style={{ flex: 1, height: 4, background: col, opacity: 0.85, boxShadow: `0 0 6px ${col}66` }} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{skin.name}</span>
        <span style={{ flex: 1 }} />
        {equipped && <span className="ncx-stamp flat" style={{ color: 'var(--cyan)' }}>LIVE</span>}
        {!equipped && skin.owned && <span className="ncx-stamp flat" style={{ color: 'var(--text-faint)' }}>OWNED</span>}
      </div>

      {/* keyed by state — see file header */}
      {equipped ? (
        <button key={skin.key + '-eq'} className="btn btn-primary" style={{ fontSize: 11, padding: 8 }} disabled>
          EQUIPPED
        </button>
      ) : skin.owned ? (
        <button key={skin.key + '-own'} className="btn" style={{ fontSize: 11, padding: 8 }} disabled={busy} onClick={onEquip}>
          EQUIP
        </button>
      ) : (
        <button
          key={skin.key + '-buy'}
          className="btn"
          style={{ fontSize: 11, padding: 8, opacity: affordable ? undefined : 0.45 }}
          disabled={!affordable || busy}
          onClick={onBuy}
          title={affordable ? undefined : 'Not enough eddies'}
        >
          <span style={{ color: 'var(--amber)' }}>€${(skin.price ?? 0).toLocaleString()}</span>· UNLOCK
        </button>
      )}

      {feedback && <FeedbackLine feedback={feedback} />}
    </div>
  );
}

/* ---------- consumable card ---------- */

function ConsumableCard({ item, ownedCount, activeLabel, affordable, busy, feedback, onBuy }: {
  item: ShopItem;
  ownedCount: number;
  activeLabel?: string | null;
  affordable: boolean;
  busy: boolean;
  feedback: { message: string; ok: boolean } | null;
  onBuy: () => void;
}) {
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="ncx-chip" style={{ width: 34, height: 34, color: 'var(--cyan)' }}>
          <Icon name={ITEM_ICON[item.key] ?? CONSUMABLE_ICON[item.category] ?? 'bag'} size={15} />
        </div>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{item.name}</span>
        {activeLabel ? (
          <span className="ncx-stamp flat" style={{ marginLeft: 'auto', color: 'var(--lime)', fontSize: 8 }}>{activeLabel}</span>
        ) : ownedCount > 0 ? (
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>×{ownedCount}</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5, flex: 1 }}>{item.description}</div>
      <button
        className="btn"
        style={{ fontSize: 11, padding: 8, opacity: affordable ? undefined : 0.45 }}
        disabled={!affordable || busy}
        onClick={onBuy}
        title={affordable ? undefined : 'Not enough eddies'}
      >
        <span style={{ color: 'var(--amber)' }}>€${item.priceEddies.toLocaleString()}</span>· BUY
      </button>

      {feedback && <FeedbackLine feedback={feedback} />}
    </div>
  );
}

/* ---------- shared bits ---------- */

/** Inline purchase feedback — loot crates reveal what dropped here. */
function FeedbackLine({ feedback }: { feedback: { message: string; ok: boolean } }) {
  return (
    <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.08em', color: feedback.ok ? 'var(--lime)' : 'var(--red)' }}>
      {feedback.ok ? '▸ ' : '✕ '}{feedback.message}
    </div>
  );
}

/** Corner "+" tick crosses floated outside a panel's corners. */
function Ticks({ children, focal, style }: {
  children: React.ReactNode;
  focal?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className="ncx-ticks" style={style}>
      <span className="tick" style={{ top: -4, left: -4, color: focal ? 'var(--cyan)' : undefined }} />
      <span className="tick" style={{ bottom: -4, right: -4, color: focal ? 'var(--cyan)' : undefined }} />
      {children}
    </div>
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
