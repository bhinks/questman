# Questman — Design System

A portable spec of Questman's realized visual language, extracted from the live app (`web/src/index.css` + component conventions). Hand this to a design tool (e.g. Claude Design) to generate new screens/components that look native to the app.

> **Vibe in one line:** a **cyberpunk life-terminal** — near-black UI, neon-on-dark, HUD corner brackets, mono "machine" labels, faint engineering grid, restrained neon glow. Think Linear/Stripe discipline wearing a *Cyberpunk 2077* / *Watch Dogs* skin. Dark mode only.

---

## 1. Design principles

1. **Dark-first, neon-accented.** The canvas is near-black (`#06060c`). Color is a *signal*, not decoration — neon marks the one thing that matters in a view (the active item, the primary action, the live metric). If everything glows, nothing does.
2. **Engineered, not playful.** Surfaces are flat panels with hairline borders and subtle top-light gradients. Sharp-ish corners (10–16px), tabular numerals, mono uppercase labels. It should read like instrumentation.
3. **HUD framing.** Decorative corner brackets (`.hud`) and `kicker` labels frame content like a heads-up display without adding clutter.
4. **Calm motion.** One signature entrance (`fade-up`), a blinking terminal cursor, soft pulse/scan accents. Everything respects `prefers-reduced-motion`.
5. **Density with air.** Information-dense but breathing — generous panel padding (24px), clear grid gaps (22px), progressive disclosure over walls of data.
6. **Mobile is first-class.** The left nav rail collapses to a fixed bottom tab bar; grids reflow to 1–2 columns. Touch targets stay ≥ 40px.

---

## 2. Color tokens

All colors are CSS custom properties on `:root`. Use the token name, not the raw hex, when generating code.

### Surfaces (darkest → lightest)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#06060c` | App canvas / page background |
| `--bg-2` | `#090a12` | Inset wells (`.panel-inset`), recessed areas |
| `--panel` | `#0d0e18` | Default card/panel surface |
| `--panel-2` | `#11131f` | Secondary surface, hover states, table headers |
| `--panel-3` | `#161827` | Tertiary / button hover |
| `--panel-hi` | `#1c1f30` | Highest surface, scrollbar thumb |

### Lines / borders
| Token | Value | Use |
|---|---|---|
| `--line` | `rgba(150,168,224,0.10)` | Default hairline border |
| `--line-2` | `rgba(150,168,224,0.18)` | Stronger divider, button border |
| `--line-bright` | `rgba(0,229,255,0.30)` | Focus / hover / HUD brackets (cyan-tinted) |

### Text (brightest → faintest)
| Token | Hex | Use |
|---|---|---|
| `--text` | `#e7e9f5` | Primary text, headings |
| `--text-dim` | `#969cba` | Secondary text, labels, inactive nav |
| `--text-faint` | `#5a6080` | Tertiary, placeholders, kickers |
| `--text-ghost` | `#383d54` | Disabled / barely-there |

### Neon palette (accents & data viz)
| Token | Hex | Connotation |
|---|---|---|
| `--cyan` | `#1ce2ff` | **Brand / primary.** Active states, primary actions, focus |
| `--cyan-deep` | `#0a9bcf` | Cyan gradient anchor |
| `--magenta` | `#ff2e9a` | Accent, alerts-adjacent, gradient partner |
| `--violet` | `#9d6bff` | Accent, secondary gradient |
| `--lime` | `#43ffa6` | **Positive** (income, success, gains) |
| `--amber` | `#ffc24b` | **Warning** / caution |
| `--red` | `#ff4d6d` | **Negative** (spending, danger, loss) |
| `--blue` | `#4d8bff` | Data-viz series |
| `--pink` | `#ff77c8` | Data-viz series |
| `--teal` | `#2ff5d6` | Data-viz series |

### Semantic aliases
`--positive → --lime`, `--negative → --red`, `--warn → --amber`, `--brand → --cyan`.

### Glow helpers (box-shadow tokens)
- `--glow-cyan: 0 0 0.5px rgba(28,226,255,.8), 0 0 12px rgba(28,226,255,.35)`
- `--glow-magenta`, `--glow-lime` follow the same shape.
Use sparingly on the single focal element. Data-viz cells use a softer per-color `drop-shadow(0 0 6px <color>60)`.

> **Chart color order** (categorical): `#1ce2ff, #ff2e9a, #43ffa6, #ffc24b, #9d6bff, #ff4d6d, #4d8bff, #ff77c8, #2ff5d6, #969cba`.

---

## 3. Typography

**Fonts** (Google Fonts):
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Chakra+Petch:wght@500;600;700&display=swap" rel="stylesheet" />
```
| Token | Family | Role |
|---|---|---|
| `--font-display` | **Chakra Petch** (500–700) | Panel/section titles, hero headings — the "tech" voice |
| `--font-ui` | **Space Grotesk** (400–700) | Body, UI labels, nav, inputs — the default |
| `--font-mono` | **JetBrains Mono** (400–700) | Numbers, kickers, buttons, badges, terminal text |

**Conventions**
- Headings: `font-weight: 600`, `letter-spacing: -0.01em`, no margin by default. Sizes used: section title 18px, hero 22–28px.
- **Kicker** (`.kicker`): mono, 11px, `letter-spacing: 0.22em`, UPPERCASE, `--text-faint`. The signature label style — use above panels and as eyebrow text.
- **Mono numerals** (`.mono`): JetBrains Mono with `font-feature-settings: "tnum" 1, "zero" 1` (tabular figures + slashed zero). All money, counts, dates, and stats use this.
- `.tnum`: tabular-nums only, when you want lining figures in a UI-font context.
- Button text: mono, 12.5px, `letter-spacing: 0.04em`, often UPPERCASE for terminal feel (e.g. `BAR`, `LINE`, `RECORDS`).
- Body copy: Space Grotesk 13–14px, `line-height ~1.4`, color `--text-dim` for secondary.

---

## 4. Spacing, radius, layout metrics

**Radius scale:** `--r-sm: 6px`, `--r: 10px`, `--r-lg: 16px`, `--r-xl: 22px`.
- Buttons/inputs/inset → `--r` (10). Panels/cards → `--r-lg` (16). Pills → full or `--r-sm`.

**Spacing rhythm** (px, used inline): cards pad **24**; stack gaps **22** between major blocks, **8–12** within a group; icon/label gaps **8–12**; row padding **10–14**.

**Layout container:** `--maxw: 1320px`; content padding **26px** (desktop), **18px / 16px** (mobile), with **92px** bottom padding on mobile to clear the bottom nav.

**App shell:** CSS grid `248px 1fr` — a sticky full-height **nav rail** + scrolling **main column**. Main column = sticky **topbar** + centered **content** (`max-width: --maxw`).

---

## 5. Background & elevation treatment

The app canvas is never flat black — it has two fixed, non-interactive ambient layers (`body::before` / `body::after`):
1. **Corner glows** — three large radial gradients bleeding from the top corners: cyan (top-left, 8%), violet (top-right, 7%), magenta (bottom-right, 6%). Very low opacity.
2. **Engineering grid** — a 48×48px hairline grid in `rgba(150,168,224,0.045)`, radially masked so it fades out below the top third.

**Elevation is by surface tint + hairline border + optional top-light**, not heavy shadows:
- `.panel`: `--panel` background **plus** a `linear-gradient(180deg, rgba(255,255,255,0.015), transparent)` top sheen, `1px var(--line)` border, `--r-lg` radius.
- `.panel-inset`: `--bg-2` well, `1px var(--line)`, `--r`.
- **Glass surfaces** (nav rail, topbar, bottom nav): translucent panel color + `backdrop-filter: blur(8–14px)`. Topbar bg `rgba(6,6,12,0.78)`.

---

## 6. Signature decorations

- **HUD brackets** (`.hud`): add to any panel to draw two L-shaped corner brackets (top-left + bottom-right), 12px, `1px var(--line-bright)`, 0.8 opacity. The defining "instrument panel" flourish. Combine as `class="panel hud"`.
- **Gradient icon chip:** a 32×32 rounded-8 square with a 2-color neon gradient (`linear-gradient(135deg, var(--cyan), var(--violet))` etc.) holding a white emoji or glyph — used as the leading element of panel headers. Vary the gradient per section (cyan→violet, cyan→lime, lime→cyan…).
- **Active-item left bar:** active nav items get `box-shadow: inset 2px 0 0 var(--cyan)` + a faint cyan left-to-right gradient wash + cyan-glowing icon.
- **Terminal cursor:** `.cursor-blink` underscore after boot/empty-state text (`BOOTING_`).

---

## 7. Core components

### Buttons (`.btn`)
Mono 12.5px, padding `10px 16px`, radius `--r`, border `1px --line-2`, bg `--panel-2`, `transition: all .16s`.
- **Default** hover: border → `--line-bright`, bg → `--panel-3`.
- **`.btn-primary`**: cyan glass — `linear-gradient(180deg, rgba(28,226,255,0.18), rgba(28,226,255,0.06))`, border `rgba(28,226,255,0.45)`, text `#d7faff`, cyan glow shadow. Hover intensifies glow. One primary per view.
- **`.btn-ghost`**: transparent, `--text-dim`; hover fills `--panel-2`.
- **Segmented toggle** (chart type, group-by): a row of mono buttons in a bordered, rounded, `overflow:hidden` container; the active segment fills `--cyan` with near-black text (`#06060c`).

### Panels & cards
`class="panel hud"` with 24px padding is the default container. Header pattern: **gradient icon chip + display-font title** on the left, mono meta pill (`N RECORDS`) pushed right. Metric cards: big mono number + kicker label + optional trend arrow in lime/red.

### Navigation
- **Nav rail** (desktop): sticky, full-height, glass, `1px` right border. `.nav-item` = icon + 14px UI-font label, `--text-dim`, rounded 10. Hover → `--panel-2`. Active → cyan wash + inset cyan bar + glowing icon.
- **Bottom nav** (≤860px): fixed 4-column glass bar, icon-over-mono-label (10px), active = cyan + glowing icon, respects `env(safe-area-inset-bottom)`.
- **Topbar:** sticky glass strip — searchbox + meta chips + icon buttons. **Searchbox:** panel bg, hairline border that turns `--line-bright` on `:focus-within`, with a `.kbd` shortcut hint chip.

### Inputs
Inherit `--font-ui`; sit on `--panel`/`--bg-2` with `1px --line` borders that brighten to `--line-bright` on focus. Placeholders `--text-faint`. No default browser chrome.

### Pills / badges
Small mono, 11px, `--text-dim`, padding `4px 8px`, `--panel-2` bg, `1px --line`, rounded 6. Use for counts, statuses, meta. Color the text/border with a semantic neon for state.

### Modal / confirm dialog
Centered `panel hud` over a dark backdrop blur; supports a `danger` variant (red-tinted border/title). Esc / Enter / backdrop-click to dismiss. Keep modals compact and terminal-styled.

### Tooltips (charts)
Custom `panel-inset` card: bold title in `--text`, then mono value + dim descriptor lines. Border `--line-bright`, soft drop shadow.

---

## 8. Data visualization (Recharts)

- **Library:** Recharts. Containers need an explicit height (e.g. `height: 320`) wrapping a `ResponsiveContainer width="100%" height="100%"`.
- **Grid:** `CartesianGrid strokeDasharray="1 3"`, stroke `var(--line)`, `strokeOpacity 0.3`.
- **Axes:** ticks mono 11px `--text-dim`; axis/tick lines `--line`. Money formatted `$1,234`.
- **Series colors:** the categorical neon order from §2. Bars/areas fill `--cyan` by default with `filter: drop-shadow(0 0 4px var(--cyan))`. Pie/donut: `innerRadius 40 / outerRadius 120`, per-slice `drop-shadow(0 0 6px <color>60)`, selected slice gets a `--cyan` stroke.
- **Interactions:** slices/bars/legend rows are clickable to drill down; selected state = cyan border + faint cyan wash. `cursor: pointer` on interactive marks.
- **Legends:** custom 2-col grid of clickable `panel-inset` rows (swatch + label + mono value), not Recharts' default legend.

---

## 9. Motion

Keyframes available (use intentionally, sparingly):
| Name | Use |
|---|---|
| `fade-up` | **Primary entrance** — content rises 10px + fades, `.5s cubic-bezier(.22,.61,.36,1)`. Wrap view roots in `.fade-up`. |
| `blink` | Terminal cursor (`.cursor-blink`, `1.1s step-end infinite`). |
| `pulse-glow` | Slow opacity pulse for "live"/active indicators. |
| `scan-down` | Vertical scanline sweep accent. |
| `flicker-in` | Glitchy neon power-on for hero elements. |
| `ring-fill` / `draw-stroke` | Animated progress rings & SVG stroke draws. |
| `confetti` | Celebration burst (quest/level-up rewards). |
| `spin` | Loading spinners. |

Always honor `@media (prefers-reduced-motion: reduce)` (animations are globally near-disabled there).

---

## 10. Iconography

- **Line/stroke SVG icons** (lucide-style, ~1.5–2px stroke), sized 12–16px, colored `currentColor` so they inherit text color. Active/primary icons get `filter: drop-shadow(0 0 4px var(--cyan))`.
- **Emoji accents** inside gradient chips for section identity (📊 🧾 🌤 etc.) — used as flavor, paired with a display-font title, never as the only signifier.

---

## 11. Voice & microcopy

- Labels and system text lean **terminal/machine**: UPPERCASE mono kickers (`CATEGORY BREAKDOWN`, `NO TRANSACTIONS LOADED`, `SHOWING FIRST 50 OF 312`), status as `N RECORDS`, boot text `BOOTING_`.
- Numbers are always mono + tabular; money as `$1,234` (no cents unless needed), positives prefixed `+` in lime, negatives in `--text`/red.
- Cyberpunk framing is welcome and on-brand (HUD, "terminal", neon) but **content stays clear and honest** — flair never obscures the data.

---

## 12. Accessibility & constraints

- **Dark mode only** (no light theme). Maintain contrast: primary text `--text` on `--panel`/`--bg` passes; reserve `--text-faint`/`--text-ghost` for non-essential labels.
- Don't rely on glow/color alone for state — pair with border, position (inset bar), or label.
- Focus states must be visible (`--line-bright` border / cyan ring).
- Respect reduced-motion. Keep touch targets ≥ 40px; mobile reflows to bottom-nav + single/double-column grids.
- **Stack:** React + TypeScript + Vite, Recharts for charts, CSS custom properties + utility classes (Tailwind v4 present). Prefer the token/class system above over ad-hoc hex.

---

## 13. Quick "do / don't"

**Do** — near-black canvas; one neon focal point per view; `panel hud` containers; mono tabular numbers; kicker eyebrows; gradient icon chips; `fade-up` on entry; hairline borders + subtle top-light for elevation.

**Don't** — light backgrounds; rainbow everything (neon overload); heavy drop shadows for depth; pure-black `#000` panels; serif/decorative fonts; dense data with no grouping or progressive disclosure; motion that ignores reduced-motion.

---

### Token quick-reference (paste-ready)

```css
/* Surfaces */   --bg:#06060c; --bg-2:#090a12; --panel:#0d0e18; --panel-2:#11131f; --panel-3:#161827; --panel-hi:#1c1f30;
/* Lines */      --line:rgba(150,168,224,.10); --line-2:rgba(150,168,224,.18); --line-bright:rgba(0,229,255,.30);
/* Text */       --text:#e7e9f5; --text-dim:#969cba; --text-faint:#5a6080; --text-ghost:#383d54;
/* Neon */       --cyan:#1ce2ff; --cyan-deep:#0a9bcf; --magenta:#ff2e9a; --violet:#9d6bff; --lime:#43ffa6;
                 --amber:#ffc24b; --red:#ff4d6d; --blue:#4d8bff; --pink:#ff77c8; --teal:#2ff5d6;
/* Semantic */   --positive:var(--lime); --negative:var(--red); --warn:var(--amber); --brand:var(--cyan);
/* Radius */     --r-sm:6px; --r:10px; --r-lg:16px; --r-xl:22px;
/* Fonts */      --font-ui:'Space Grotesk'; --font-mono:'JetBrains Mono'; --font-display:'Chakra Petch';
/* Layout */     --maxw:1320px;  /* shell: 248px rail + 1fr; content pad 26px */
```
