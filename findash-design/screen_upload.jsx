/* ============================================================
   FinDash — Upload / Onboarding screen
   ============================================================ */

function UploadScreen({ onLoad }) {
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | scanning
  const [scanLog, setScanLog] = useState([]);
  const inputRef = useRef(null);

  const SCAN_STEPS = [
    'Reading file — bytes never leave this device',
    'Parsing 1,284 transactions',
    'Categorizing vendors',
    'Detecting recurring charges',
    'Surfacing savings opportunities',
    'Building your dashboard',
  ];

  function startScan() {
    setPhase('scanning');
    setScanLog([]);
    SCAN_STEPS.forEach((s, i) => {
      setTimeout(() => setScanLog(l => [...l, s]), 420 * i + 250);
    });
    setTimeout(() => onLoad && onLoad(), 420 * SCAN_STEPS.length + 700);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* top status strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 28px', borderBottom: '1px solid var(--line)',
      }}>
        <Brandmark />
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--lime)' }}>
          <Icon name="lock" size={14} />
          <span style={{ letterSpacing: '0.08em' }}>100% LOCAL · NO SERVER · NO ACCOUNT</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,0.95fr)', gap: 0 }} className="upload-grid">
        {/* LEFT — pitch */}
        <div style={{ padding: 'clamp(32px, 6vw, 84px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 620 }}>
          <Kicker style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--cyan)', boxShadow: 'var(--glow-cyan)' }} />
            PERSONAL FINANCE TERMINAL · v2.0
          </Kicker>
          <h1 style={{ fontSize: 'clamp(34px, 5vw, 56px)', lineHeight: 1.02, letterSpacing: '-0.03em', fontWeight: 600 }}>
            See where your<br />money actually<br />
            <span style={{
              background: 'linear-gradient(90deg, var(--cyan), var(--violet))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>goes.</span>
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: 'var(--text-dim)', maxWidth: 460, marginTop: 22 }}>
            Drop in a statement and FinDash maps every dollar, flags the quiet leaks,
            and turns them into savings you can actually hit. Your data is parsed
            right here in the browser — nothing is uploaded.
          </p>

          <div style={{ display: 'flex', gap: 26, marginTop: 38, flexWrap: 'wrap' }}>
            {[['shield','Processed on-device'], ['zap','Insights in seconds'], ['target','Gamified savings goals']].map(([ic, t]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center',
                  background: 'var(--panel-2)', border: '1px solid var(--line-2)', color: 'var(--cyan)' }}>
                  <Icon name={ic} size={16} />
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — dropzone / scanner */}
        <div style={{ padding: 'clamp(24px, 4vw, 56px)', display: 'flex', alignItems: 'center', borderLeft: '1px solid var(--line)', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, background:
            'radial-gradient(420px 320px at 70% 40%, rgba(28,226,255,0.07), transparent 70%)' }} />
          <div className="panel hud" style={{ width: '100%', padding: 30, position: 'relative', zIndex: 1 }}>
            {phase === 'idle' ? (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); startScan(); }}
                  onClick={startScan}
                  style={{
                    border: `1.5px dashed ${drag ? 'var(--cyan)' : 'var(--line-2)'}`,
                    borderRadius: 'var(--r-lg)', padding: '46px 24px', textAlign: 'center',
                    cursor: 'pointer', transition: 'all .18s',
                    background: drag ? 'rgba(28,226,255,0.06)' : 'var(--bg-2)',
                  }}>
                  <div style={{ width: 62, height: 62, margin: '0 auto 18px', borderRadius: 16, display: 'grid', placeItems: 'center',
                    background: 'linear-gradient(180deg, rgba(28,226,255,0.16), rgba(28,226,255,0.04))',
                    border: '1px solid rgba(28,226,255,0.4)', color: 'var(--cyan)',
                    boxShadow: drag ? '0 0 30px -4px var(--cyan)' : '0 0 20px -8px var(--cyan)' }}>
                    <Icon name="upload" size={26} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                    {drag ? 'Release to analyze' : 'Drop your statement here'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    or <span style={{ color: 'var(--cyan)' }}>browse files</span> — CSV or Excel
                  </div>
                  <input ref={inputRef} type="file" hidden />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  {['.CSV', '.XLSX', '.OFX', '.QFX'].map(f => (
                    <span key={f} className="mono" style={{ fontSize: 11, padding: '5px 9px', borderRadius: 6,
                      background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-faint)' }}>{f}</span>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                  <span className="kicker">or</span>
                  <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                </div>

                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                  onClick={startScan}>
                  <Icon name="spark" size={15} /> Explore with sample data
                </button>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 12, letterSpacing: '0.05em' }}>
                  7 MONTHS · 1,284 TRANSACTIONS · ANONYMIZED
                </div>
              </>
            ) : (
              <ScanView log={scanLog} steps={SCAN_STEPS} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanView({ log, steps }) {
  return (
    <div style={{ padding: '6px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <div style={{ position: 'relative', width: 42, height: 42 }}>
          <Ring value={log.length} max={steps.length} size={42} stroke={4} color="var(--cyan)">
            <Icon name="zap" size={16} style={{ color: 'var(--cyan)' }} />
          </Ring>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Analyzing on-device</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--lime)' }}>● ENCRYPTED · LOCAL ONLY</div>
        </div>
      </div>

      <div className="panel-inset" style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 196 }}>
        {steps.map((s, i) => {
          const done = i < log.length;
          const active = i === log.length;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
              color: done ? 'var(--text)' : active ? 'var(--cyan)' : 'var(--text-ghost)',
              opacity: done || active ? 1 : 0.5, transition: 'all .25s' }}>
              <span style={{ width: 14, flexShrink: 0 }}>
                {done ? <Icon name="check" size={13} style={{ color: 'var(--lime)' }} />
                      : active ? <span className="cursor-blink">▸</span> : '·'}
              </span>
              <span>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Brandmark({ size = 'md' }) {
  const sm = size === 'sm';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: sm ? 26 : 30, height: sm ? 26 : 30 }}>
        <svg width={sm ? 26 : 30} height={sm ? 26 : 30} viewBox="0 0 30 30">
          <rect x="2" y="2" width="26" height="26" rx="7" fill="none" stroke="var(--cyan)" strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 0 4px var(--cyan))' }} />
          <path d="M9 19 L13 13 L17 16 L21 9" fill="none" stroke="var(--cyan)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px var(--cyan))' }} />
          <circle cx="21" cy="9" r="2" fill="var(--magenta)" style={{ filter: 'drop-shadow(0 0 4px var(--magenta))' }} />
        </svg>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: sm ? 16 : 18, letterSpacing: '0.02em' }}>
        FIN<span style={{ color: 'var(--cyan)' }}>DASH</span>
      </div>
    </div>
  );
}

Object.assign(window, { UploadScreen, Brandmark });
