/**
 * ShopView — the eddie sink.
 *
 * A fixed-price catalog of burnout-relief tokens, R&R credits, loot
 * crates, and cosmetic neon themes. Buying spends €$ (server-owned via
 * GamificationService); equipping a cosmetic swaps the app's data-theme
 * (the equipped key is read by App.tsx's useEffect that sets the html
 * dataset). All currency is authoritative on the server — after every
 * mutation we invalidate ['player'] so the HUD + theme refresh.
 *
 * Design system only — reuses .panel / .btn / kicker / mono + CSS vars.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { ShopItem, ShopResponse, ShopCategory, BuyResponse, PlayerSnapshot } from '../lib/api';
import { Icon } from './Icon';

/** Accent color of each cosmetic theme's primary --cyan (from index.css). */
const THEME_SWATCH: Record<string, { label: string; color: string; alt: string }> = {
  synthwave: { label: 'Synthwave', color: '#ff3d8b', alt: '#ff77c8' },
  matrix:    { label: 'Matrix', color: '#43ff8e', alt: '#b6ff4d' },
  vaporwave: { label: 'Vaporwave', color: '#67e8ff', alt: '#ff9ed6' },
  gold:      { label: 'Gold', color: '#ffc24b', alt: '#ffe08a' },
  bloodmoon: { label: 'Bloodmoon', color: '#ff4d6d', alt: '#ff7a99' },
  arctic:    { label: 'Arctic', color: '#8fd8ff', alt: '#c9e6ff' },
};

const CATEGORY_META: Record<ShopCategory, { label: string; icon: string; color: string; blurb: string }> = {
  token_skip:   { label: 'Skip Tokens', icon: 'plane', color: 'var(--amber)', blurb: 'Drop a quest, no penalty' },
  token_reroll: { label: 'Reroll Tokens', icon: 'repeat', color: 'var(--violet)', blurb: 'Swap a quest for a fresh draw' },
  rr_credit:    { label: 'R&R Credits', icon: 'moon', color: 'var(--teal)', blurb: 'Buy guilt-free downtime' },
  cosmetic:     { label: 'Neon Themes', icon: 'spark', color: 'var(--magenta)', blurb: 'Recolor the entire HUD' },
  loot_crate:   { label: 'Loot Crates', icon: 'bag', color: 'var(--lime)', blurb: 'Gamble eddies for a random haul' },
};

const CATEGORY_ORDER: ShopCategory[] = [
  'cosmetic', 'loot_crate', 'token_skip', 'token_reroll', 'rr_credit',
];

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

  const buy = useMutation({
    mutationFn: (itemKey: string) => api.post<BuyResponse>('/api/shop/buy', { itemKey }),
    onSuccess: (res) => {
      refreshPlayer();
      setFeedback({ key: res.purchase.itemKey, message: res.message ?? 'Purchased', ok: true });
    },
    onError: (err: unknown, itemKey) => {
      const msg = err instanceof ApiError ? err.message : 'Purchase failed';
      setFeedback({ key: itemKey, message: msg, ok: false });
    },
  });

  const equip = useMutation({
    mutationFn: (themeKey: string | null) => api.post<{ player: PlayerSnapshot }>('/api/shop/equip', { themeKey }),
    onSuccess: refreshPlayer,
  });

  if (shopQ.isLoading) return <Empty>SPINNING UP THE MARKET…</Empty>;
  if (shopQ.isError || !shopQ.data) return <Empty color="var(--red)">FAILED TO REACH THE MARKET</Empty>;

  const { items, player } = shopQ.data;
  const grouped = CATEGORY_ORDER
    .map(category => ({ category, rows: items.filter(i => i.category === category) }))
    .filter(g => g.rows.length > 0);

  const pendingKey = buy.isPending ? buy.variables : null;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <BalanceHeader player={player} />

      {grouped.map(g => {
        const meta = CATEGORY_META[g.category];
        return (
          <section key={g.category} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingLeft: 4 }}>
              <Icon name={meta.icon as any} size={14} style={{ color: meta.color, alignSelf: 'center' }} />
              <span className="kicker" style={{ color: meta.color }}>{meta.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{meta.blurb}</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}>
              {g.rows.map(item => (
                <ItemCard
                  key={item.key}
                  item={item}
                  balance={player.eddies}
                  equippedTheme={player.equippedTheme}
                  busy={pendingKey === item.key || equip.isPending}
                  feedback={feedback?.key === item.key ? feedback : null}
                  onBuy={() => { setFeedback(null); buy.mutate(item.key); }}
                  onEquip={(themeKey) => equip.mutate(themeKey)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BalanceHeader({ player }: { player: PlayerSnapshot }) {
  return (
    <div className="panel hud" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <Icon name="cart" size={20} style={{ color: 'var(--cyan)' }} />
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>Black Market</h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
          spend your eddies — tokens · downtime · neon
        </div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Stat icon="wallet" color="var(--cyan)" label="EDDIES" value={`€$ ${player.eddies.toLocaleString()}`} bright />
        <Stat icon="plane" color="var(--amber)" label="SKIPS" value={player.skipTokens} />
        <Stat icon="repeat" color="var(--violet)" label="REROLLS" value={player.rerollTokens} />
        <Stat icon="moon" color="var(--teal)" label="R&R" value={player.rrCredits} />
      </div>
    </div>
  );
}

function Stat({ icon, color, label, value, bright }: {
  icon: string; color: string; label: string; value: string | number; bright?: boolean;
}) {
  return (
    <div
      className="mono"
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, color: bright ? color : 'var(--text-dim)',
        fontWeight: bright ? 700 : 500,
        padding: '6px 10px',
        background: bright ? `color-mix(in srgb, ${color} 10%, transparent)` : 'var(--panel-2)',
        border: `1px solid ${bright ? `color-mix(in srgb, ${color} 35%, transparent)` : 'var(--line)'}`,
        borderRadius: 8,
      }}
    >
      <Icon name={icon as any} size={13} style={{ color }} />
      {value}
      <span style={{ color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.06em' }}>{label}</span>
    </div>
  );
}

function ItemCard({
  item, balance, equippedTheme, busy, feedback, onBuy, onEquip,
}: {
  item: ShopItem;
  balance: number;
  equippedTheme: string | null;
  busy: boolean;
  feedback: { message: string; ok: boolean } | null;
  onBuy: () => void;
  onEquip: (themeKey: string | null) => void;
}) {
  const meta = CATEGORY_META[item.category];
  const isCosmetic = item.category === 'cosmetic';
  const themeKey = isCosmetic ? (item.payload?.themeKey as string | undefined) : undefined;
  const swatch = themeKey ? THEME_SWATCH[themeKey] : undefined;
  const owned = item.owned === true;
  const equipped = !!themeKey && equippedTheme === themeKey;
  const affordable = balance >= item.priceEddies;
  const canBuy = !owned && affordable && !busy;

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10,
        border: equipped
          ? `1px solid ${swatch?.color ?? 'var(--cyan)'}`
          : '1px solid var(--line)',
        background: equipped && swatch
          ? `linear-gradient(180deg, color-mix(in srgb, ${swatch.color} 8%, transparent), transparent)`
          : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {swatch ? (
          <Swatch swatch={swatch} />
        ) : (
          <div style={{
            width: 38, height: 38, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--panel-2)', border: '1px solid var(--line)',
            color: meta.color,
          }}>
            <Icon name={meta.icon as any} size={18} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{item.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
            {item.description}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
        <span
          className="mono"
          style={{
            fontSize: 13, fontWeight: 700,
            color: affordable || owned ? 'var(--cyan)' : 'var(--text-faint)',
          }}
        >
          €$ {item.priceEddies.toLocaleString()}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {/* Cosmetic: equip/unequip toggle once owned. */}
          {isCosmetic && owned && (
            equipped ? (
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: 11 }}
                disabled={busy}
                onClick={() => onEquip(null)}
                title="Revert to the default neon palette"
              >
                <Icon name="check" size={12} /> EQUIPPED
              </button>
            ) : (
              <button
                className="btn"
                style={{ padding: '6px 10px', fontSize: 11 }}
                disabled={busy}
                onClick={() => themeKey && onEquip(themeKey)}
              >
                EQUIP
              </button>
            )
          )}

          {/* Buy button — hidden for already-owned cosmetics. */}
          {!owned && (
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 11 }}
              disabled={!canBuy}
              onClick={onBuy}
              title={!affordable ? 'Not enough eddies' : undefined}
            >
              <Icon name={item.category === 'loot_crate' ? 'bag' : 'cart'} size={12} />
              {busy ? 'BUYING…' : item.category === 'loot_crate' ? 'OPEN' : 'BUY'}
            </button>
          )}
          {owned && !isCosmetic && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--lime)' }}>OWNED</span>
          )}
        </div>
      </div>

      {/* Inline purchase feedback (loot crates reveal what dropped here). */}
      {feedback && (
        <div
          className="mono"
          style={{
            fontSize: 11, padding: '6px 8px', borderRadius: 6,
            color: feedback.ok ? 'var(--lime)' : 'var(--red)',
            background: feedback.ok
              ? 'color-mix(in srgb, var(--lime) 10%, transparent)'
              : 'color-mix(in srgb, var(--red) 10%, transparent)',
            border: `1px solid color-mix(in srgb, ${feedback.ok ? 'var(--lime)' : 'var(--red)'} 30%, transparent)`,
          }}
        >
          {feedback.ok ? '▸ ' : '✕ '}{feedback.message}
        </div>
      )}
    </div>
  );
}

/** Two-tone neon color chip previewing a cosmetic theme palette. */
function Swatch({ swatch }: { swatch: { color: string; alt: string } }) {
  return (
    <div style={{
      width: 38, height: 38, borderRadius: 8, flexShrink: 0,
      overflow: 'hidden', border: '1px solid var(--line)',
      background: `linear-gradient(135deg, ${swatch.color} 0%, ${swatch.color} 50%, ${swatch.alt} 50%, ${swatch.alt} 100%)`,
      boxShadow: `0 0 12px color-mix(in srgb, ${swatch.color} 45%, transparent)`,
    }} />
  );
}

function Empty({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="panel hud" style={{ padding: 40, textAlign: 'center', color: color ?? 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
