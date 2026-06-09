/* ============================================================
   FinDash — Mock financial dataset (window.FD_DATA)
   Realistic ~7 months of personal spending, Dec 2025 – Jun 2026
   ============================================================ */
(function () {
  // Category palette (neon)
  const CATS = {
    'Food & Dining':   { color: '#ff2e9a', icon: 'food' },
    'Groceries':       { color: '#43ffa6', icon: 'cart' },
    'Transportation':  { color: '#1ce2ff', icon: 'car' },
    'Shopping':        { color: '#9d6bff', icon: 'bag' },
    'Subscriptions':   { color: '#ffc24b', icon: 'repeat' },
    'Entertainment':   { color: '#ff77c8', icon: 'play' },
    'Bills & Utilities':{ color: '#4d8bff', icon: 'bolt' },
    'Coffee':          { color: '#2ff5d6', icon: 'coffee' },
    'Health':          { color: '#ff4d6d', icon: 'heart' },
    'Travel':          { color: '#ffa14b', icon: 'plane' },
  };

  const MONTHS = ['Dec','Jan','Feb','Mar','Apr','May','Jun'];

  // Monthly totals per category (the "shape" of spending)
  const monthly = [
    // Dec        Jan   Feb   Mar   Apr   May   Jun
    { cat:'Food & Dining',    vals:[742, 681, 658, 712, 690, 734, 421] },
    { cat:'Groceries',        vals:[523, 498, 511, 540, 502, 488, 312] },
    { cat:'Transportation',   vals:[288, 312, 264, 301, 322, 298, 188] },
    { cat:'Shopping',         vals:[612, 388, 421, 502, 366, 470, 240] },
    { cat:'Subscriptions',    vals:[164, 178, 178, 192, 192, 206, 206] },
    { cat:'Entertainment',    vals:[212, 188, 156, 204, 178, 232, 142] },
    { cat:'Bills & Utilities',vals:[418, 402, 438, 396, 388, 412, 410] },
    { cat:'Coffee',           vals:[148, 162, 139, 171, 158, 184, 96]  },
    { cat:'Health',           vals:[120, 90,  240, 60,  180, 75,  40]  },
    { cat:'Travel',           vals:[0,   0,   0,   880, 0,   0,   0]    },
  ];

  const income = [5200, 5200, 5200, 5600, 5200, 5200, 5200];

  // Build category aggregates (full window minus the partial current month bias)
  const categories = monthly.map(m => {
    const total = m.vals.reduce((a,b)=>a+b,0);
    const meta = CATS[m.cat];
    return {
      name: m.cat, color: meta.color, icon: meta.icon,
      total, series: m.vals,
      avg: total / m.vals.length,
    };
  }).sort((a,b)=>b.total-a.total);

  const grandTotal = categories.reduce((a,c)=>a+c.total,0);
  categories.forEach(c => c.pct = c.total / grandTotal);

  // Monthly spend series (sum of all categories per month)
  const monthlySpend = MONTHS.map((mo, i) => ({
    label: mo,
    spent: monthly.reduce((a,m)=>a+m.vals[i],0),
    income: income[i],
  }));
  monthlySpend.forEach(m => m.net = m.income - m.spent);

  // Daily series for current month (Jun, partial — 18 days)
  const daily = (() => {
    const out = [];
    const seed = [38,12,0,64,22,9,140,18,7,55,0,31,82,14,6,120,9,44];
    for (let d=1; d<=18; d++) out.push({ label: 'Jun '+String(d).padStart(2,'0'), spent: seed[d-1] });
    return out;
  })();

  // KPI metrics
  const fullMonths = 6; // Dec–May complete
  const completeSpend = monthlySpend.slice(0,6).reduce((a,m)=>a+m.spent,0);
  const totalSpent = grandTotal;
  const totalIncome = income.reduce((a,b)=>a+b,0);
  const net = totalIncome - totalSpent;
  const avgMonthly = completeSpend / fullMonths;

  // Vendors
  const vendors = [
    { name:'Amazon',        cat:'Shopping',        n:34, total:1284.55 },
    { name:'Whole Foods',   cat:'Groceries',       n:41, total:2118.90 },
    { name:'Starbucks',     cat:'Coffee',          n:58, total:642.18 },
    { name:'DoorDash',      cat:'Food & Dining',   n:29, total:1142.40 },
    { name:'Uber',          cat:'Transportation',  n:37, total:712.65 },
    { name:'Shell',         cat:'Transportation',  n:18, total:686.20 },
    { name:'Netflix',       cat:'Subscriptions',   n:7,  total:160.93 },
    { name:'Spotify',       cat:'Subscriptions',   n:7,  total:83.93 },
    { name:'Target',        cat:'Shopping',        n:16, total:884.12 },
    { name:'Chipotle',      cat:'Food & Dining',   n:22, total:418.66 },
  ];

  // ---- Wasteful-spending patterns (gamified savings) ----
  const patterns = [
    {
      id: 'micro',
      title: 'Micro-leaks',
      tag: 'SMALL · FREQUENT',
      color: '#2ff5d6',
      icon: 'coffee',
      blurb: 'Lots of small charges under $8 that quietly add up.',
      monthly: 184,         // current monthly bleed
      reclaim: 110,         // realistic monthly savings target
      count: 58,
      detail: '58 charges under $8 last month — mostly coffee runs and snack stops. Keeping two days a week brews-at-home reclaims most of it.',
      examples: [
        { who:'Starbucks', amt:6.45, n:18 },
        { who:'Corner Deli', amt:4.20, n:14 },
        { who:'Vending', amt:2.75, n:9 },
      ],
      action: 'Set a $90/mo coffee budget',
    },
    {
      id: 'subs',
      title: 'Subscription stack',
      tag: 'OVERLAP',
      color: '#ffc24b',
      icon: 'repeat',
      blurb: 'Overlapping services you may not all be using.',
      monthly: 206,
      reclaim: 64,
      count: 11,
      detail: '11 active subscriptions. Three are streaming services with overlapping libraries, and two have not been opened in 60+ days.',
      examples: [
        { who:'Netflix', amt:22.99, n:1 },
        { who:'Hulu', amt:17.99, n:1 },
        { who:'Disney+', amt:13.99, n:1 },
      ],
      action: 'Cancel 2 dormant subs',
    },
    {
      id: 'impulse',
      title: 'Late-night impulse',
      tag: 'IMPULSE',
      color: '#ff77c8',
      icon: 'moon',
      blurb: 'Discretionary buys placed after 10pm.',
      monthly: 312,
      reclaim: 140,
      count: 14,
      detail: '14 purchases after 10pm last month, averaging $22 each. Adding a 24-hour wait on non-essentials tends to cancel about half.',
      examples: [
        { who:'Amazon', amt:38.99, n:6 },
        { who:'DoorDash', amt:31.40, n:5 },
        { who:'App Store', amt:9.99, n:3 },
      ],
      action: 'Enable 24h cart cooldown',
    },
    {
      id: 'large',
      title: 'Big discretionary',
      tag: 'LARGE · ONE-OFF',
      color: '#9d6bff',
      icon: 'bag',
      blurb: 'Occasional large non-essential purchases.',
      monthly: 470,
      reclaim: 120,
      count: 4,
      detail: '4 single purchases over $120 last month. Not bad in themselves — but planning them into a monthly "fun fund" smooths the spikes.',
      examples: [
        { who:'Target', amt:184.12, n:1 },
        { who:'Amazon', amt:142.55, n:1 },
        { who:'Best Buy', amt:128.00, n:1 },
      ],
      action: 'Create a $250 fun-fund',
    },
  ];
  const reclaimTotal = patterns.reduce((a,p)=>a+p.reclaim,0);

  // Gamification state
  const game = {
    reclaimTarget: reclaimTotal,         // potential monthly savings
    reclaimedThisMonth: 168,             // already saved vs last month
    streakWeeks: 3,                      // weeks under coffee budget
    streakLabel: 'under coffee budget',
    level: 4,
    levelName: 'Budget Operative',
    xp: 2140,
    xpNext: 3000,
    goals: [
      { name:'Coffee under $90/mo', cur:96, target:90, unit:'$', invert:true },
      { name:'No-spend days', cur:9, target:12, unit:' days' },
      { name:'Reclaim $400/mo', cur:168, target:400, unit:'$' },
    ],
    badges: [
      { name:'First Audit', got:true },
      { name:'3-Week Streak', got:true },
      { name:'Sub Slayer', got:false },
      { name:'Night Owl Tamed', got:false },
    ],
  };

  // ---- Transactions (sample, current + recent) ----
  const TX_VENDORS = {
    'Food & Dining': ['DoorDash','Chipotle','Sweetgreen','Thai Basil','Shake Shack','Local Diner'],
    'Groceries': ['Whole Foods','Trader Joes','Safeway','Costco'],
    'Transportation': ['Uber','Lyft','Shell','Chevron','Transit Card'],
    'Shopping': ['Amazon','Target','Best Buy','Nike','Uniqlo'],
    'Subscriptions': ['Netflix','Spotify','Hulu','Disney+','iCloud','NYT'],
    'Entertainment': ['AMC Theatres','Steam','Concert Tix','Bowling'],
    'Bills & Utilities': ['PG&E','Comcast','AT&T','Water Dept'],
    'Coffee': ['Starbucks','Blue Bottle','Corner Deli','Philz'],
    'Health': ['CVS Pharmacy','Gym','Dentist'],
    'Travel': ['Delta','Airbnb','Hotel'],
  };
  const catNames = Object.keys(CATS);
  function rng(seed){ let s = seed; return () => (s = (s*1664525+1013904223) % 4294967296) / 4294967296; }
  const rand = rng(99);
  const transactions = [];
  let txid = 1000;
  for (let i=0; i<64; i++) {
    const cat = catNames[Math.floor(rand()*catNames.length)];
    const vlist = TX_VENDORS[cat];
    const v = vlist[Math.floor(rand()*vlist.length)];
    const base = { 'Coffee':6, 'Food & Dining':24, 'Groceries':62, 'Transportation':18,
      'Shopping':54, 'Subscriptions':15, 'Entertainment':28, 'Bills & Utilities':120,
      'Health':45, 'Travel':280 }[cat];
    const amt = +(base * (0.5 + rand()*1.4)).toFixed(2);
    const day = 18 - Math.floor(rand()*70);
    const date = new Date(2026, 5, day);
    const hour = Math.floor(rand()*24);
    transactions.push({
      id: 'TX-'+(txid++),
      vendor: v, category: cat, color: CATS[cat].color, icon: CATS[cat].icon,
      amount: amt,
      date: date,
      ts: date.getTime() + hour*3600000,
      hour,
      flagged: (cat==='Coffee' && amt<8) || (hour>=22 && cat!=='Bills & Utilities' && amt>15),
    });
  }
  transactions.sort((a,b)=>b.ts-a.ts);

  window.FD_DATA = {
    CATS, MONTHS, categories, monthlySpend, daily, vendors, patterns, game, transactions,
    metrics: {
      totalSpent, totalIncome, net, avgMonthly,
      // trend vs prior period (mocked)
      spentTrend: -6.2, incomeTrend: +1.4, netTrend: +18.0, avgTrend: -4.1,
      reclaimTotal, fullMonths,
      savingsRate: net/totalIncome,
    },
  };
})();
