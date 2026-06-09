interface BrandmarkProps {
  size?: 'sm' | 'md';
}

export function Brandmark({ size = 'md' }: BrandmarkProps) {
  const isSmall = size === 'sm';
  
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: isSmall ? 8 : 10,
      fontFamily: 'var(--font-display)',
      fontWeight: 700
    }}>
      <div style={{
        width: isSmall ? 26 : 32,
        height: isSmall ? 26 : 32,
        borderRadius: isSmall ? 6 : 8,
        background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--glow-cyan)',
        position: 'relative'
      }}>
        <div style={{
          width: isSmall ? 14 : 18,
          height: isSmall ? 14 : 18,
          background: 'var(--bg)',
          borderRadius: 2,
          position: 'relative'
        }}>
          <div style={{
            position: 'absolute',
            top: 2,
            left: 2,
            right: 2,
            height: 1,
            background: 'var(--cyan)'
          }} />
          <div style={{
            position: 'absolute',
            bottom: 2,
            left: 2,
            right: 2,
            height: 1,
            background: 'var(--violet)'
          }} />
        </div>
      </div>
      <div style={{
        fontSize: isSmall ? 16 : 19,
        color: 'var(--text)',
        letterSpacing: '-0.02em'
      }}>
        Quest<span style={{ color: 'var(--cyan)' }}>man</span>
      </div>
    </div>
  );
}