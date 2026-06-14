/**
 * AppShell — the NIGHT CITY deck (design handoff, pixel-faithful).
 *
 * Layout: [ 240px deck | main(topbar / content) ] over a bottom status rail.
 *   - Deck: brand lockup, 5 nav groups (OPS / LIFE / VAULT / PROGRESSION /
 *     SYSTEM), arrow-wedge items, and the runner ID card pinned bottom
 *     (hex level badge, handle, slim segmented XP bar, LVL/streak/eddies).
 *   - Topbar: 3 hairline-divided cells — screen title + DAY serial, compact
 *     live stats (the old handler ticker marquee is retired; the Handler line
 *     lives on the Today page, gated by the AI Calibration toggles), and the
 *     live clock + bell + import button (import survives the redesign here).
 *   - Status rail: uplink (live socket state), vault/ICE status, cleared
 *     count + token counts + serial.
 *
 * All data is bound from shared react-query caches (player / today / handler
 * / antigoals / bosses / settings) so the shell stays live everywhere.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { api } from '../lib/api';
import type {
  PlayerResponse, PlayerSnapshot, TodayResponse,
  AntiGoal, Boss,
} from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { FxLayer, useGlitchBurst } from './FxOverlays';
import { PET_META, TITLE_META, type PetMeta } from '../lib/market';

interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  onUpload: () => void;
  /** Open the FOCUS CHAMBER (arbitrary pomodoro — no preselected target). */
  onJackIn: () => void;
}

type NavItem = [id: string, label: string, icon: string];
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: 'OPS', items: [
    ['today', 'Today', 'target'], ['bosses', 'Bosses', 'flame'],
    ['handler', 'Handler', 'bell'],
  ]},
  { group: 'LIFE', items: [
    ['habits', 'Habits', 'check'], ['operations', 'Operations', 'grid'],
    ['health', 'Health', 'heart'],
    ['media', 'Media', 'play'], ['social', 'Social', 'flag'],
  ]},
  { group: 'VAULT', items: [
    ['overview', 'Finance', 'wallet'], ['budgets', 'Budgets', 'gauge'],
    ['bills', 'Bills', 'clock'], ['savings', 'Savings', 'trend'],
  ]},
  { group: 'PROGRESSION', items: [
    ['progress', 'Street Cred', 'trophy'], ['shop', 'Shop', 'bag'],
  ]},
  { group: 'SYSTEM', items: [
    ['calibration', 'Calibration', 'bolt'],
  ]},
];

/** The four tabs pinned to the mobile bottom nav (everything else → MORE). */
const PINNED_TABS: string[] = ['today', 'habits', 'operations', 'health'];

const SCREEN_TITLES: Record<string, string> = {
  today: 'TODAY // DAY PLAN', bosses: 'OPS // BOSS FIGHTS', handler: 'OPS // HANDLER',
  habits: 'LIFE // HABITS',
  health: 'LIFE // HEALTH', operations: 'LIFE // OPERATIONS', media: 'LIFE // BRAINDANCE',
  social: 'LIFE // CREW',
  progress: 'PROGRESS // STREET CRED',
  shop: 'SHOP // NIGHT MARKET',
  overview: 'VAULT // FINANCE', budgets: 'VAULT // BUDGETS',
  bills: 'VAULT // BILLS', savings: 'VAULT // SAVINGS',
  calibration: 'SYS // CALIBRATION',
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
      {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
    </span>
  );
}

/**
 * PetWidget — the equipped data pet, living above the runner ID card
 * (Night Market v2 handoff). 32px emoji chip with a 2.6s bob (NULL also
 * flickers ~1 frame every 7s), name // SPECIES, and a rotating status
 * line (7s interval) ending in a blinking cursor. Emoji are allowed ONLY
 * inside gradient .ncx-chip containers (brand rule).
 */
function PetWidget({ pet }: { pet: PetMeta }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(x => x + 1), 7000);
    return () => clearInterval(id);
  }, []);
  const status = pet.status[i % pet.status.length];
  return (
    <div className="pet-card">
      <div className={'ncx-chip ' + (pet.flicker ? 'pet-flicker' : 'pet-chip')} style={{ width: 32, height: 32, fontSize: 16 }}>
        {pet.emoji}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em' }}>
          {pet.name} <span style={{ color: 'var(--text-ghost)' }}>// {pet.species}</span>
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {status}<span className="cursor-blink" style={{ color: 'var(--cyan)' }}>_</span>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ activeTab, onTabChange, children, onUpload, onJackIn }: AppShellProps) {
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const [uplink, setUplink] = useState(true);
  // Mobile MORE sheet (polish pass §3a): full-deck glass overlay.
  const [moreOpen, setMoreOpen] = useState(false);

  const playerQ = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<PlayerResponse>('/api/player').then(r => r.player),
  });
  const todayQ = useQuery({
    queryKey: ['quests', 'today'],
    queryFn: () => api.get<TodayResponse>('/api/quests/today'),
  });
  const iceQ = useQuery({
    queryKey: ['antigoals'],
    queryFn: () => api.get<{ antigoals: AntiGoal[] }>('/api/antigoals').then(r => r.antigoals),
    staleTime: 5 * 60_000,
  });
  const bossQ = useQuery({
    queryKey: ['bosses'],
    queryFn: () => api.get<{ bosses: Boss[] }>('/api/bosses').then(r => r.bosses),
    staleTime: 5 * 60_000,
  });

  // Live shell: socket state drives the UPLINK light. (The handler feed
  // lives on the Today page now — no ticker here.)
  useEffect(() => {
    const s = getSocket();
    if (!s) { setUplink(false); return; }
    setUplink(s.connected);
    const on = () => setUplink(true);
    const off = () => setUplink(false);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => { s.off('connect', on); s.off('disconnect', off); };
  }, [qc]);

  const p: PlayerSnapshot | undefined = playerQ.data;
  const today = todayQ.data;
  const handle = (user?.name || user?.email?.split('@')[0] || 'RUNNER').toUpperCase();
  const xpPct = p ? Math.min(100, (p.xpIntoLevel / Math.max(1, p.xpForNextLevel)) * 100) : 0;
  const streak = p?.currentStreak ?? 0;
  const activeIce = (iceQ.data ?? []).filter(a => a.isActive).length;
  const topBoss = (bossQ.data ?? []).find(b => b.status === 'active');

  // Night Market v2 gear on the shell: equipped title (runner ID), data pet
  // (deck companion), stackable visual FX (+ the GLITCH PROTOCOL burst).
  const equippedTitle = p?.equippedTitle ? TITLE_META[p.equippedTitle] ?? null : null;
  const equippedPet = p?.equippedPet ? PET_META[p.equippedPet] ?? null : null;
  const fxActive = p?.fxActive ?? [];
  const burst = useGlitchBurst(fxActive);

  return (
    <div className={'app-shell' + (burst ? ' fx-burst' : '')}>
      <div className="ncx-shell">
        {/* ---- DECK ---- */}
        <aside className="ncx-deck">
          <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="ncx-hex" style={{ width: 34, height: 34, fontSize: 13 }}>Q</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '0.02em' }}>
                QUEST<span className="ncx-chroma" style={{ color: 'var(--cyan)' }}>MAN</span>
              </div>
              <div className="ncx-serial">SYS 2.4.0 // NC-077</div>
            </div>
          </div>
          <nav>
            {NAV_GROUPS.map(g => (
              <div key={g.group}>
                <div className="ncx-deck-group">{g.group}<i /></div>
                {g.items.map(([id, label, icon]) => (
                  <button
                    key={id}
                    className={'ncx-deck-item' + (activeTab === id ? ' active' : '')}
                    onClick={() => onTabChange(id)}
                  >
                    <Icon name={icon} size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {/* Data pet — the deck companion lives just above the ID card. */}
          {equippedPet && <PetWidget pet={equippedPet} />}
          {/* Runner ID card — an equipped vanity title replaces RUNNER-01. */}
          <div className="ncx-id">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="ncx-hex" style={{ width: 34, height: 34, fontSize: 13 }}>{p?.level ?? '—'}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {handle} <span style={{ color: equippedTitle ? 'var(--cyan)' : 'var(--text-ghost)' }}>// {equippedTitle ? equippedTitle.name : 'RUNNER-01'}</span>
                </div>
                <div className="ncx-bar slim" style={{ marginTop: 6 }}>
                  <i style={{ width: `${xpPct}%`, background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))' }} />
                  <span className="seg-mask" />
                </div>
              </div>
            </div>
            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.14em', marginTop: 7 }}>
              <span>LVL {p?.level ?? '—'}</span>
              <span style={{ color: 'var(--lime)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name="flame" size={10} /> {streak}D
              </span>
              <span style={{ color: 'var(--amber)' }}>
                €${p ? (p.eddies >= 1000 ? (p.eddies / 1000).toFixed(1) + 'K' : p.eddies) : '—'}
              </span>
              <button
                onClick={logout}
                title="Jack out (sign off)"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-ghost)', padding: 0, display: 'inline-flex' }}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          </div>
        </aside>

        {/* ---- MAIN ---- */}
        <main className="main-col">
          <header className="ncx-topbar">
            <div className="mobile-brand">
              <div className="ncx-hex" style={{ width: 28, height: 28, fontSize: 11 }}>Q</div>
            </div>
            <div className="ncx-topcell cell-title">
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--cyan)' }}>
                ▮ {SCREEN_TITLES[activeTab] || activeTab.toUpperCase()}
              </span>
              <span className="ncx-serial">DAY {streak}</span>
            </div>
            {/* Live HUD stats (the handler feed lives on the Today page now). */}
            <div className="ncx-topcell" style={{ flex: 1, minWidth: 0, gap: 22, overflow: 'hidden' }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                STREAK <span style={{ color: 'var(--lime)' }}>{streak}D</span>
              </span>
              {today && (
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  XP <span style={{ color: 'var(--lime)' }}>+{today.xpEarned}</span> · {today.xpAvailable} OPEN
                </span>
              )}
              {p && (
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  €$<span style={{ color: 'var(--amber)' }}>{p.eddies.toLocaleString()}</span>
                </span>
              )}
              {topBoss && (
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  TGT <span style={{ color: 'var(--magenta)' }}>{topBoss.name.toUpperCase()} {topBoss.pct}%</span>
                </span>
              )}
            </div>
            <div className="ncx-topcell" style={{ borderRight: 'none', gap: 14 }}>
              <span
                className="cursor-blink"
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: uplink ? 'var(--lime)' : 'var(--red)',
                  boxShadow: `0 0 6px ${uplink ? 'var(--lime)' : 'var(--red)'}`,
                }}
              />
              <Clock />
              {/* Jack in from anywhere — demoted to a ghost icon (polish
                  pass §1c): the glowing CTA lives on Today's chamber strip;
                  global access survives without competing with it. */}
              <button
                className="btn btn-ghost icon-btn"
                onClick={onJackIn}
                title="Jack in — open the focus chamber"
              >
                <Icon name="zap" size={15} />
              </button>
              <button className="btn btn-ghost icon-btn" onClick={onUpload} title="Import transactions (CSV/XLSX)">
                <Icon name="upload" size={15} />
              </button>
              <button
                className={'btn btn-ghost icon-btn' + (activeTab === 'handler' ? ' active' : '')}
                onClick={() => onTabChange('handler')}
                title="Open the Handler feed"
                aria-label="Open the Handler feed"
              >
                <Icon name="bell" size={15} />
              </button>
            </div>
          </header>
          <div className="content">
            {children}
          </div>
        </main>
      </div>

      {/* ---- STATUS RAIL ---- */}
      <footer className="ncx-statusbar">
        <span className={uplink ? 'lit' : ''} style={uplink ? undefined : { color: 'var(--red)' }}>
          ● UPLINK {uplink ? 'STABLE' : 'DOWN'}
        </span>
        <span>LOCAL VAULT · ENCRYPTED</span>
        <span>{activeIce > 0 ? `ICE: ${activeIce} ACTIVE` : 'ICE: NONE DETECTED'}</span>
        <span style={{ marginLeft: 'auto' }}>
          CLEARED {today ? `${today.completedCount}/${today.totalCount}` : '—'}
        </span>
        <span>SKIPS ×{p?.skipTokens ?? 0}</span>
        <span>REROLL ×{p?.rerollTokens ?? 0}</span>
        {(p?.streakShields ?? 0) > 0 && <span style={{ color: 'var(--teal)' }}>SHIELD ×{p!.streakShields}</span>}
        {fxActive.length > 0 && <span>FX ×{fxActive.length}</span>}
        <span className="ncx-serial">QTM//{String(streak).padStart(3, '0')}.076</span>
      </footer>

      {/* Night Market v2 visual FX — stackable ambient overlays (z-30,
          pointer-events none) + the GLITCH PROTOCOL burst veil. */}
      <FxLayer fxActive={fxActive} />

      {/* MORE sheet — glass overlay exposing the FULL deck on mobile
          (polish pass §3a). Reuses NAV_GROUPS verbatim so the sheet can
          never drift out of sync with the desktop deck. */}
      {moreOpen && (
        <>
          <div className="qm-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="qm-sheet">
            <div className="qm-sheet-handle" />
            {NAV_GROUPS.map(g => (
              <div key={g.group}>
                <div className="ncx-deck-group">{g.group}<i /></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '6px 0 12px' }}>
                  {g.items.map(([id, label, icon]) => (
                    <button
                      key={id}
                      className={'qm-sheet-cell' + (activeTab === id ? ' active' : '')}
                      onClick={() => { onTabChange(id); setMoreOpen(false); }}
                    >
                      <Icon name={icon} size={18} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* MOBILE BOTTOM NAV — 4 pinned tabs + MORE (the full deck). */}
      <nav className="bottom-nav">
        {([['today', 'Today', 'target'], ['habits', 'Habits', 'check'], ['operations', 'Ops', 'grid'], ['health', 'Health', 'heart']] as NavItem[]).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => { onTabChange(id); setMoreOpen(false); }}
            className={`bn-item${activeTab === id && !moreOpen ? ' active' : ''}`}
          >
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
        <button
          onClick={() => setMoreOpen(o => !o)}
          className={`bn-item${moreOpen || !PINNED_TABS.includes(activeTab) ? ' active' : ''}`}
        >
          <Icon name="list" size={20} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
