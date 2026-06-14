// handler-shell.jsx — Icon (ported from the app) + a faithful static AppShell
// so the consolidated HANDLER page reads in-context. Net + Debrief are gone
// from the deck, replaced by a single Handler entry. Values from QM_HANDLER.PLAYER.

const ICON_PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  target: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0 M12 12h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bag: 'M6 7h12l1 13H5L6 7zM9 7V5a3 3 0 0 1 6 0v2',
  repeat: 'M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4',
  play: 'M5 4l14 8-14 8V4z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  coffee: 'M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zM17 9h2.5a2.5 2.5 0 0 1 0 5H17M8 2c-.5 1 .5 2 0 3M12 2c-.5 1 .5 2 0 3',
  heart: 'M12 20s-7-4.5-9.5-9A4.5 4.5 0 0 1 12 5a4.5 4.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z',
  moon: 'M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  check: 'M5 12l4 4L19 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDn: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M16 4l4 4L8 20H4v-4L16 4z',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 18h6M10 14v4M14 14v4M8 21h8',
  flame: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-3-9-2 1-3 3-3 5-1-1-1.5-2.5-1-4-3 2-5 5-5 8a7 7 0 0 0 5 7z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  trend: 'M3 17l6-6 4 4 8-8M21 7v5M21 7h-5',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l1-3h12l1 3M17 13h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3 2',
};

function Icon({ name, size = 18, stroke = 1.6, fill = false, style, className }) {
  const d = ICON_PATHS[name] || ICON_PATHS.spark;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  );
}
window.Icon = Icon;

const NAV_GROUPS = [
  { group: 'OPS', items: [['today', 'Today', 'target'], ['chains', 'Questlines', 'repeat'], ['bosses', 'Bosses', 'flame'], ['ice', 'ICE', 'shield']] },
  { group: 'LIFE', items: [['habits', 'Habits', 'check'], ['chores', 'Chores', 'list'], ['workouts', 'Workouts', 'spark'], ['projects', 'Projects', 'grid'], ['media', 'Media', 'play'], ['vitals', 'Vitals', 'heart'], ['social', 'Social', 'flag']] },
  { group: 'VAULT', items: [['overview', 'Finance', 'wallet'], ['categories', 'Categories', 'layers'], ['budgets', 'Budgets', 'target'], ['transactions', 'Transactions', 'list']] },
  { group: 'PROGRESSION', items: [['progress', 'Progress', 'layers'], ['achievements', 'Street Cred', 'trophy'], ['shop', 'Shop', 'bag'], ['handler', 'Handler', 'bell']] },
];

function ShellClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const pad = n => String(n).padStart(2, '0');
  return <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>;
}

function AppShell({ children }) {
  const p = window.QM_HANDLER.PLAYER;
  const active = 'handler';
  const xpPct = Math.min(100, (p.xpIntoLevel / p.xpForNextLevel) * 100);
  const eddies = p.eddies >= 1000 ? (p.eddies / 1000).toFixed(1) + 'K' : p.eddies;

  return (
    <div className="app-shell">
      <div className="ncx-shell">
        <aside className="ncx-deck">
          <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="ncx-hex" style={{ width: 34, height: 34, fontSize: 13 }}>Q</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '0.02em' }}>QUEST<span className="ncx-chroma" style={{ color: 'var(--cyan)' }}>MAN</span></div>
              <div className="ncx-serial">SYS 2.4.0 // NC-077</div>
            </div>
          </div>
          <nav>
            {NAV_GROUPS.map(g => (
              <div key={g.group}>
                <div className="ncx-deck-group">{g.group}<i /></div>
                {g.items.map(([id, label, icon]) => (
                  <button key={id} className={'ncx-deck-item' + (active === id ? ' active' : '')}>
                    <Icon name={icon} size={15} /><span>{label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="ncx-id">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="ncx-hex" style={{ width: 34, height: 34, fontSize: 13 }}>{p.level}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.handle} <span style={{ color: 'var(--text-ghost)' }}>// RUNNER-01</span></div>
                <div className="ncx-bar slim" style={{ marginTop: 6 }}>
                  <i style={{ width: xpPct + '%', background: 'linear-gradient(90deg, var(--cyan-deep), var(--cyan))' }} />
                  <span className="seg-mask" />
                </div>
              </div>
            </div>
            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.14em', marginTop: 7 }}>
              <span>LVL {p.level}</span>
              <span style={{ color: 'var(--lime)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="flame" size={10} /> {p.streak}D</span>
              <span style={{ color: 'var(--amber)' }}>€${eddies}</span>
              <span style={{ color: 'var(--text-ghost)', display: 'inline-flex' }}><Icon name="close" size={10} /></span>
            </div>
          </div>
        </aside>

        <main className="main-col">
          <header className="ncx-topbar">
            <div className="mobile-brand"><div className="ncx-hex" style={{ width: 28, height: 28, fontSize: 11 }}>Q</div></div>
            <div className="ncx-topcell cell-title">
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--cyan)' }}>▮ PROGRESS // HANDLER</span>
              <span className="ncx-serial">DAY {p.streak}</span>
            </div>
            <div className="ncx-topcell" style={{ flex: 1, minWidth: 0, gap: 22, overflow: 'hidden' }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>STREAK <span style={{ color: 'var(--lime)' }}>{p.streak}D</span></span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>XP <span style={{ color: 'var(--lime)' }}>+80</span> · 240 OPEN</span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>€$<span style={{ color: 'var(--amber)' }}>{p.eddies.toLocaleString()}</span></span>
            </div>
            <div className="ncx-topcell" style={{ borderRight: 'none', gap: 14 }}>
              <span className="cursor-blink" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lime)', boxShadow: '0 0 6px var(--lime)' }} />
              <ShellClock />
              <button className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 10.5 }}><Icon name="zap" size={12} /> JACK IN</button>
              <button className="btn btn-ghost icon-btn"><Icon name="upload" size={15} /></button>
              <Icon name="bell" size={15} style={{ color: 'var(--text-dim)' }} />
            </div>
          </header>
          <div className="content">{children}</div>
        </main>
      </div>

      <footer className="ncx-statusbar">
        <span className="lit">● UPLINK STABLE</span>
        <span>LOCAL VAULT · ENCRYPTED</span>
        <span>ICE: NONE DETECTED</span>
        <span style={{ marginLeft: 'auto' }}>CLEARED 6/9</span>
        <span>SKIPS ×{p.skipTokens}</span>
        <span>REROLL ×{p.rerollTokens}</span>
        <span style={{ color: 'var(--teal)' }}>SHIELD ×{p.streakShields}</span>
        <span className="ncx-serial">QTM//{String(p.streak).padStart(3, '0')}.076</span>
      </footer>
    </div>
  );
}
window.AppShell = AppShell;
