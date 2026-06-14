# Handoff: HANDLER page — consolidate Net + Debrief

## Overview

Merge two existing screens — **Net** (`NetView`, "DATA-SHADOW") and **Debrief**
(`DebriefView`, weekly "AFTER-ACTION") — into a single **Handler** page laid out
as a **comms dashboard** (not a long scroll). The unifying idea: the *Handler*
is the voice/intelligence layer, and the persona/voice control (previously
duplicated across both pages) is hoisted into one shared masthead.

### Layout (top → bottom)
1. **Persona masthead** (full width) — identity (persona avatar/name/role),
   the freshest transmission *in the persona's voice*, ONLINE/MUTED toggle, a
   status readout (fresh-signal count · week status), and the **voice switcher**
   (owned voices selectable; Night-Market voices shown locked + price).
2. **Mission strip** (full width) — the weekly KPIs as one horizontal band of
   tiles + the **week selector** + a vitals/top-spend inset. (This is
   DebriefView's stats grid, flattened into a strip.)
3. **Patterns** (full width) — a row of **slim, narrow** insight cards
   (`repeat(auto-fill, minmax(218px, 1fr))` → ~4-up on wide screens, reflowing
   to 2–3 when narrow). (This is NetView's insights feed, slimmed.)
4. **Two-column row** (`.hdash`, `1.5fr / 1fr`, collapses to 1-col ≤1180px):
   - **Left** — **Transmissions** feed (NetView's handler message log), capped
     height with internal scroll so it never runs away.
   - **Right** — **After-action narrative** (persona-voiced) + **Operator
     reflection** form (notes + orders + FILE DEBRIEF).

### What changed vs. the two old pages
- **One persona control**, in the masthead (was: a selector on Net + the
  narrator voice baked into Debrief). The selected persona flavors the live
  transmission *and* the after-action narrative.
- **Insights de-duplicated** — they live once, in Patterns. Debrief no longer
  re-lists them read-only.
- **Less vertical, more horizontal** — KPIs as a strip, patterns as a row,
  feed beside the debrief instead of stacked.
- **Deck nav**: a single **Handler** entry (icon `bell`) in the PROGRESSION
  group **replaces both** `intel` (Net) and `debrief`. Screen title
  `PROGRESS // HANDLER`. (Confirmed placement: PROGRESSION.)

## About the Design Files

HTML/JSX **design references**, not production code. Re-implement in the real
app ([`bhinks/questman`](https://github.com/bhinks/questman): React 19 + Vite in
`web/`, Node/Express/Prisma in `backend/`), reusing the real `api` client,
react-query, sockets, and existing types. The prototype uses the app's actual
`index.css` so styling maps over directly.

`reference/NetView.current.tsx`, `reference/DebriefView.current.tsx`, and
`reference/AppShell.current.tsx` are the **current** production components — the
new Handler view is a merge of the first two; diff against them. **All data
contracts are preserved** — reuse every endpoint both pages already call:
- Insights: `GET /api/insights`, `POST /api/insights/:id/accept`,
  `POST /api/insights/:id/dismiss`
- Handler: `GET /api/handler/persona`, `PUT /api/handler/persona`
  (`{persona}` / `{enabled}`), `GET /api/handler/messages?limit=`
- Debrief: `GET /api/debrief/latest`, `GET /api/debrief?limit=`,
  `POST /api/debrief/:id/submit` (`{notes, focusForNext}`)
- Live refresh: the same socket events both views subscribe to
  (`insight-created`, `handler-message`, `daily-generated`, `weekly-debrief`,
  `debrief-generated`, `player-updated`).

## Fidelity

**High-fidelity.** Layout, type, spacing, colors, copy, and interactions are
final. Everything uses existing tokens/classes from `web/src/index.css`
(`.panel`/`.panel.hud`, `.panel-inset`, `.ncx-hex`, `.ncx-scan`/`.sweep`,
`.ncx-stamp.flat`, `.kicker`, `.mono`, `.ncx-serial`, `.btn`/`.btn-primary`/
`.btn-ghost`, `.cursor-blink`, color vars). No new tokens.

## How to run the reference

Open `Handler.html`. The static `AppShell` shows the page in-context with
"Handler" active in the deck. Tweaks (toolbar): persona voice + neon skin.

---

## Components (in `handler-view.jsx`)

| Component | Role | Built from |
|---|---|---|
| `PersonaMasthead` | identity + voice switcher + ONLINE/MUTED + status | NetView `PersonaControl` + new |
| `MissionStrip` | full-width weekly KPI tiles + week selector + vitals/spend | DebriefView `StatsGrid` + `WeekSelector`, flattened |
| `InsightCard` (slim) | one narrow possible-pattern card | NetView `InsightCard`, tightened |
| `TransmissionsPanel` | capped, scrolling handler message log | NetView `MessageLog` |
| `NarrativeCard` | persona-voiced after-action narrative | DebriefView `HandlerNarrative` |
| `ReflectionCard` | notes + orders + FILE DEBRIEF | DebriefView `ReflectionForm` |

Layout grid (in `Handler.html` `<style>`):
```css
.hdash { display:grid; grid-template-columns:1.5fr 1fr; gap:16px; align-items:start; }
.hcol  { display:flex; flex-direction:column; gap:16px; min-width:0; }
.hpat  { display:grid; grid-template-columns:repeat(auto-fill, minmax(218px,1fr)); gap:12px; }
@media (max-width:1180px){ .hdash{ grid-template-columns:1fr; } .hpat{ ...minmax(240px,1fr); } }
```

### Behavior to preserve
- **Mute dims** (doesn't hide): muted state lowers transmission opacity and
  swaps the masthead line for a "channel muted" notice. (Confirmed: dim.)
- **Honesty label persists** on every pattern ("POSSIBLE PATTERN", title-attr
  "correlation from your own logs — not a diagnosis"). Never editorialize beyond
  server text. Accept → spawns a quest (invalidate `quests`/`player`); Dismiss
  hides it.
- **Filing a debrief** the first time pays the reward; later edits just save
  (`POST /api/debrief/:id/submit`, `rewarded` flag in response).
- **Week selector** in the mission strip drives which week the strip, narrative,
  and reflection render (single `viewId` state).
- The Handler feed also surfaces on the Today page (gated by AI Calibration);
  that's unchanged — this is the dedicated full surface.

## Slim pattern card — exact spec
Compact meta line (`POSSIBLE PATTERN` dashed-underline faint · `CONFIDENCE`
colored · `Nd` window · right: `● QUEST ADDED` lime / `DISMISSED`), then title
(13.5/700), body (12, `--text-dim`), evidence (10 mono faint), suggestion as a
`2px solid <confidence>` left-border line (not a boxed callout) with a `spark`
glyph, then compact ACCEPT (`btn-primary`) / DISMISS (`btn-ghost`) at 10px.
Confidence colors: `low → --amber`, `medium → --cyan`. Spawned card gets a lime
border + faint lime gradient bg; dismissed drops to 0.5 opacity.

## Tweaks → product decisions
Persona voice (real setting via `PUT /api/handler/persona`) and neon skin
(already a Shop cosmetic, `<html data-theme>`). The earlier "default mode"
tweak was removed when the page became a single scroll/dashboard (no tabs).

## Open questions for the team
- Mission strip: keep all 9 KPIs always, or let the operator pick which tiles?
- Patterns row: cap visible count with a "show more", or always show all open?
- Should muted also pause new-signal counting, or just dim the feed?

## Files
| File | Contents |
|---|---|
| `Handler.html` | Root: mounts static shell + view, dashboard grid CSS, Tweaks |
| `handler-view.jsx` | All components above + `HandlerView` page composition |
| `handler-data.jsx` | Mock personas (w/ voice fns), transmissions, insights, weekly debriefs + past cycles |
| `handler-shell.jsx` | Faithful static `AppShell` + `Icon` (context only — app already has these) |
| `tweaks-panel.jsx` | Tweaks harness (prototype-only) |
| `index.css` | The app's real stylesheet (verbatim) — fidelity reference |
| `reference/NetView.current.tsx` | Current Net component to diff against |
| `reference/DebriefView.current.tsx` | Current Debrief component to diff against |
| `reference/AppShell.current.tsx` | Current shell — shows the nav change (remove `intel` + `debrief`, add `handler`) |

## Out of scope
- Persona-flavored copy in the mock is illustrative; in the app the voice/text
  comes from the server (handler messages, debrief `handlerText`, persona blurbs).
- `handler-shell.jsx` / `Icon` are reproduced only so the mock renders
  in-context — the app already has `AppShell.tsx` + `Icon.tsx`; edit the nav
  there rather than recreating it.
