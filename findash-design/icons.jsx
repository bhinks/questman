/* ============================================================
   FinDash — Icon set (stroke, currentColor)
   <Icon name="..." size={18} />
   ============================================================ */
const ICON_PATHS = {
  // nav
  grid:    'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  layers:  'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  target:  'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0 M12 12h.01',
  list:    'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  // categories
  food:    'M4 3v7a3 3 0 0 0 3 3v8M7 3v6M5 3v6M19 3c-1.5 0-3 2-3 6 0 2 1 3 2 3v9',
  cart:    'M5 6h16l-2 9H7L5 6zM5 6L4 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  car:     'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11M5 11h14v5H5zM5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01',
  bag:     'M6 7h12l1 13H5L6 7zM9 7V5a3 3 0 0 1 6 0v2',
  repeat:  'M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4',
  play:    'M5 4l14 8-14 8V4z',
  bolt:    'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  coffee:  'M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zM17 9h2.5a2.5 2.5 0 0 1 0 5H17M8 2c-.5 1 .5 2 0 3M12 2c-.5 1 .5 2 0 3',
  heart:   'M12 20s-7-4.5-9.5-9A4.5 4.5 0 0 1 12 5a4.5 4.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z',
  plane:   'M10 3l3 9 7 3-2 3-6-2-1 5-2 1-1-6-6-1 1-2 5 1 3-1L7 5l3-2z',
  moon:    'M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z',
  // ui
  upload:  'M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  file:    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  lock:    'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3',
  shield:  'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  check:   'M5 12l4 4L19 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDn: 'M12 5v14M6 13l6 6 6-6',
  search:  'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-4.3-4.3',
  filter:  'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  close:   'M6 6l12 12M18 6L6 18',
  chevR:   'M9 6l6 6-6 6',
  chevD:   'M6 9l6 6 6-6',
  edit:    'M16 4l4 4L8 20H4v-4L16 4z',
  trophy:  'M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 18h6M10 14v4M14 14v4M8 21h8',
  flame:   'M12 22a7 7 0 0 0 7-7c0-4-3-6-3-9-2 1-3 3-3 5-1-1-1.5-2.5-1-4-3 2-5 5-5 8a7 7 0 0 0 5 7z',
  spark:   'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  bell:    'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  trend:   'M3 17l6-6 4 4 8-8M21 7v5M21 7h-5',
  wallet:  'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l1-3h12l1 3M17 13h.01',
  eye:     'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  flag:    'M5 21V4M5 4h11l-2 4 2 4H5',
  download:'M12 4v12M7 11l5 5 5-5M4 20h16',
  plus:    'M12 5v14M5 12h14',
  zap:     'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  clock:   'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3 2',
};

function Icon({ name, size = 18, stroke = 1.6, fill = false, style, className }) {
  const d = ICON_PATHS[name] || ICON_PATHS.spark;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true">
      {d.split(' M').map((seg, i) => (
        <path key={i} d={(i ? 'M' : '') + seg} />
      ))}
    </svg>
  );
}

Object.assign(window, { Icon, ICON_PATHS });
