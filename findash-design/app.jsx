/* ============================================================
   FinDash — App shell (nav, routing, responsive)
   ============================================================ */

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'cats',     label: 'Categories', icon: 'layers' },
  { id: 'waste',    label: 'Savings', icon: 'target' },
  { id: 'tx',       label: 'Transactions', icon: 'list' },
];

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return (
    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
      {t.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}

function App() {
  const data = window.FD_DATA;
  const [screen, setScreen] = useState('dash'); // dash | upload (import reachable via top-bar icon)
  const [tab, setTab] = useState('overview');
  const goTo = (t) => { setTab(t); window.scrollTo({ top: 0 }); };

  if (screen === 'upload') {
    return <UploadScreen onLoad={() => setScreen('dash')} />;
  }

  const reclaim = data.metrics.reclaimTotal;

  return (
    <div className="app-shell">
      {/* ---- LEFT NAV RAIL (desktop) ---- */}
      <aside className="nav-rail">
        <div style={{ padding: '20px 18px 18px' }}>
          <Brandmark />
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', flex: 1 }}>
          <div className="kicker" style={{ padding: '10px 10px 8px' }}>MENU</div>
          {NAV.map(n => {
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => goTo(n.id)} className={'nav-item' + (active ? ' active' : '')}>
                <Icon name={n.icon} size={17} />
                <span>{n.label}</span>
                {n.id === 'waste' && (
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 5,
                    background: 'rgba(67,255,166,0.14)', color: 'var(--lime)', border: '1px solid rgba(67,255,166,0.3)' }}>
                    {fmtMoney(reclaim)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* privacy footer */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)' }}>
          <div className="panel-inset" style={{ padding: '12px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <Icon name="lock" size={13} style={{ color: 'var(--lime)' }} />
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--lime)', letterSpacing: '0.08em' }}>LOCAL VAULT</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
              Data never leaves this device. Clear anytime.
            </div>
          </div>
        </div>
      </aside>

      {/* ---- MAIN ---- */}
      <main className="main-col">
        {/* top bar */}
        <header className="topbar">
          <div className="mobile-brand"><Brandmark size="sm" /></div>
          <div className="searchbox">
            <Icon name="search" size={15} style={{ color: 'var(--text-faint)' }} />
            <input placeholder="Search transactions, vendors, categories…" />
            <span className="mono kbd">⌘K</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="topbar-meta">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lime)', boxShadow: '0 0 6px var(--lime)' }} className="cursor-blink" />
              <Clock />
            </div>
            <button className="btn btn-ghost icon-btn" title="Notifications"><Icon name="bell" size={17} /></button>
            <button className="btn icon-btn" onClick={() => setScreen('upload')} title="New import"><Icon name="upload" size={16} /></button>
          </div>
        </header>

        {/* content */}
        <div className="content">
          {tab === 'overview' && <OverviewScreen data={data} goTo={goTo} />}
          {tab === 'cats' && (window.CategoriesScreen ? <CategoriesScreen data={data} goTo={goTo} /> : <Stub name="Categories" />)}
          {tab === 'waste' && (window.WasteScreen ? <WasteScreen data={data} goTo={goTo} /> : <Stub name="Savings Missions" />)}
          {tab === 'tx' && (window.TxScreen ? <TxScreen data={data} goTo={goTo} /> : <Stub name="Transactions" />)}
        </div>
      </main>

      {/* ---- MOBILE BOTTOM NAV ---- */}
      <nav className="bottom-nav">
        {NAV.map(n => (
          <button key={n.id} onClick={() => goTo(n.id)} className={'bn-item' + (tab === n.id ? ' active' : '')}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Stub({ name }) {
  return (
    <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
      <div className="mono" style={{ fontSize: 13 }}>{name.toUpperCase()} — COMING ONLINE…</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
