/**
 * AccentPicker — the app-wide accent pick list (Brent's rule: NOWHERE in
 * the app asks the user to type a color hex code; anything colorable gets
 * this same swatch row instead).
 *
 * Presets are the base Night City palette as hex LITERALS (not vars) so a
 * chosen accent stays stable across theme skins and OS shells. '' = AUTO
 * (the caller's default — boss kind color, stock cyan, etc.).
 *
 * A value saved before this picker existed (free-text hex / native color
 * input) may not match any preset — it renders as an extra CUSTOM swatch
 * so the current color stays visible and is never silently dropped.
 */
export const ACCENT_PRESETS: { label: string; value: string }[] = [
  { label: 'CYAN',    value: '#1ce2ff' },
  { label: 'TEAL',    value: '#2ff5d6' },
  { label: 'LIME',    value: '#43ffa6' },
  { label: 'AMBER',   value: '#ffc24b' },
  { label: 'RED',     value: '#ff4d6d' },
  { label: 'MAGENTA', value: '#ff2e9a' },
  { label: 'VIOLET',  value: '#9d6bff' },
  { label: 'BLUE',    value: '#4d8bff' },
  { label: 'PINK',    value: '#ff77c8' },
];

export function AccentPicker({ value, onChange, autoTitle = 'Default' }: {
  value: string;
  onChange: (v: string) => void;
  /** Tooltip for the AUTO chip — what "no explicit color" means here. */
  autoTitle?: string;
}) {
  const isPreset = ACCENT_PRESETS.some(p => p.value === value);
  const swatches = [
    ...ACCENT_PRESETS,
    // Legacy free-hex value → keep it selectable so editing doesn't lose it.
    ...(value && !isPreset ? [{ label: 'CUSTOM', value }] : []),
  ];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} role="radiogroup" aria-label="Accent color">
      <button
        type="button"
        role="radio"
        aria-checked={value === ''}
        title={autoTitle}
        onClick={() => onChange('')}
        className="mono"
        style={{
          height: 24, padding: '0 8px', fontSize: 8.5, letterSpacing: '0.12em',
          background: 'var(--panel-2)', color: value === '' ? 'var(--text)' : 'var(--text-faint)',
          border: value === '' ? '1px solid var(--text-dim)' : '1px solid var(--line-2)',
          cursor: 'pointer',
        }}
      >
        AUTO
      </button>
      {swatches.map(p => (
        <button
          key={p.value}
          type="button"
          role="radio"
          aria-checked={value === p.value}
          title={p.label}
          aria-label={p.label}
          onClick={() => onChange(p.value)}
          style={{
            width: 24, height: 24, flexShrink: 0,
            background: p.value,
            border: value === p.value ? '2px solid var(--text)' : '1px solid color-mix(in srgb, ' + p.value + ' 50%, transparent)',
            boxShadow: value === p.value ? `0 0 10px color-mix(in srgb, ${p.value} 70%, transparent)` : 'none',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}
