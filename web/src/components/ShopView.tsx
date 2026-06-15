/**
 * ShopView — the NIGHT MARKET v2 (design handoff: night market expansion).
 *
 * Eight category lines behind a chamfered pill rail (ALL shows every
 * section stacked):
 *   SKINS    — accent-palette remaps (single-equip; legacy owned themes
 *              keep a card so they stay equippable)
 *   SHELLS   — deep interface rewires (single-equip; fonts ride along
 *              here — the section label covers them)
 *   FX       — ambient overlays (STACKABLE — toggle on/off any time)
 *   CHRONO   — session-timer styles (single-equip; v1 faces kept on sale)
 *   HANDLERS — the comms voice (single-equip via the Handler config)
 *   TITLES   — vanity titles on the runner ID (single-equip, removable)
 *   PETS     — deck companions (single-equip, removable)
 *   SUPPLY   — consumables (repeat purchase, stock counters)
 *
 * Card states (Polish-Pass contract — glow only on true actions):
 *   equipped → .focal border + LIVE stamp + quiet "▸ RUNNING NOW" line
 *              (variants: BOOTED NOW / ON THE CLOCK / ON COMMS); titles
 *              and pets get a REMOVE button instead (they can be unworn)
 *   fx online→ focal border + lime ONLINE stamp + plain DISABLE button
 *   owned    → OWNED stamp (faint) + plain EQUIP button
 *   locked   → disabled "🔒 LVL n · €$price" button (server re-validates)
 *   buyable  → "€$price · UNLOCK" (amber price); opacity .45 + disabled
 *              when unaffordable
 *
 * Handoff behaviors preserved here:
 *  - every purchase AUTO-EQUIPS server-side (FX auto-activate);
 *  - conditional buttons are KEYED by state (never `transition: all`),
 *    so React remounts instead of morphing (verified stuck-transition bug);
 *  - all currency is server-owned — after every mutation we invalidate
 *    ['player'] so the HUD + theme refresh.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { ShopItem, ShopResponse, BuyResponse, PlayerSnapshot, PersonaResponse } from '../lib/api';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';
import { SKIN_META, SHELL_META, PERSONA_META, TITLE_META, PET_META, chronoKey } from '../lib/market';
import { FxPreview } from './FxOverlays';
import { SessionTimerPreview } from './SessionTimer';

/** Literal font stacks for the display-font previews. Literal families are
 *  CORRECT here (same exception as the skin palettes): each card previews
 *  its own face regardless of the currently equipped --font-display. */
const FONT_FAMILIES: Record<string, string> = {
  orbitron:  "'Orbitron', 'Chakra Petch', sans-serif",
  vt323:     "'VT323', 'Chakra Petch', monospace",
  spacemono: "'Space Mono', 'Chakra Petch', monospace",
  sharetech: "'Share Tech Mono', 'Chakra Petch', monospace",
};

/** Outline icon per supply SKU (NO emoji outside .ncx-chip containers). */
const SUPPLY_ICON: Record<string, string> = {
  reroll_1: 'repeat',
  skip_1: 'chevR',
  focus_1: 'target',
  overclock_1: 'clock',
  shield_1: 'shield',
  booster_1: 'zap',
  rr_1: 'play',
  time_dilation_1: 'clock',
  crate_standard: 'bag',
  crate_prime: 'bag',
};

/** Owned ×n stock counter per supply SKU, read off the player snapshot. */
const SUPPLY_COUNT: Record<string, (p: PlayerSnapshot) => number> = {
  skip_1: p => p.skipTokens,
  reroll_1: p => p.rerollTokens,
  rr_1: p => p.rrCredits,
  shield_1: p => p.streakShields,
  focus_1: p => p.focusStims,
  overclock_1: p => p.overclockChips,
};

/** Active-effect label for the timed supplies. */
function supplyActiveLabel(itemKey: string, p: PlayerSnapshot): string | null {
  if (itemKey === 'booster_1') {
    const until = p.boosterUntil ? new Date(p.boosterUntil) : null;
    if (until && until > new Date()) {
      const hrs = Math.max(1, Math.round((until.getTime() - Date.now()) / 3_600_000));
      return `ACTIVE · ${hrs}H LEFT`;
    }
  }
  if (itemKey === 'time_dilation_1') {
    const on = p.budgetBoostOn ? new Date(p.budgetBoostOn) : null;
    const now = new Date();
    if (on && on.getFullYear() === now.getFullYear() && on.getMonth() === now.getMonth() && on.getDate() === now.getDate()) {
      return 'ACTIVE TODAY';
    }
  }
  return null;
}

/** Display order of the SUPPLY grid (handoff six first, kept stock after). */
const SUPPLY_ORDER = [
  'reroll_1', 'skip_1', 'focus_1', 'overclock_1', 'shield_1', 'booster_1',
  'rr_1', 'time_dilation_1', 'crate_standard', 'crate_prime',
];

/** Fallback feedback line for loot-crate rolls when the server sent no message. */
function grantedLine(granted?: Record<string, unknown>): string | null {
  if (!granted) return null;
  const parts = Object.entries(granted).map(([k, v]) => `${k.toUpperCase()} +${String(v)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const MKT_CATS: Array<[string, string]> = [
  ['all', 'ALL'], ['skins', 'SKINS'], ['shells', 'SHELLS'], ['fx', 'FX'], ['chrono', 'CHRONO'],
  ['handlers', 'HANDLERS'], ['titles', 'TITLES'], ['pets', 'PETS'], ['supply', 'SUPPLY'],
];

type Feedback = { key: string; message: string; ok: boolean } | null;

export function ShopView() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [cat, setCat] = useState('all');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const show = (k: string) => cat === 'all' || cat === k;
  const handle = (user?.name || user?.email?.split('@')[0] || 'RUNNER').toUpperCase();

  const shopQ = useQuery({
    queryKey: ['shop'],
    queryFn: () => api.get<ShopResponse>('/api/shop'),
  });
  // Current Handler persona — drives the LIVE stamp on the handler cards.
  const personaQ = useQuery({
    queryKey: ['handler', 'persona'],
    queryFn: () => api.get<PersonaResponse>('/api/handler/persona'),
  });

  const refreshPlayer = () => {
    qc.invalidateQueries({ queryKey: ['shop'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['player', 'stats'] });
  };
  const refreshPersona = () => {
    qc.invalidateQueries({ queryKey: ['handler', 'persona'] });
    qc.invalidateQueries({ queryKey: ['handler', 'latest'] });
  };

  // One equip endpoint covers every slot; explicit null clears (titles/pets).
  const equip = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      api.post<{ player: PlayerSnapshot }>('/api/shop/equip', body),
    onSuccess: refreshPlayer,
  });
  // VISUAL FX are stackable — membership flips, no slot.
  const fxToggle = useMutation({
    mutationFn: (fxKey: string) => api.post<{ player: PlayerSnapshot }>('/api/shop/fx-toggle', { fxKey }),
    onSuccess: refreshPlayer,
  });
  // Owned Handler voices equip through the Handler config endpoint.
  const equipPersona = useMutation({
    mutationFn: (personaKey: string) => api.put('/api/handler/persona', { persona: personaKey }),
    onSuccess: refreshPersona,
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
      // Everything auto-equips SERVER-SIDE on buy (handoff contract);
      // refreshPlayer above re-snapshots theme/shell/gear for App.tsx.
      // Personas also auto-equip server-side — refresh the Handler config.
      if (res.purchase.category === 'persona') refreshPersona();
    },
    onError: (err: unknown, itemKey) => {
      const msg = err instanceof ApiError ? err.message : 'Purchase failed';
      setFeedback({ key: itemKey, message: msg, ok: false });
    },
  });

  if (shopQ.isLoading) return <Empty>SPINNING UP THE MARKET…</Empty>;
  if (shopQ.isError || !shopQ.data) return <Empty color="var(--red)">FAILED TO REACH THE MARKET</Empty>;

  const { items, player } = shopQ.data;
  const busy = buy.isPending || equip.isPending || fxToggle.isPending || equipPersona.isPending;
  const fb = (key: string) => (feedback?.key === key ? feedback : null);
  const doBuy = (key: string) => { setFeedback(null); buy.mutate(key); };

  const byCat = (c: ShopItem['category']) => items.filter(i => i.category === c);

  // ---- SKINS view-model: stock default + the full catalog ladder ----
  const skinItems = byCat('cosmetic');
  type SkinVM = {
    key: string; themeKey: string | null; name: string;
    colors: [string, string, string]; price: number | null;
    levelReq?: number; owned: boolean;
  };
  const skins: SkinVM[] = [
    { key: 'theme-default', themeKey: null, name: SKIN_META.default.name, colors: SKIN_META.default.colors, price: null, owned: true },
    ...skinItems.map((i): SkinVM => {
      const tk = String(i.payload?.themeKey ?? i.key);
      const meta = SKIN_META[tk];
      return {
        key: i.key, themeKey: tk,
        name: meta?.name ?? i.name.toUpperCase(),
        colors: meta?.colors ?? SKIN_META.default.colors,
        price: i.priceEddies, levelReq: i.levelReq, owned: i.owned === true,
      };
    }),
  ];
  const skinEquipped = (s: SkinVM) => (player.equippedTheme ?? null) === s.themeKey;

  // ---- SHELLS + fonts ----
  const shellItems = byCat('shell');
  const fontItems = byCat('font');
  const equippedShell = player.equippedShell ?? 'nightcity';

  // ---- FX / CHRONO / HANDLERS / TITLES / PETS / SUPPLY ----
  const fxItems = byCat('fx');
  const fxActive = new Set(player.fxActive);
  const timerItems = byCat('timer');
  const equippedChrono = chronoKey(player.equippedTimer);
  const personaItems = byCat('persona');
  const currentPersona = personaQ.data?.persona ?? null;
  const titleItems = byCat('title');
  const petItems = byCat('pet');
  const supplyItems = SUPPLY_ORDER
    .map(key => items.find(i => i.key === key))
    .filter((i): i is ShopItem => i != null);

  const ownCount = (list: ShopItem[]) => list.filter(i => i.owned === true).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- header: chroma title + focal balance panel ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div className="ncx-glitch ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700 }}>
            NIGHT MARKET
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--text-faint)', marginTop: 4 }}>
            COSMETICS · FIRMWARE · COMPANIONS · NO REFUNDS
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

      {/* ---- category rail (keyed by active state — remount, don't morph) ---- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MKT_CATS.map(([k, label]) => (
          <button
            key={k + '-' + (cat === k)}
            className={'btn' + (cat === k ? ' btn-primary' : '')}
            style={{ padding: '5px 13px', fontSize: 10 }}
            onClick={() => setCat(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- NEON SKINS ---- */}
      <MktSection
        show={show('skins')}
        label="NEON SKINS — FULL ACCENT REMAP · EQUIP TO PREVIEW LIVE"
        serial={`${skins.filter(s => s.owned).length}/${skins.length} OWNED`}
      >
        {skins.map(s => {
          const equipped = skinEquipped(s);
          return (
            <MktCard key={s.key} equipped={equipped}>
              <SkinPreview colors={s.colors} />
              <NameRow name={s.name} equipped={equipped} owned={s.owned} />
              <ActionSlot
                equipped={equipped} owned={s.owned}
                price={s.price} levelReq={s.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(s.key)}
                onEquip={() => equip.mutate({ themeKey: s.themeKey })}
              />
              {fb(s.key) && <FeedbackLine feedback={fb(s.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- OS SHELLS ---- */}
      <MktSection
        show={show('shells')}
        label="OS SHELLS — FULL INTERFACE REWIRE · FONTS · GEOMETRY · BACKDROP"
        serial={`${1 + ownCount(shellItems)}/${1 + shellItems.length} OWNED`}
      >
        {/* Factory firmware — always owned, equipping it clears the slot. */}
        <MktCard equipped={equippedShell === 'nightcity'}>
          <ShellPreview k="nightcity" />
          <NameRow name={SHELL_META.nightcity.name} equipped={equippedShell === 'nightcity'} owned />
          <DescLine text={SHELL_META.nightcity.desc} />
          <ActionSlot
            equipped={equippedShell === 'nightcity'} owned liveText="BOOTED NOW"
            price={null} eddies={player.eddies} level={player.level} busy={busy}
            onEquip={() => equip.mutate({ shellKey: 'nightcity' })}
          />
        </MktCard>
        {shellItems.map(item => {
          const shellKey = String(item.payload?.shellKey ?? '');
          const equipped = equippedShell === shellKey;
          return (
            <MktCard key={item.key} equipped={equipped}>
              <ShellPreview k={shellKey} />
              <NameRow name={SHELL_META[shellKey]?.name ?? item.name.toUpperCase()} equipped={equipped} owned={item.owned === true} />
              <DescLine text={item.description} />
              <ActionSlot
                equipped={equipped} owned={item.owned === true} liveText="BOOTED NOW"
                price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(item.key)}
                onEquip={() => equip.mutate({ shellKey })}
              />
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- display fonts (ride along under the SHELLS pill) ---- */}
      <MktSection
        show={show('shells')}
        label="DISPLAY FONTS — HEADER TYPEFACE · AUTO-EQUIP ON BUY"
        serial={`${ownCount(fontItems)}/${fontItems.length} OWNED`}
      >
        {fontItems.map(item => {
          const fontKey = String(item.payload?.fontKey ?? '');
          const equipped = player.equippedFont === fontKey;
          return (
            <MktCard key={item.key} equipped={equipped}>
              <div className="panel-inset mkt-prev" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
                <span style={{ fontFamily: FONT_FAMILIES[fontKey] ?? 'var(--font-display)', fontSize: fontKey === 'vt323' ? 22 : 16, letterSpacing: '0.06em', color: 'var(--cyan)' }}>
                  {item.name.toUpperCase()}
                </span>
              </div>
              <NameRow name={item.name} equipped={equipped} owned={item.owned === true} />
              <DescLine text={item.description} />
              <ActionSlot
                equipped={equipped} owned={item.owned === true}
                onRemove={equipped ? () => equip.mutate({ fontKey: null }) : undefined}
                price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(item.key)}
                onEquip={() => equip.mutate({ fontKey })}
              />
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- VISUAL FX (stackable) ---- */}
      <MktSection
        show={show('fx')}
        label="VISUAL FX — AMBIENT OVERLAYS · STACKABLE · TOGGLE ANY TIME"
        serial={`${player.fxActive.length} ONLINE`}
      >
        {fxItems.map(item => {
          const fxKey = String(item.payload?.fxKey ?? '');
          const active = fxActive.has(fxKey);
          const isOwned = item.owned === true;
          return (
            <MktCard key={item.key} equipped={active}>
              <FxPreview k={fxKey} />
              <NameRow name={item.name} active={active} owned={isOwned} />
              <DescLine text={item.description} />
              {isOwned ? (
                <button
                  key={item.key + '-' + (active ? 'off' : 'on')}
                  className="btn" style={{ fontSize: 11, padding: 8 }}
                  disabled={busy}
                  onClick={() => fxToggle.mutate(fxKey)}
                >
                  {active ? 'DISABLE' : 'ENABLE'}
                </button>
              ) : (
                <ActionSlot
                  equipped={false} owned={false}
                  price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                  eddies={player.eddies} busy={busy}
                  onBuy={() => doBuy(item.key)}
                />
              )}
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- CHRONO ---- */}
      <MktSection
        show={show('chrono')}
        label="CHRONO — SESSION TIMER STYLES · SHOWN WHILE JACKED IN"
        serial={`${1 + ownCount(timerItems)}/${1 + timerItems.length} OWNED`}
      >
        {/* STANDARD ISSUE — the free built-in; equipping clears the slot. */}
        <MktCard equipped={equippedChrono === 'standard'}>
          <SessionTimerPreview k="standard" />
          <NameRow name="STANDARD ISSUE" equipped={equippedChrono === 'standard'} owned />
          <DescLine text="Clean mono countdown with a progress rail." />
          <ActionSlot
            equipped={equippedChrono === 'standard'} owned liveText="ON THE CLOCK"
            price={null} eddies={player.eddies} level={player.level} busy={busy}
            onEquip={() => equip.mutate({ timerKey: 'standard' })}
          />
        </MktCard>
        {timerItems.map(item => {
          const timerKey = String(item.payload?.timerKey ?? '');
          const equipped = equippedChrono === timerKey;
          const isLegacyFace = ['flip', 'ring', 'pulse'].includes(timerKey);
          return (
            <MktCard key={item.key} equipped={equipped}>
              {isLegacyFace
                ? <LegacyFacePreview k={timerKey} />
                : <SessionTimerPreview k={timerKey} />}
              <NameRow name={item.name} equipped={equipped} owned={item.owned === true} />
              <DescLine text={item.description} />
              <ActionSlot
                equipped={equipped} owned={item.owned === true} liveText="ON THE CLOCK"
                price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(item.key)}
                onEquip={() => equip.mutate({ timerKey })}
              />
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- HANDLERS ---- */}
      <MktSection
        show={show('handlers')}
        label="HANDLERS — THE VOICE ON YOUR COMMS · TICKER + LEVEL-UPS"
        serial={`${1 + ownCount(personaItems)}/${1 + personaItems.length} OWNED`}
      >
        {/* V1KTOR — the free default voice. */}
        <HandlerCard
          personaKey="fixer" price={null}
          equipped={currentPersona === 'fixer'} owned
          streak={player.currentStreak} level={player.level} eddies={player.eddies} busy={busy}
          onEquip={() => equipPersona.mutate('fixer')}
        />
        {personaItems.map(item => {
          const personaKey = String(item.payload?.personaKey ?? '');
          return (
            <HandlerCard
              key={item.key}
              personaKey={personaKey} price={item.priceEddies} levelReq={item.levelReq}
              equipped={currentPersona === personaKey} owned={item.owned === true}
              streak={player.currentStreak} level={player.level} eddies={player.eddies} busy={busy}
              onBuy={() => doBuy(item.key)}
              onEquip={() => equipPersona.mutate(personaKey)}
              feedback={fb(item.key)}
            />
          );
        })}
      </MktSection>

      {/* ---- TITLES ---- */}
      <MktSection
        show={show('titles')}
        label="TITLES — WORN ON YOUR RUNNER ID"
        serial={`${ownCount(titleItems)}/${titleItems.length} OWNED`}
      >
        {titleItems.map(item => {
          const titleKey = String(item.payload?.titleKey ?? '');
          const name = TITLE_META[titleKey]?.name ?? item.name.toUpperCase();
          const equipped = player.equippedTitle === titleKey;
          return (
            <MktCard key={item.key} equipped={equipped}>
              <div className="panel-inset mkt-prev" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 10px' }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', textAlign: 'center', lineHeight: 1.45, wordBreak: 'break-word' }}>
                  {handle} <span style={{ color: equipped ? 'var(--cyan)' : 'var(--text-dim)' }}>// {name}</span>
                </span>
              </div>
              <NameRow name={name} equipped={equipped} owned={item.owned === true} />
              <DescLine text={item.description} />
              <ActionSlot
                equipped={equipped} owned={item.owned === true}
                onRemove={equipped ? () => equip.mutate({ titleKey: null }) : undefined}
                price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(item.key)}
                onEquip={() => equip.mutate({ titleKey })}
              />
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- DATA PETS ---- */}
      <MktSection
        show={show('pets')}
        label="DATA PETS — LIVE IN YOUR DECK · DO NOTHING · BELOVED"
        serial={`${ownCount(petItems)}/${petItems.length} ADOPTED`}
      >
        {petItems.map(item => {
          const petKey = String(item.payload?.petKey ?? '');
          const pet = PET_META[petKey];
          if (!pet) return null;
          const equipped = player.equippedPet === petKey;
          return (
            <MktCard key={item.key} equipped={equipped}>
              <div className="panel-inset mkt-prev" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
                <div className={'ncx-chip ' + (pet.flicker ? 'pet-flicker' : 'pet-chip')} style={{ width: 38, height: 38, fontSize: 19 }}>
                  {pet.emoji}
                </div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)', lineHeight: 1.6, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-dim)', letterSpacing: '0.16em' }}>{pet.species}</div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pet.status[0]}</div>
                </div>
              </div>
              <NameRow name={pet.name} equipped={equipped} owned={item.owned === true} />
              <ActionSlot
                equipped={equipped} owned={item.owned === true}
                onRemove={equipped ? () => equip.mutate({ petKey: null }) : undefined}
                price={item.priceEddies} levelReq={item.levelReq} level={player.level}
                eddies={player.eddies} busy={busy}
                onBuy={() => doBuy(item.key)}
                onEquip={() => equip.mutate({ petKey })}
              />
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </MktCard>
          );
        })}
      </MktSection>

      {/* ---- SUPPLIES ---- */}
      <MktSection
        show={show('supply')}
        label="SUPPLIES — CONSUMABLES · STOCK UP"
        serial="REPEAT PURCHASE OK"
      >
        {supplyItems.map(item => {
          const count = SUPPLY_COUNT[item.key]?.(player) ?? 0;
          const active = supplyActiveLabel(item.key, player);
          const affordable = player.eddies >= item.priceEddies;
          return (
            <div key={item.key} className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="ncx-chip" style={{ width: 34, height: 34, color: 'var(--cyan)' }}>
                  <Icon name={SUPPLY_ICON[item.key] ?? 'bag'} size={15} />
                </div>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{item.name}</span>
                {active ? (
                  <span className="ncx-stamp flat" style={{ marginLeft: 'auto', color: 'var(--lime)', fontSize: 9.5 }}>{active}</span>
                ) : count > 0 ? (
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>×{count}</span>
                ) : null}
              </div>
              <DescLine text={item.description} />
              {item.soldOut ? (
                <div
                  className="btn"
                  style={{ fontSize: 11, padding: 8, opacity: 0.5, cursor: 'default', color: 'var(--text-faint)', letterSpacing: '0.18em', textAlign: 'center', pointerEvents: 'none' }}
                  aria-disabled="true"
                >
                  SOLD OUT
                </div>
              ) : (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: 8, opacity: affordable ? undefined : 0.45 }}
                  disabled={!affordable || busy}
                  onClick={() => doBuy(item.key)}
                  title={affordable ? undefined : 'Not enough eddies'}
                >
                  <span style={{ color: 'var(--amber)' }}>€${item.priceEddies.toLocaleString()}</span>· BUY
                </button>
              )}
              {fb(item.key) && <FeedbackLine feedback={fb(item.key)!} />}
            </div>
          );
        })}
      </MktSection>
    </div>
  );
}

/* ---------- shared card chrome ---------- */

function MktSection({ label, serial, show, children }: {
  label: string; serial: string; show: boolean; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span className="ncx-serial">{serial}</span>
      </div>
      <div className="mkt-grid">{children}</div>
    </>
  );
}

function MktCard({ equipped, children }: { equipped: boolean; children: React.ReactNode }) {
  return (
    <div className={'panel' + (equipped ? ' hud' : '')} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11 }}>
      {children}
    </div>
  );
}

function NameRow({ name, equipped, owned, active }: {
  name: string; equipped?: boolean; owned?: boolean; active?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span style={{ flex: 1 }} />
      {equipped && <span className="ncx-stamp flat" style={{ color: 'var(--cyan)' }}>LIVE</span>}
      {active && <span className="ncx-stamp flat" style={{ color: 'var(--lime)' }}>ONLINE</span>}
      {!equipped && !active && owned && <span className="ncx-stamp flat" style={{ color: 'var(--text-faint)' }}>OWNED</span>}
    </div>
  );
}

function DescLine({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5, flex: 1 }}>{text}</div>;
}

/**
 * The buy / equip / live action slot shared by every single-equip line.
 * Buttons are KEYED by state (remount, don't morph — see file header).
 */
function ActionSlot({ equipped, owned, liveText, onRemove, price, levelReq, level, eddies, busy, onBuy, onEquip }: {
  equipped: boolean;
  owned: boolean;
  liveText?: string;
  /** Present on removable lines (titles/pets; fonts clear to stock). */
  onRemove?: () => void;
  price: number | null;          // null = free/built-in (never a buy state)
  levelReq?: number;
  level: number;
  eddies: number;
  busy: boolean;
  onBuy?: () => void;
  onEquip?: () => void;
}) {
  if (equipped) {
    return onRemove ? (
      <button key="rm" className="btn" style={{ fontSize: 11, padding: 8 }} disabled={busy} onClick={onRemove}>
        REMOVE
      </button>
    ) : (
      /* Equipped = nothing to press (Polish-Pass §2a): the focal border +
         LIVE stamp already say it — this line is NOT a button. */
      <div key="live" className="mkt-live">▸ {liveText ?? 'RUNNING NOW'}</div>
    );
  }
  if (owned) {
    return (
      <button key="eq" className="btn" style={{ fontSize: 11, padding: 8 }} disabled={busy} onClick={onEquip}>
        EQUIP
      </button>
    );
  }
  if (levelReq && level < levelReq) {
    return (
      <button key="lock" className="btn" style={{ fontSize: 11, padding: 8 }} disabled>
        <Icon name="lock" size={11} /> LVL {levelReq} · €${(price ?? 0).toLocaleString()}
      </button>
    );
  }
  const affordable = price == null || eddies >= price;
  return (
    <button
      key="buy"
      className="btn"
      style={{ fontSize: 11, padding: 8, opacity: affordable ? 1 : 0.45 }}
      disabled={!affordable || busy}
      onClick={onBuy}
      title={affordable ? undefined : 'Not enough eddies'}
    >
      <span style={{ color: 'var(--amber)' }}>€${(price ?? 0).toLocaleString()}</span>· UNLOCK
    </button>
  );
}

/* ---------- previews ---------- */

/** Mini-HUD in the skin's OWN colors: hex chip, progress bar, 3 strips. */
function SkinPreview({ colors }: { colors: [string, string, string] }) {
  return (
    <div className="panel-inset mkt-prev" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120px 60px at 20% 0%, ${colors[0]}22, transparent)` }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{
          width: 14, height: 14, flex: 'none',
          clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
          background: colors[0], boxShadow: `0 0 8px ${colors[0]}`,
        }} />
        <div style={{ flex: 1, height: 5, background: '#0a0b14', boxShadow: 'inset 0 0 0 1px rgba(150,168,224,0.12)' }}>
          <div style={{ width: '62%', height: '100%', background: colors[0], boxShadow: `0 0 8px ${colors[0]}aa` }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {colors.map((c, i) => (
          <span key={i} style={{ flex: 1, height: 4, background: c, opacity: 0.85, boxShadow: `0 0 6px ${c}66` }} />
        ))}
      </div>
    </div>
  );
}

function ShellPreview({ k }: { k: string }) {
  if (k === 'tty') {
    return (
      <div className="mkt-shellprev-tty">
        <div>&gt; mount /vault/local <span style={{ color: '#3fff76' }}>[OK]</span></div>
        <div>&gt; render --chrome=none</div>
        <div>&gt; phosphor locked<span className="cursor-blink">_</span></div>
      </div>
    );
  }
  if (k === 'outrun') {
    return (
      <div className="mkt-shellprev-outrun">
        <span className="sun" />
        <span className="grid" />
      </div>
    );
  }
  return ( /* night city — factory firmware */
    <div className="panel-inset mkt-prev" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
      <div className="ncx-chroma" style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700 }}>NIGHT CITY</div>
      <div className="ncx-bar slim" style={{ width: '70%' }}>
        <i style={{ width: '62%', background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))' }} />
        <span className="seg-mask" />
      </div>
    </div>
  );
}

/** Card-scale mocks for the v1 clock faces (flip / ring / pulse), kept on
 *  sale alongside the v2 CHRONO styles (their live faces are chamber-only). */
function LegacyFacePreview({ k }: { k: string }) {
  let inner: React.ReactNode;
  if (k === 'flip') {
    inner = (
      <div className="mono" style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {['2', '5', ':', '0', '0'].map((ch, i) => ch === ':' ? (
          <span key={i} style={{ color: 'var(--text-faint)', fontSize: 18, fontWeight: 700 }}>:</span>
        ) : (
          <span key={i} style={{
            fontSize: 19, fontWeight: 700, color: 'var(--cyan)', padding: '3px 7px',
            background: 'linear-gradient(180deg, #14162a 0%, #0d0e1c 49%, #090a14 51%, #101224 100%)',
            boxShadow: 'inset 0 0 0 1px var(--line-2)',
            clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
          }}>{ch}</span>
        ))}
      </div>
    );
  } else if (k === 'ring') {
    const C = 2 * Math.PI * 44;
    inner = (
      <div style={{ position: 'relative', width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }} aria-hidden>
          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(var(--accent-rgb),0.18)" strokeWidth="6" />
          <circle cx="50" cy="50" r="44" fill="none" stroke="var(--cyan)" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${0.68 * C} ${C}`} transform="rotate(-90 50 50)" />
        </svg>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--cyan)' }}>25:00</span>
      </div>
    );
  } else {
    // pulse — reuses the live face's heartbeat keyframes (index.css)
    inner = (
      <span className="mono qm-preview-pulse" style={{ fontSize: 21, fontWeight: 700, color: 'var(--cyan)' }}>
        25:00
      </span>
    );
  }
  return (
    <div className="panel-inset mkt-prev" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {inner}
    </div>
  );
}

/* ---------- handler card (terminal-quote preview + tag stamp) ---------- */

function HandlerCard({ personaKey, price, levelReq, equipped, owned, streak, level, eddies, busy, onBuy, onEquip, feedback }: {
  personaKey: string;
  price: number | null;
  levelReq?: number;
  equipped: boolean;
  owned: boolean;
  streak: number;
  level: number;
  eddies: number;
  busy: boolean;
  onBuy?: () => void;
  onEquip: () => void;
  feedback?: Feedback;
}) {
  const meta = PERSONA_META[personaKey];
  if (!meta) return null;
  const [line] = meta.lines({ streak });
  return (
    <MktCard equipped={equipped}>
      <div className="panel-inset" style={{ minHeight: 70, padding: '10px 12px' }}>
        <div className="ncx-term" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
          <span className="cy">{meta.name}&gt;</span> {line}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.13em', whiteSpace: 'nowrap' }}>{meta.name}</span>
        <span className="ncx-stamp flat" style={{ color: 'var(--violet)', fontSize: 8 }}>{meta.tag}</span>
        <span style={{ flex: 1 }} />
        {equipped && <span className="ncx-stamp flat" style={{ color: 'var(--cyan)' }}>LIVE</span>}
        {!equipped && owned && <span className="ncx-stamp flat" style={{ color: 'var(--text-faint)' }}>OWNED</span>}
      </div>
      <DescLine text={meta.desc} />
      <ActionSlot
        equipped={equipped} owned={owned} liveText="ON COMMS"
        price={price} levelReq={levelReq} level={level}
        eddies={eddies} busy={busy}
        onBuy={onBuy} onEquip={onEquip}
      />
      {feedback && <FeedbackLine feedback={feedback} />}
    </MktCard>
  );
}

/* ---------- shared bits ---------- */

/** Inline purchase feedback — loot crates reveal what dropped here. */
function FeedbackLine({ feedback }: { feedback: NonNullable<Feedback> }) {
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
