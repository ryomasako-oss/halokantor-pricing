---
version: alpha
name: Halokantor-Ledger
description: A B2B quotation and pricing-control system built on a paper-and-ink palette — a warm off-white worksheet surface, deep navy as the single authority color, and three named scenario colors (S1 teal-navy, S2 teal, S3 violet) that let a sales rep compare Full Margin, Cross Subsidise, and RRP Discount pricing at a glance. Numbers are always tabular, status is always a pill, and every screen reads like a well-kept ledger rather than a dashboard — calm, dense, and trustworthy enough to send a client a quote from.

colors:
  paper: "#F1F4F7"
  sheet: "#FFFFFF"
  ink: "#1B2530"
  navy: "#1F3A5F"
  navy-dark: "#18304F"
  muted: "#667384"
  rule: "#DCE2E8"
  soft: "#F6F8FA"
  marker: "#FFE35A"
  scenario-s1: "#1F5F8B"
  scenario-s2: "#2A7F8E"
  scenario-s3: "#7A5C99"
  danger: "#B42318"
  danger-bg: "#FEF3F2"
  danger-rule: "#F1C6C0"
  warn: "#8A5A00"
  warn-bg: "#FFF7DB"
  warn-rule: "#F2DF9B"
  ok: "#38761D"
  ok-bg: "#E6F2E4"

typography:
  page-title:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: 22px
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: -0.02em
  card-title:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0
  section-label:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 13.5px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: 0
  body:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 12.5px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 11.5px
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: 0
  money-lg:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 21px
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: -0.02em
    fontFeature: tnum
  money-md:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 19px
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: -0.02em
    fontFeature: tnum
  money-table:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
    fontFeature: tnum
  button:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 550
    lineHeight: 1.0
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 9px
  lg: 12px
  xl: 14px
  xxl: 18px
  pill: 999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  xxl: 28px

components:
  btn-primary:
    backgroundColor: "{colors.navy}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 7px 14px
  btn-primary-hover:
    backgroundColor: "{colors.navy-dark}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 7px 14px
  btn-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 7px 14px
  btn-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 7px 14px
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 14px
  scenario-card:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "4px 12px 12px 4px"
    padding: 11px 12px
  kpi-tile:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    padding: 12px 14px
  status-chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 4px 11px
  data-cell:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.money-table}"
    rounded: "{rounded.sm}"
    padding: 4px 6px
  quote-document:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 22px
  modal:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xxl}"
    padding: 0px
  text-input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 10px
---

## Overview

Pricing Engine Salvator is a working document, not a marketing surface — a sales rep opens it to build a quotation, a manager opens it to decide whether to approve one. The design language follows from that job: a warm paper-grey (`{colors.paper}` `#F1F4F7`) canvas holds white sheet-like cards (`{colors.sheet}`), everything sits on hairline rules instead of shadows, and the only saturated color that means "action" or "authority" is deep navy (`{colors.navy}` `#1F3A5F`). Numbers always render tabular so columns of harga pokok, margin, and RRP line up like a real ledger.

The one deliberate flourish is the **three-scenario system**. Every quotation computes S1 Full Margin, S2 Cross Subsidise, and S3 RRP Discount side by side, and each gets a fixed identity color — steel blue, teal, violet — that never changes meaning anywhere in the app: a left border on a card, a fill on a meter, a rule under a total. A rep should be able to tell which scenario a number belongs to without reading the label.

Status is communicated entirely through pill-shaped chips with a consistent semantic palette: grey for draft, amber for submitted/warn, green for approved/ok, red for rejected, blue for sent, filled navy-green for won. The same four-color semantic set (`danger`/`warn`/`ok`/neutral) recurs in badges, notices, and policy-breach banners — one vocabulary, reused everywhere, rather than one-off colors invented per screen.

**Key characteristics:**
- Paper-grey workspace (`{colors.paper}`) with white sheet cards — a ledger, not a slide deck.
- One authority color: navy. It is the only color allowed on a primary button or an active nav item.
- Fixed scenario identity: S1 steel-blue, S2 teal, S3 violet — consistent across cards, meters, and quote totals.
- Tabular numerals (`tnum`) on every price, margin, and quantity cell — the quiet financial-document signal.
- Semantic four-color system (danger / warn / ok / neutral) reused across badges, notices, and status chips — never invented ad hoc.
- Pill-radius interactive chrome (buttons, tabs, chips) against squarer 12–18px card radii — soft geometry that still reads dense.
- A yellow highlighter mark (`{colors.marker}`) reserved for one thing only: flagging the best-value number in a comparison.

## Colors

### Authority & Brand
- **Navy** (`{colors.navy}` — `#1F3A5F`): The single action color. Primary buttons, active nav state, focus rings, links, the quotation wordmark.
- **Navy Dark** (`{colors.navy-dark}` — `#18304F`): Hover/pressed state for navy.
- **Ink** (`{colors.ink}` — `#1B2530`): Default text. Near-black, never pure black — softer on a paper background.
- **Muted** (`{colors.muted}` — `#667384`): Secondary text, captions, table headers, helper copy.

### Surface
- **Paper** (`{colors.paper}` — `#F1F4F7`): App background. The "desk" the sheets sit on.
- **Sheet** (`{colors.sheet}` — `#FFFFFF`): Card, modal, and table background — the "paper" itself.
- **Soft** (`{colors.soft}` — `#F6F8FA`): Table header fill, input cell fill, tab-rail background — a half-step between paper and sheet.
- **Rule** (`{colors.rule}` — `#DCE2E8`): The universal 1px border. Depth in this system comes from rules, not shadows.

### Scenario Identity (fixed, never reassigned)
- **S1 · Full Margin** (`{colors.scenario-s1}` — `#1F5F8B`): Cost-plus everywhere, capped at RRP.
- **S2 · Cross Subsidise** (`{colors.scenario-s2}` — `#2A7F8E`): Leader items thin, profit items cover the gap.
- **S3 · RRP Discount** (`{colors.scenario-s3}` — `#7A5C99`): Flat discount off RRP, held above the margin floor.

### Semantic
- **Danger** (`{colors.danger}` / bg `{colors.danger-bg}` / rule `{colors.danger-rule}`): Policy violations, rejections, below-cost pricing.
- **Warn** (`{colors.warn}` / bg `{colors.warn-bg}` / rule `{colors.warn-rule}`): Submitted-for-approval, estimated cost, non-blocking flags.
- **Ok** (`{colors.ok}` / bg `{colors.ok-bg}`): Approved, within policy, won deals.
- **Marker** (`{colors.marker}` — `#FFE35A`): Highlighter accent reserved for "this is the best number in this comparison." Used nowhere else.

## Typography

### Font Family
**Plus Jakarta Sans**, loaded from Google Fonts, is the only typeface — one family across display, body, and tabular data, differentiated by weight and size rather than by switching fonts. Fallback stack: `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`.

### Hierarchy

| Token | Size | Weight | Use |
|---|---|---|---|
| `{typography.page-title}` | 22px | 750 | Page `<h1>` (e.g. "Quotation Editor") |
| `{typography.card-title}` | 15px | 700 | Card / modal headings |
| `{typography.section-label}` | 13.5px | 650 | Table card headers, KPI section labels |
| `{typography.body}` | 14px | 400 | Default UI text |
| `{typography.body-sm}` | 12.5px | 500 | Scenario card copy, dense list rows |
| `{typography.caption}` | 11.5px | 550 | Field labels, timestamps, KPI captions |
| `{typography.money-lg}` | 21px | 750 | KPI tile values, scenario card totals |
| `{typography.money-md}` | 19px | 750 | Quote-document line totals |
| `{typography.money-table}` | 12.5px | 400 | Every price/quantity cell in a table (`tnum`) |
| `{typography.button}` | 13px | 550 | All button and tab labels |

### Principles
- **One family, weight does the work.** Never introduce a second typeface for "emphasis" — reach for 650–750 weight instead.
- **Tabular figures are mandatory on money.** Any cell showing currency, margin %, or quantity uses `font-feature-settings: "tnum"` (the `.num` utility) so columns align vertically — the system's core credibility signal in a pricing tool.
- **Tight negative tracking only at the top.** `-0.02em` on page titles and money-lg/md; everything else sits at default tracking for legibility at small sizes.
- **Captions are UPPERCASE-adjacent in weight, not case.** Use 550–650 weight + `{colors.muted}` instead of letter-spaced all-caps — keeps dense screens calm rather than shouty.

## Layout

### Spacing System
- **Base unit:** 4px, mostly used in 8/12/16/22px steps.
- **Tokens:** `{spacing.xxs}` 2px · `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.md}` 12px · `{spacing.lg}` 16px · `{spacing.xl}` 22px · `{spacing.xxl}` 28px.
- **Page padding:** 18px (12px on wide/table-first pages).
- **Card body padding:** 14px standard, 10px "tight" variant for dense nested cards.

### Grid & Container
- Main content caps at 1560px, centered; wide/table pages drop the cap entirely.
- The quotation editor is a two-column grid: flexible main column + a 340px sticky side panel (levers, scenario summary) that collapses to a single stacked column below 1080px.
- Card grids (scenario cards, KPI tiles, lever controls) use `repeat(auto-fit, minmax(Npx, 1fr))` so they reflow without explicit breakpoints.

### Whitespace Philosophy
Dense by design — this is a working tool used all day, not a landing page. Gaps between cards run 10–16px; internal card padding stays at 14px. Generosity is spent on touch targets and row height in tables (32–36px rows), not on empty margin.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat, 1px `{colors.rule}` border only | Default card, table, input |
| 1 | `0 1px 2px rgba(27,37,48,.05)` | Cards, KPI tiles — barely-there lift |
| 2 | `0 20px 60px rgba(20,30,42,.25)` | Modals, login card, toasts — the one true "floating" shadow in the system |
| — | `box-shadow: 0 0 0 2px {scenario-color} inset` | Selected/active scenario card — depth communicated by inset ring, not elevation |

### Decorative Depth
This system deliberately avoids mid-level shadows. Rules (`{colors.rule}`) do the separating work everywhere on the page; a real drop shadow is reserved exclusively for content that floats above the page plane — modals, toasts, the login card. That contrast makes "this is a dialog, respond to it" unambiguous.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Badges, breach chips |
| `{rounded.sm}` | 6px | Data-entry table cells |
| `{rounded.md}` | 9px | Text inputs, selects |
| `{rounded.lg}` | 12px | Table containers, KPI tiles |
| `{rounded.xl}` | 14px | Cards, quote document |
| `{rounded.xxl}` | 18px | Modals, login card |
| `{rounded.pill}` | 999px | Buttons, tabs, status chips, toasts |
| asymmetric `4px 12px 12px 4px` | — | Scenario cards — a squared color-bar edge fused to a rounded body |

### Signature Shape
The **scenario card**'s asymmetric radius — sharp on the left where the 3px scenario-color border sits, rounded everywhere else — is the system's one distinctive shape. It reads as a colored tab clipped onto a normal card, reinforcing "this number belongs to that scenario" purely through geometry.

## Components

### Buttons
**`btn-primary`** — the only filled button. Navy background, white text, pill radius, `7px 14px` padding. Hover darkens to `{colors.navy-dark}`.
**`btn-ghost`** — default/secondary action: transparent background, 1px `{colors.rule}` border, hovers to `{colors.soft}`.
**`btn-danger`** — white background, `{colors.danger}` text and border-tint, hovers to `{colors.danger-bg}`. Reserved for reject/delete.
Small variant drops padding to `4px 10px` for inline table actions.

### Cards & Containers
**`card`** — white sheet, `{rounded.xl}` 14px, 1px rule border, Level-1 shadow. Header row (`card-head`) is 13.5px/650 weight with a bottom rule; body padding 14px.
**`scenario-card`** — soft background, 3px left border in the scenario's identity color, asymmetric radius, holds a name, a `{typography.money-lg}` value, and a thin `meter` bar tinted to the same color. Selectable variant shows an inset ring when active.
**`kpi-tile`** — white, `{rounded.lg}`, caption label + `{typography.money-lg}` value + muted footnote. Used in dashboard summary rows.
**`quote-document`** — the client-facing artifact: white, `{rounded.xl}`, 22px padding, 4px top border tinted to the winning scenario's color — the one place scenario color appears outside the editor.

### Tables
Sticky, right-aligned headers on `{colors.soft}`; rows separated by hairline `#EEF1F4`; hover tint `#FAFBFC`; policy-flagged rows tint `#FFF9EC`. Editable price cells (`data-cell`) get their own soft fill, switch to white with a navy border on focus, and an amber tint (`cell.est`) when a value is system-estimated rather than sourced from Accurate.

**Unit (UOM) cells** follow the same rules: the unit select is a plain data-entry `cell` (like Role), in a left-aligned column right after Qty, so a row reads "20 Pak". A flag about the unit goes *under* the value as an amber `badge` ("Tanpa rasio", full reason in the tooltip), exactly like "Di plafon" under a scenario price. Any action on it is a tiny `icon-btn`, never inline link text. One shared component (`UomCell`) renders this in both the items table and the catalog picker. Unit conversions shown as data ("1 Box = 24 Pcs") are grey badges, and always name both units.

### Status & Semantic Chips
**`status-chip`** — pill, 11–12px/650, one of six fixed states: draft (grey), submitted (amber), approved (green), rejected (red), sent (blue), won (filled green). **`badge`** — smaller square-radius sibling used inline in text/tables for the same six-color semantic vocabulary.

### Forms
**`text-input`** — white, `{rounded.md}` 9px, 1px rule border, focuses to a navy border. Field labels are `{typography.caption}` in `{colors.muted}`, sitting above the input, never inside it as placeholder-only text for anything the rep must double-check (price overrides, client names).

### Signature Components
**Meter bar** — a 4px pill track showing a scenario's margin or discount as a percentage fill in that scenario's identity color. Appears inside every scenario card; the fastest way to eyeball "which option is healthiest."
**Highlighter mark** (`.mark` / `{colors.marker}`) — a hand-drawn-looking yellow highlight background applied to exactly one number per comparison: the best price, the lowest risk, the recommended pick. Never used decoratively.
**Breach banner** — a left-icon, colored-background list item (red = blocking, amber = warning) that explains *why* a quotation can't auto-approve, always paired with the specific policy rule it violates.

## Do's and Don'ts

### Do
- Reserve `{colors.navy}` for the one primary action per view — links and active states may reuse it, but only one filled button per screen region.
- Keep scenario colors S1/S2/S3 fixed everywhere they appear — a rep should learn the color once and never have it mean something else.
- Render every price, margin, and quantity cell with `font-feature-settings: "tnum"`.
- Use the four-color semantic set (danger/warn/ok/neutral) for all status communication — don't invent a fifth color for a new state.
- Apply Level-2 shadow only to things that float above the page (modals, toasts) — keep everything else flat with rules.

### Don't
- Don't add a second accent color "for variety" — the system's calm comes from navy being the only saturated action color.
- Don't reassign scenario colors per-screen (e.g. S1 in blue on one page, teal on another).
- Don't use the yellow marker as a generic highlight; it means "best value," full stop.
- Don't drop button radius below pill-shape or swap it for sharp corners — pill chrome vs. squarer cards is the system's shape contrast.
- Don't skip tabular numerals on a money cell — misaligned digits break the ledger feel immediately.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Desktop | ≥ 1080px | Editor two-column grid (main + 340px sticky side panel) |
| Tablet | 721–1079px | Editor collapses to single column, side panel un-stickies |
| Mobile | ≤ 720px | Top nav wraps to a second scrollable row; page padding drops to 12px; KPI values shrink to 18px |
| Small mobile | ≤ 420px | Nav labels hide, icon-only nav |

### Touch Targets
Buttons and nav pills maintain ≥ 36–40px hit height via padding even at small sizes; modal footer buttons stretch to full-width and stack on mobile so nothing is a mis-tap away from a destructive action.

### Print
A dedicated print stylesheet isolates `.print-area` (the quote document) and hides all app chrome — the quotation must be able to leave the app as a clean printed/PDF page without any navy nav bars or edit affordances bleeding through.

## Iteration Guide

1. Change one component at a time; reference tokens directly (`{colors.navy}`, `{rounded.pill}`, `{typography.money-table}`).
2. Never introduce a new named color without deciding whether it's semantic (reuse danger/warn/ok) or scenario (reuse S1/S2/S3) first — new hues should be rare and justified.
3. Any new numeric UI must default to `{typography.money-table}` with `tnum` — check before shipping a raw `<span>{price}</span>`.
4. Keep the shape contrast: pill radius for anything clickable, 12–18px radius for anything that contains content.
5. Run changes past a real quotation with policy violations — the breach banner, blocking states, and manager-queue flow are where this system is tested hardest, not the happy path.
