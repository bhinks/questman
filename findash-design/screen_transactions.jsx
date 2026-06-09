/* ============================================================
   FinDash — Transactions (app-like list, inline edit, filters)
   ============================================================ */

function TxScreen({ data, goTo }) {
  const allCats = data.categories.map(c => c.name);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState(new Set());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [overrides, setOverrides] = useState({}); // id -> new category
  const [editing, setEditing] = useState(null);
  const [limit, setLimit] = useState(14);

  // apply category overrides
  const txs = useMemo(() => data.transactions.map(t => {
    const oc = overrides[t.id];
    if (oc) { const meta = data.CATS[oc]; return { ...t, category: oc, color: meta.color, icon: meta.icon }; }
    return t;
  }), [overrides]);

  const filtered = useMemo(() => {
    let r = txs.filter(t => {
      if (flaggedOnly && !t.flagged) return false;
      if (catFilter.size && !catFilter.has(t.category)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.vendor.toLowerCase().includes(q) && !t.category.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    r = [...r].sort((a, b) => {
      let av, bv;
      if (sort.key === 'amount') { av = a.amount; bv = b.amount; }
      else if (sort.key === 'vendor') { av = a.vendor; bv = b.vendor; }
      else { av = a.ts; bv = b.ts; }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [txs, search, catFilter, flaggedOnly, sort]);

  const shown = filtered.slice(0, limit);
  const flaggedCount = txs.filter(t => t.flagged).length;
  const sumShown = filtered.reduce((a, t) => a + t.amount, 0);

  function toggleCat(c) {
    setCatFilter(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
    setLimit(14);
  }
  function setSortKey(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }
  const hasFilters = search || catFilter.size || flaggedOnly;

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHead index="" sub="LEDGER" title="Transactions"
        right={<div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {fmtNum(filtered.length)} ROWS · {fmtMoney(sumShown)}</div>} />

      {/* CONTROL BAR */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="searchbox" style={{ flex: 1, minWidth: 220, maxWidth: 'none' }}>
            <Icon name="search" size={15} style={{ color: 'var(--text-faint)' }} />
            <input placeholder="Search vendor or category…" value={search}
              onChange={e => { setSearch(e.target.value); setLimit(14); }} />
            {search && <button className="btn-ghost" style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
              onClick={() => setSearch('')}><Icon name="close" size={14} /></button>}
          </div>
          <button onClick={() => { setFlaggedOnly(f => !f); setLimit(14); }} className="btn"
            style={flaggedOnly ? { borderColor: 'var(--amber)', color: 'var(--amber)', background: 'rgba(255,194,75,0.12)' } : {}}>
            <Icon name="flag" size={14} /> Flagged
            <span className="mono" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4,
              background: 'rgba(255,194,75,0.18)', color: 'var(--amber)' }}>{flaggedCount}</span>
          </button>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', padding: 4, borderRadius: 9, border: '1px solid var(--line)' }}>
            {[['date', 'DATE'], ['amount', 'AMT'], ['vendor', 'A–Z']].map(([k, l]) => (
              <button key={k} onClick={() => setSortKey(k)} className="mono"
                style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', border: 'none',
                  display: 'flex', alignItems: 'center', gap: 4, letterSpacing: '0.05em',
                  background: sort.key === k ? 'var(--panel-hi)' : 'transparent',
                  color: sort.key === k ? 'var(--cyan)' : 'var(--text-faint)' }}>
                {l}{sort.key === k && <Icon name={sort.dir === 'asc' ? 'arrowUp' : 'arrowDn'} size={11} stroke={2.4} />}
              </button>
            ))}
          </div>
        </div>

        {/* category filter chips */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 13 }}>
          {data.categories.map(c => {
            const on = catFilter.has(c.name);
            return (
              <button key={c.name} onClick={() => toggleCat(c.name)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20,
                  cursor: 'pointer', fontSize: 11.5, transition: 'all .15s', fontFamily: 'var(--font-ui)',
                  background: on ? c.color + '1f' : 'var(--panel-2)',
                  border: `1px solid ${on ? c.color + '66' : 'var(--line)'}`,
                  color: on ? '#fff' : 'var(--text-dim)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color }} />
                {c.name}
              </button>
            );
          })}
        </div>

        {/* active filter breadcrumb */}
        {hasFilters && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--line)' }}>
            <span className="kicker">ACTIVE</span>
            {search && <FilterPill label={`"${search}"`} onClear={() => setSearch('')} />}
            {flaggedOnly && <FilterPill label="flagged" color="var(--amber)" onClear={() => setFlaggedOnly(false)} />}
            {[...catFilter].map(c => <FilterPill key={c} label={c} onClear={() => toggleCat(c)} />)}
            <button onClick={() => { setSearch(''); setCatFilter(new Set()); setFlaggedOnly(false); }}
              className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>
              CLEAR ALL
            </button>
          </div>
        )}
      </div>

      {/* TX LIST */}
      <div className="panel" style={{ padding: 8 }}>
        {shown.length === 0 ? (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>
            <Icon name="search" size={28} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 12, fontSize: 13 }}>No transactions match these filters.</div>
          </div>
        ) : shown.map(t => (
          <TxRow key={t.id} t={t} allCats={allCats} cats={data.CATS}
            editing={editing === t.id} onEdit={() => setEditing(editing === t.id ? null : t.id)}
            onReassign={(c) => { setOverrides(o => ({ ...o, [t.id]: c })); setEditing(null); }} />
        ))}
      </div>

      {limit < filtered.length && (
        <button className="btn" style={{ alignSelf: 'center', padding: '11px 22px' }}
          onClick={() => setLimit(l => l + 14)}>
          <Icon name="chevD" size={15} /> Load {Math.min(14, filtered.length - limit)} more
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>({filtered.length - limit} left)</span>
        </button>
      )}
    </div>
  );
}

function TxRow({ t, allCats, cats, editing, onEdit, onReassign }) {
  const date = t.date;
  const dstr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const tstr = String(t.hour).padStart(2, '0') + ':00';
  const late = t.hour >= 22 || t.hour < 5;
  return (
    <div style={{ position: 'relative', borderRadius: 11, transition: 'background .12s',
      background: editing ? 'var(--panel-2)' : 'transparent' }}
      onMouseEnter={e => { if (!editing) e.currentTarget.style.background = 'var(--panel-2)'; }}
      onMouseLeave={e => { if (!editing) e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px' }}>
        {/* icon */}
        <span style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0,
          background: t.color + '18', border: `1px solid ${t.color}33`, color: t.color }}>
          <Icon name={t.icon} size={17} />
        </span>
        {/* vendor + cat */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.vendor}</span>
            {t.flagged && (
              <span title="Flagged as a savings opportunity" style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 9.5, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.08em',
                background: 'rgba(255,194,75,0.14)', color: 'var(--amber)', border: '1px solid rgba(255,194,75,0.3)' }}>
                <Icon name="flag" size={9} /> {late ? 'LATE-NIGHT' : 'MICRO'}
              </span>
            )}
          </div>
          <button onClick={onEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: t.color }} />
            <span style={{ fontSize: 11.5 }}>{t.category}</span>
            <Icon name="edit" size={11} style={{ color: 'var(--text-ghost)' }} />
          </button>
        </div>
        {/* date */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{dstr}</div>
          <div className="mono" style={{ fontSize: 10.5, color: late ? 'var(--amber)' : 'var(--text-faint)', marginTop: 2 }}>{tstr}</div>
        </div>
        {/* amount */}
        <div className="mono" style={{ fontSize: 15, fontWeight: 600, width: 92, textAlign: 'right', flexShrink: 0 }}>
          {fmtMoneyC(t.amount)}
        </div>
      </div>

      {/* inline reassign */}
      {editing && (
        <div className="fade-up" style={{ padding: '0 14px 14px 66px' }}>
          <div className="panel-inset" style={{ padding: 12 }}>
            <div className="kicker" style={{ marginBottom: 10 }}>RE-CATEGORIZE</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {allCats.map(c => {
                const meta = cats[c];
                const on = c === t.category;
                return (
                  <button key={c} onClick={() => onReassign(c)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8,
                      cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)', transition: 'all .12s',
                      background: on ? meta.color + '22' : 'var(--panel-2)',
                      border: `1px solid ${on ? meta.color + '66' : 'var(--line)'}`,
                      color: on ? '#fff' : 'var(--text-dim)' }}>
                    <Icon name={meta.icon} size={13} style={{ color: meta.color }} /> {c}
                    {on && <Icon name="check" size={12} style={{ color: meta.color }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, color = 'var(--cyan)', onClear }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px', borderRadius: 7,
      background: 'var(--panel-2)', border: `1px solid ${color}44`, fontSize: 11.5, color: 'var(--text)' }}>
      {label}
      <button onClick={onClear} style={{ display: 'grid', placeItems: 'center', background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--text-faint)', padding: 0 }}><Icon name="close" size={12} /></button>
    </span>
  );
}

Object.assign(window, { TxScreen, TxRow, FilterPill });
