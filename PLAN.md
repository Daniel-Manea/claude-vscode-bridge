# Claude Bridge — Brand & Design Plan v3

Authoritative brand and design document. Covers everything the user can see
or touch — the marketplace listing, the VS Code extension UI (sidebar +
settings panel), the terminal status line, the status-bar item, system
notifications, log output, file names on disk, and the API-style naming in
settings.json. Backend touchpoints are treated as first-class brand surfaces.

The matching browser preview is `design-preview.html` at the repo root.
Every token, component, layout, and open decision here is rendered there so
you can review live before anything is implemented.

---

## Table of contents

1. [Product positioning](#1-product-positioning)
2. [Voice & tone](#2-voice--tone)
3. [Identity system](#3-identity-system)
4. [Color](#4-color)
5. [Typography](#5-typography)
6. [Spacing, radius, elevation, motion](#6-spacing-radius-elevation-motion)
7. [Iconography](#7-iconography)
8. [Components](#8-components)
9. [Layout — Sidebar dashboard](#9-layout--sidebar-dashboard)
10. [Layout — Settings panel](#10-layout--settings-panel)
11. [Layout — Terminal status line](#11-layout--terminal-status-line)
12. [Layout — VS Code status-bar item](#12-layout--vs-code-status-bar-item)
13. [Backend brand surfaces](#13-backend-brand-surfaces)
14. [Marketplace presence](#14-marketplace-presence)
15. [States & flows](#15-states--flows)
16. [Motion catalogue](#16-motion-catalogue)
17. [Accessibility](#17-accessibility)
18. [Performance budget](#18-performance-budget)
19. [Open decisions](#19-open-decisions)
20. [Implementation order](#20-implementation-order)

---

## 1. Product positioning

### What Claude Bridge is

> **The bridge between your editor and the Claude Code CLI.**  
> Select code in VS Code. Ask a question in your terminal. Claude already
> has your selection.

### What it is not

- Not an IDE replacement for the Claude Code TUI.
- Not an MCP server or a chat panel (the official Anthropic extension covers
  that).
- Not another generic statusline configurator (`ccstatusline` covers that
  beautifully for users who don't need VS Code integration).

### The unique wedge

Among VS Code extensions that touch Claude Code, Claude Bridge is the only
one that:

1. **Automatically pipes editor selections into Claude's context** via the
   `UserPromptSubmit` hook, without copy-paste or `@`-mentions.
2. **Renders the selection inside Claude's status line**, with an OSC-8
   clickable link back to the source file at the exact line.
3. **Runs entirely locally** — no MCP server, no network, no telemetry.
4. **Installs itself** into `~/.claude/settings.json` and keeps itself in
   sync when the user toggles features (no manual JSON edits).

Everything else — segment toggles, presets, live preview — is *polish on
top of that wedge*. When we're deciding what to cut, the wedge is sacred.

### Audience

- Claude Code power users who spend most of their day in VS Code.
- Developers who prefer terminal-first workflows and treat the IDE as a
  file browser plus selection source.
- Teams who share presets (exported JSON) to standardize Claude usage.

### Success metrics (non-vanity)

- **Time-to-first-injection:** from fresh install to first Claude prompt
  that sees a selection. Target < 60 s.
- **Daily-active / weekly-active:** does it get used again?
- **Flicker / restart complaints:** trend toward zero after v3.
- **Marketplace rating:** ≥ 4.5 after v3 releases.

---

## 2. Voice & tone

### Voice (always)

- **Second person, active, imperative where possible.** "Select code. Ask
  Claude." Not "Users can select code and then…"
- **Specific verbs.** "Pipes your selection," "renders at 10 ms per tick."
  Not "seamlessly integrates," "enhances productivity."
- **Numbers where they help.** "10 ms," "nine segments," "under 30 lines
  of shell." Not "blazing fast," "powerful."
- **Plain past tense for changelogs.** "Removed the thinking segment." Not
  "✨ Streamlined the experience by…"
- **No emoji outside changelog release headers.** The UI stays textual.

### Words we use

bridge · selection · inject · render · hook · segment · preset · scope ·
status line (two words) · Claude Code · VS Code · terminal · live

### Words we don't use

seamless · powerful · effortless · magic · simply · just · beautifully ·
game-changing · supercharge · AI-powered (it's obviously AI-related) ·
enhanced · delightful

### Error copy pattern

```
Claude Bridge: <what happened>. <what to do next>.
```

Examples:

- `Claude Bridge: already installed at User. Nothing to do.`
- `Claude Bridge: preset file is missing the "segments" array.`
- `Claude Bridge: open a folder to use project scope.`

### Success copy pattern

```
Claude Bridge: <past-tense verb> <object> at <location>.
```

Examples:

- `Claude Bridge: installed at User.`
- `Claude Bridge: uninstalled from 2 locations.`
- `Claude Bridge: exported preset to claude-bridge-preset.json.`

### The single sentence (use everywhere)

> Your VS Code selection, piped straight into Claude Code.

This is the one line on the marketplace hero, the banner SVG, the README,
and the webview header subtitle when used.

---

## 3. Identity system

### Name

**Claude Bridge.** Two words, capital C, capital B. Never "ClaudeBridge,"
never "Claude-Bridge." When combined with the function (e.g., for settings
keys, file names) the `claude` stays lowercase and is hyphenated or
camel-cased depending on context — see §13.

### Logo

The mark is a **bridge** framed by two chevrons (`<` and `>`) with a
**terracotta spark** (Claude's Anthropic-brand shimmer) centered between them.
The chevrons read as "code brackets" to developers and as a bridge silhouette
at smaller sizes. The spark signals "Claude."

Three canonical lockups:

| Variant         | Canvas    | Use                                          | File                   |
| --------------- | --------- | -------------------------------------------- | ---------------------- |
| **Mark**        | 24 × 24   | Activity-bar icon, inline webview header     | `media/icon.svg`       |
| **Mark on tile**| 128 × 128 | Marketplace icon, macOS Touch Bar if ever    | `media/logo.svg`       |
| **Banner**      | 960 × 240 | Marketplace gallery hero                     | `media/banner.svg`     |

Rules:

- The chevrons are `currentColor` in the mark (so the activity-bar icon
  inherits the VS Code foreground — works in every theme).
- The spark is always `--cb-accent` (`#D97757`). Never recolor it.
- The spark is never used without the chevrons. Together they are the brand.
- Minimum size for the standalone mark: 14 px. Below that, render the
  chevrons only (no spark).

### Wordmark

When we need a wordmark (marketplace banner, dashboard header in some
variants), it's set in the UI font at 13 px / 600 weight / `+0.2` tracking.
Lowercase "b" is a tiny but deliberate nod — never "Claude BRIDGE" or
"CLAUDE BRIDGE."

### Color meaning

- **Terracotta `#D97757`** — *intent, attention, Claude*. The brand accent.
  Used on the spark, on active buttons, on the selection segment in the
  status line (the one thing this extension uniquely adds to Claude).
- **Bridge cyan `#4FC3F7`** — *structure, connective tissue*. Used for the
  chevrons when they're not `currentColor` (banner, marketplace tile), and
  as the status-line git-branch segment color.
- **Neutral** — everything else. Inherits from the VS Code theme.

Two-color logic: terracotta is Claude, cyan is VS Code. The mark is
literally "VS Code chevrons hugging the Claude spark." That's the product.

---

## 4. Color

All tokens live in `webview/shared/tokens.css` and are shared between
sidebar and settings panel.

### Brand

| Token                    | Dark                              | Light                  | Role                            |
| ------------------------ | --------------------------------- | ---------------------- | ------------------------------- |
| `--cb-accent`            | `#D97757`                         | `#D97757`              | Primary. Active state, intent.  |
| `--cb-accent-hover`      | `#E48770`                         | `#C8684A`              | Primary hover                   |
| `--cb-accent-active`     | `#C86B4F`                         | `#B55C40`              | Primary pressed                 |
| `--cb-accent-subtle`     | `rgba(217, 119, 87, 0.10)`        | `rgba(217, 119, 87, 0.08)` | Accent tint backgrounds     |
| `--cb-accent-border`     | `rgba(217, 119, 87, 0.36)`        | `rgba(217, 119, 87, 0.32)` | Accent outlines            |
| `--cb-accent-fg`         | `#FFFFFF`                         | `#FFFFFF`              | Text on accent surfaces         |
| `--cb-bridge`            | `#4FC3F7`                         | `#1E88B5`              | Structural accent (branch)      |
| `--cb-bridge-subtle`     | `rgba(79, 195, 247, 0.10)`        | `rgba(30, 136, 181, 0.10)` | Optional tint              |

### Neutrals (inherit from VS Code)

| Token                    | Mapped to                                       | Role                             |
| ------------------------ | ----------------------------------------------- | -------------------------------- |
| `--cb-fg`                | `var(--vscode-foreground)`                      | Default text                     |
| `--cb-muted`             | `var(--vscode-descriptionForeground)`           | Sublabels, hints                 |
| `--cb-surface`           | `transparent` (over `--vscode-editor-bg`)       | Default surface                  |
| `--cb-surface-raised`    | `rgba(255, 255, 255, 0.025)` dark               | Elevated cards                   |
|                          | `rgba(0, 0, 0, 0.025)` light                    |                                  |
| `--cb-surface-pressed`   | `rgba(255, 255, 255, 0.05)` dark                | Pressed state bg                 |
| `--cb-border`            | `rgba(128, 128, 128, 0.18)`                     | Hairline dividers                |
| `--cb-border-strong`     | `rgba(128, 128, 128, 0.30)`                     | Card outlines                    |
| `--cb-focus`             | `var(--vscode-focusBorder)`                     | Focus ring                       |

### Semantic

| Token          | Mapped to                             | Role                 |
| -------------- | ------------------------------------- | -------------------- |
| `--cb-on`      | `var(--vscode-testing-iconPassed)`    | "On / installed"     |
| `--cb-off`     | `var(--vscode-charts-red)`            | "Off / uninstalled"  |
| `--cb-warn`    | `var(--vscode-charts-yellow)`         | Warnings             |
| `--cb-info`    | `var(--cb-bridge)`                    | Informational hints  |

### Status-line colors

These are ANSI 24-bit sequences, baked into `media/statusline-template.sh`.
We keep them parallel to the webview tokens so the whole surface reads as
one brand.

| Segment         | ANSI color                          | Mapped to             |
| --------------- | ----------------------------------- | --------------------- |
| Model           | bold, inherit fg                    | neutral               |
| Git branch      | `\033[36m` (cyan)                   | `--cb-bridge`         |
| Context bar ≤70 | `\033[32m` (green)                  | system                |
| Context bar <90 | `\033[33m` (yellow)                 | system                |
| Context bar ≥90 | `\033[31m` (red)                    | system                |
| Tokens          | `\033[2m` (dim)                     | neutral muted         |
| Cost            | `\033[2m` (dim)                     | neutral muted         |
| Lines added     | `\033[32m` (green)                  | system                |
| Lines removed   | `\033[31m` (red)                    | system                |
| Rate limits     | `\033[2m` (dim)                     | neutral muted         |
| Selection       | `\033[38;2;217;119;87m` (terracotta)| `--cb-accent`         |

**Decision locked:** the selection segment *is the one thing Claude Bridge
uniquely contributes* to the status line. It gets the accent. Everything
else is structural.

---

## 5. Typography

### Stacks

```css
--cb-font-ui:   var(--vscode-font-family);
--cb-font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular,
                "SF Mono", Menlo, monospace);
```

No webfonts. Nothing loaded over the network. Geist is an aesthetic we
admire, not a dependency we ship.

### Scale

| Token           | Size / weight / tracking           | Use                                    |
| --------------- | ---------------------------------- | -------------------------------------- |
| `--cb-t-hero`   | 20 / 600 / -0.2                    | Settings panel hero title              |
| `--cb-t-title`  | 13 / 600 / +0.2                    | Sidebar header, section titles         |
| `--cb-t-body`   | 12 / 400 / 0                       | Labels, default text                   |
| `--cb-t-strong` | 12 / 600 / 0                       | Active preset pill, installed badge    |
| `--cb-t-caps`   | 10 / 600 / +0.6 UPPER              | Section eyebrows ("SEGMENTS")          |
| `--cb-t-hint`   | 10 / 400 / +0.1                    | Helper text, "Drag to reorder"         |
| `--cb-t-xs`     |  9 / 500 / +0.3                    | Version, timestamps                    |
| `--cb-t-mono`   | 11 / 500 / 0 (mono)                | Data chips, file paths, JSON snippets  |
| `--cb-t-mono-sm`| 10 / 500 / 0 (mono)                | Inline code, segment preview examples  |

Line-height: **1.35** globally. The one exception is the segment list where
row padding handles vertical rhythm and the label itself is `1.2`.

---

## 6. Spacing, radius, elevation, motion

### Spacing

4 px base. Seven steps. No ad-hoc values in production CSS.

| Token          | px | Typical use                                          |
| -------------- | -- | ---------------------------------------------------- |
| `--cb-space-1` |  4 | Icon-to-text, tight pairings                         |
| `--cb-space-2` |  8 | Control inner padding, row inner gap                 |
| `--cb-space-3` | 12 | Default stack rhythm between components              |
| `--cb-space-4` | 16 | Card padding, major block separation                 |
| `--cb-space-5` | 24 | Section-to-section in settings panel                 |
| `--cb-space-6` | 32 | First-run card padding                               |
| `--cb-space-7` | 48 | Empty-state centering                                |

### Radius

| Token              | px  | Use                                             |
| ------------------ | --- | ----------------------------------------------- |
| `--cb-radius-sm`   |  3  | Checkboxes, pill buttons, chips                 |
| `--cb-radius-md`   |  6  | Cards, inputs, dropdowns, install badge         |
| `--cb-radius-lg`   | 10  | First-run card, hero surfaces                   |
| `--cb-radius-full` | 999 | Brand dots, status indicators                   |

### Elevation

Dark themes fake elevation with inner borders and a subtle white tint.
Light themes get a single soft shadow. We never combine the two.

| Token          | Dark                                         | Light                               |
| -------------- | -------------------------------------------- | ----------------------------------- |
| `--cb-elev-0`  | none                                         | none                                |
| `--cb-elev-1`  | `inset 0 0 0 1px --cb-border`                | `0 1px 2px rgba(0,0,0,0.04)`        |
| `--cb-elev-2`  | `inset 0 0 0 1px --cb-accent-border`         | `0 2px 8px rgba(217,119,87,0.12)`   |

### Motion

| Token              | ms  | Curve                                | Use                                       |
| ------------------ | --- | ------------------------------------ | ----------------------------------------- |
| `--cb-dur-fast`    | 100 | `cubic-bezier(0.16, 1, 0.3, 1)`      | Hover, focus, toggle                      |
| `--cb-dur-normal`  | 180 | same                                 | Row drag, section state change            |
| `--cb-dur-slow`    | 280 | same                                 | First-run card mount                      |
| `--cb-ease-out`    | —   | `cubic-bezier(0.16, 1, 0.3, 1)`      | Default. "Arrives soft."                  |
| `--cb-ease-spring` | —   | `cubic-bezier(0.34, 1.56, 0.64, 1)`  | Preset pill flip, checkmark pop           |

**Hard rule:** everything collapses to `0s` when `@media
(prefers-reduced-motion: reduce)`.

---

## 7. Iconography

### Style

1.5 px stroke, rounded linecaps and linejoins. Live on a 24 × 24 canvas,
usable at 16 and 12. Chevrons / carets / checkmarks are hand-drawn (SVG
paths, not a font). We import zero icon libraries.

### Icon inventory

| Name             | Use                                  | Source              |
| ---------------- | ------------------------------------ | ------------------- |
| `chevron-right`  | Expand / forward / link              | internal SVG        |
| `chevron-down`  | Collapse                             | internal SVG        |
| `check`          | Checkbox tick                        | internal SVG        |
| `grip`           | Drag handle                          | internal SVG (3×3)  |
| `dot`            | On / off indicator                   | `●` in text         |
| `link`           | VS Code status bar default           | `$(link)` codicon   |
| `settings-gear`  | Dashboard → panel launch             | `$(settings-gear)`  |

Codicons (`$(name)`) are used only in the native VS Code status-bar item
and quickpicks, where they're free and match the native UI. Everything
inside the webview is hand-SVG to keep the visual language consistent.

---

## 8. Components

Each component lives in `design-preview.html § Components` with all its
states rendered. Summary spec here.

### 8.1 Checkbox

- 16 × 16, 1.5 px border, `--cb-radius-sm`.
- Off: border `--cb-muted`, transparent fill.
- On: `--cb-accent` fill, `--cb-accent-fg` checkmark drawn with `clip-path`
  reveal (100 ms, ease-spring).
- Hover (off): border steps to `--cb-fg`.
- Focus: 2 px offset ring in `--cb-focus`.

### 8.2 Buttons

| Variant       | Idle                             | Hover                         | Active                       |
| ------------- | -------------------------------- | ----------------------------- | ---------------------------- |
| Primary       | `--cb-accent` bg, white fg       | `--cb-accent-hover`           | `--cb-accent-active`         |
| Ghost         | transparent, `--cb-border`       | `--vscode-list-hoverBackground`, border `--cb-fg` | `--cb-surface-pressed` |
| Destructive   | transparent, `--cb-off` text     | `--cb-off` 10 % bg            | `--cb-off` 16 % bg           |
| Link          | text only, no chrome             | underline in `--cb-accent`    | —                            |

Height: **28 px** standard, **24 px** compact, **32 px** primary in CTA
positions (setup card, top of settings panel).

### 8.3 Toggle row

Grid `[16 px] [1fr]`, 7 px vertical padding, 6 px horizontal. Sublabel
appears below label only when the toggle is *off* or has a non-default
state. Rationale: the sublabel is a hint, not decoration — once you know
what "Context injection" does, you don't need to read it every time.

### 8.4 Preset selector

**Four pills in a row** (Minimal · Default · Power · Cost). A fifth
"Custom" pill appears to the right only when no built-in matches. Each
pill:

- Inactive: `ghost`, 12 px, 600 weight.
- Active: `--cb-accent` bg, white fg, `ease-spring` 120 ms on activation.
- Disabled: 50 % opacity, `cursor: not-allowed`.

Description of the active preset in `--cb-t-hint` below the pill group,
always one line (truncate with ellipsis).

### 8.5 Segment row

Grid `[16] [16] [1fr] [auto]` for `[drag][check][label][preview]`. Drag
handle at 30 % opacity, steps to 100 % on row hover (80 ms). Preview is a
`--cb-t-mono-sm` chip with `--cb-surface-raised` background and
`--cb-radius-sm`. Drag states:

- `.dragging`: original row drops to 40 % opacity, no transform.
- `.drag-over`: 1 px terracotta border, subtle 2 px transform down.
- Commit: drop shadow fades over 180 ms as the row settles.

### 8.6 Install badge (post-setup)

Compact pill, radius md. Variants:

- **User** — dot in `--cb-on`, text "Installed at User"
- **Project** — dot in `--cb-on`, text "Installed at Project", folder-name
  chip
- **Project (local)** — dot in `--cb-on`, text "Installed locally"
- **Multiple** — one dot, text "Installed at 3 locations", expandable on
  click

A "Manage" ghost button sits to the right if the full settings panel isn't
already open.

### 8.7 Cards

- **Default** card: `--cb-surface-raised` + `--cb-elev-1`, radius md,
  `--cb-space-4` padding.
- **Accent** card: `--cb-accent-subtle` + `--cb-elev-2`, radius lg,
  `--cb-space-6` padding. Used for the first-run card and occasionally
  for empty states that promote a primary action.

### 8.8 Dropdown / select

Native `<select>` with a custom chevron via CSS `background-image`. Height
28 px. Padding 4 / 8. Focus ring identical to checkbox.

### 8.9 Inputs

Same height, same radius, same focus ring as dropdowns. Placeholder text
in `--cb-muted`. Invalid state: 1 px `--cb-off` border, no red background.

### 8.10 Section eyebrow

Pattern reused above every section:

```
EYEBROW                                                         hint
```

Left `--cb-t-caps` in `--cb-muted`. Right `--cb-t-hint` in `--cb-muted` at
70 % opacity. Single-line flex row, `justify-content: space-between`.

### 8.11 Separator

1 px horizontal rule in `--cb-border`. Used once under the brand header in
the sidebar. Avoided everywhere else (rhythm does the work).

### 8.12 Tooltip

Used on the VS Code status-bar item and on webview rows with truncated
text. Markdown-capable, follows VS Code's native popover chrome. Content
structure:

```
[brand mark] Claude Bridge                                 v2.4.3

●  Context injection    on
●  Status line          on
●  Auto-open            off

────
SELECTION
`path/to/file.ts`
lines 12–45 · 33 lines
●  Delivered to Claude Code 4s ago.

────
[Open dashboard] · [Preview] · [Settings]
```

---

## 9. Layout — Sidebar dashboard

The dashboard is always single-column, fits a 280 – 360 px wide sidebar.
Vertical rhythm uses `--cb-space-3` between sections.

```
┌────────────────────────────────────────────┐
│  ✱  Claude Bridge                  v2.4.3  │   brand header (48 px tall)
├────────────────────────────────────────────┤   hairline
│                                            │
│  ● Context injection                       │
│  ● Status line                             │   toggles
│  ● Auto-open edited files                  │
│                                            │
│  PRESET                                    │
│ [Minimal][Default][Power][Cost] [Custom]   │   pill group
│   Selection + model + branch + bar.        │   hint
│                                            │
│  SEGMENTS               Drag to reorder    │   eyebrow + hint
│  ┌──────────────────────────────────────┐  │
│  │ ⋮  ● Model            Opus 4.7       │  │
│  │ ⋮  ● Git branch       main           │  │
│  │ ⋮  ● Context bar      ████░░░ 24%    │  │
│  │ ⋮  ● Tokens used      45k            │  │
│  │ ⋮  ○ Cost             $0.12          │  │
│  │ ⋮  ○ Lines changed    +42 −3         │  │
│  │ ⋮  ○ Rate limits      5h:12% 7d:3%   │  │
│  │ ⋮  ● Editor selection app.ts L12–45  │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ○  Installed at User    •   Manage ›      │   install badge (compact)
│                                            │
│  [ Open full settings ]                    │   footer
└────────────────────────────────────────────┘
```

Changes from today's sidebar:

- Header: wordmark + version only. No separate "DASHBOARD" eyebrow (the
  sidebar title above the webview already says it).
- Toggle sublabels removed when the feature is on.
- Preset selector swapped from dropdown to pill group.
- Segment rows use real chips for the preview values instead of styled
  code text.
- Install badge demoted to a single row at the bottom (it was stealing
  focus at the top).
- Footer button renamed "Open full settings" (one word clearer than "All
  settings…").

### First-run variant

When `setupCompleted === false`, the whole "Preset / Segments" block is
replaced by the first-run card. The toggles stay but render in a
disabled state:

```
┌────────────────────────────────────────────┐
│  ✱  Claude Bridge                  v2.4.3  │
├────────────────────────────────────────────┤
│  ● Context injection        (pending)      │
│  ● Status line              (pending)      │
│  ● Auto-open edited files   (pending)      │
│                                            │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓   │
│  ┃  Get started                        ┃   │
│  ┃                                     ┃   │
│  ┃  Install the bridge into Claude     ┃   │
│  ┃  Code to start piping selections.   ┃   │
│  ┃                                     ┃   │
│  ┃  [ Install at User scope ]          ┃   │
│  ┃                                     ┃   │
│  ┃  Advanced setup…                    ┃   │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛   │
│                                            │
└────────────────────────────────────────────┘
```

---

## 10. Layout — Settings panel

Full-width webview. Content column capped at **720 px**, centered, padded
`--cb-space-5`. Sticky scope switcher at the top, cards stacked below.

```
┌─ scope switcher (sticky) ──────────────────────────────────────┐
│  Scope:  [ Global ]  [ Workspace ]          Sources: 3 global  │
└────────────────────────────────────────────────────────────────┘

  ╭─ Hero ────────────────────────────────────────────────────╮
  │  ✱  Claude Bridge                                         │
  │  Your VS Code selection, piped straight into Claude Code. │
  │                                                           │
  │  ● Installed at User              Manage ›                │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Master toggles ──────────────────────────────────────────╮
  │  ● Context injection       …                              │
  │  ● Status line             …                              │
  │  ● Auto-open edited files  …                              │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Preset ──────────────────────────────────────────────────╮
  │  [Minimal][Default][Power][Cost][Custom]                  │
  │  Export to JSON · Import JSON · Reset to default          │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Status line ─────────────────────────────────────────────╮
  │  SEGMENTS                                                 │
  │  (segment rows, taller than sidebar)                      │
  │                                                           │
  │  STATUS-LINE PATH STYLE                                   │
  │  ( Basename | Truncated | Full )   max length: [ 30 ]     │
  │                                                           │
  │  PREVIEW                                                  │
  │  Opus 4.7 · main · ████░░░░░░ 24% · 45k · $0.12 · …       │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Context injection ───────────────────────────────────────╮
  │  MAX SELECTION LINES      [ 500 ]                         │
  │  SHOW PARTIAL LINE        ( ● on )                        │
  │  EXCLUDED PATTERNS                                        │
  │  [ .env*            × ]                                   │
  │  [ **/secrets/**    × ]                                   │
  │  + Add pattern                                            │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Auto-open edited files ──────────────────────────────────╮
  │  ( ○ off )   Diagnose auto-open…                          │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Install locations ───────────────────────────────────────╮
  │  User                     Installed  [ Uninstall ]        │
  │  Project                  —          [ Install ]          │
  │  Project (local)          —          [ Install ]          │
  ╰───────────────────────────────────────────────────────────╯

  ╭─ Danger zone ─────────────────────────────────────────────╮
  │  [ Uninstall everywhere ]    [ Reset all settings ]       │
  ╰───────────────────────────────────────────────────────────╯
```

Key decisions:

- **Single scroll** with card rhythm (no tabs, no accordion). Rationale:
  the user rarely opens this panel twice in a session; we'd rather they
  see everything at once than force clicks.
- **Sticky scope switcher** — you can flip Global ↔ Workspace without
  scrolling back up.
- **Cards are flat** (`--cb-elev-1`, not `--cb-elev-2`) — the sidebar gets
  the flat vibe, the settings panel gets the same vibe at larger scale.
- **Danger zone is the last card**, outlined in `--cb-off-border` only on
  hover. Destructive buttons require `showInformationMessage` confirm in
  code.

---

## 11. Layout — Terminal status line

Already implemented after the v3 perf pass. Brand decisions locked:

```
Opus 4.7 · main · ████░░░░░░ 24% · 45k · $0.12 · +42 −3 · 5h:12% 7d:3% · app.ts L12–45 (33)
```

- Separator `·` dim. Kept.
- Order fixed by the template in `SEGMENT_ORDER`; users reorder through
  the UI; the emitted script respects user order.
- Model: **bold, inherit fg**.
- Branch: **cyan** (`--cb-bridge` equivalent).
- Context bar: green / yellow / red threshold at 70 / 90.
- Tokens / cost / rate-limits: **dim**.
- Lines added / removed: **green / red**.
- Selection: **terracotta**, bold file name, dim `(N)` line count.

OSC-8 hyperlink on the selection: `vscode://file/<path>:<line>:1`. Clicking
the selection in any terminal that understands OSC-8 (iTerm, Alacritty,
WezTerm, recent macOS Terminal) jumps back to the source in VS Code.

Truncation order (narrow terminal):

1. Rate limits
2. Cost
3. Lines changed
4. Branch ahead/behind marks

We never drop model, branch, context bar, tokens, or selection. That's
the core signal.

---

## 12. Layout — VS Code status-bar item

Left side, priority 50. States:

| State               | Text                                 | Color                        |
| ------------------- | ------------------------------------ | ---------------------------- |
| Idle (no selection) | `$(link) Claude Bridge`              | `--vscode-foreground`        |
| Selection active    | `● app.ts L12–45`                    | `--cb-on`                    |
| Workspace excluded  | `$(circle-slash) Claude Bridge`      | `--cb-muted`                 |
| Uninstalled         | `$(warning) Claude Bridge`           | `--cb-warn`                  |
| Error               | `$(error) Claude Bridge`             | `--cb-off`                   |

Tooltip (Markdown) follows the template in §8.12.

---

## 13. Backend brand surfaces

Every string, filename, and setting key that a user might see. Locked.

### 13.1 File names

All bridge files live in `$HOME` with the `.claude-vscode-` prefix.

| File                              | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `.claude-vscode-selection.json`   | Full selection payload (for previews)          |
| `.claude-vscode-context.json`     | Minimal context blob for the UserPromptSubmit hook |
| `.claude-vscode-statusline.txt`   | Rendered selection chip the status-line script cats |
| `.claude-vscode-context-sent`     | Last-sent mtime marker (avoids re-injection)   |
| `.claude-vscode-modified.log`     | Append-only log of files Claude edits          |

The one bridge-owned file inside Claude's config directory:

| File                                         | Purpose                                      |
| -------------------------------------------- | -------------------------------------------- |
| `~/.claude/claude-bridge-statusline.sh`      | Generated status-line script                 |

Per-project marker file:

| File                                           | Purpose                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `<project>/.claude/.claude-bridge-marker`      | Tells the user-scope hook to stand down  |

**Rule:** no additions to this list without a note in PLAN.md §13.1.

### 13.2 Settings keys

All settings live under the `claudeBridge` prefix. CamelCase. Present tense.

```
claudeBridge.contextInjection       boolean
claudeBridge.statusLine             boolean
claudeBridge.autoOpenModifiedFiles  boolean
claudeBridge.maxLines               number
claudeBridge.statusLineMaxPath      number
claudeBridge.statusLinePathStyle    "basename" | "truncated" | "full"
claudeBridge.showPartialLineContext boolean
claudeBridge.statusLineSegments     SegmentEntry[]
claudeBridge.activePreset           string
claudeBridge.excludedPatterns       string[]
```

Deprecated keys (kept as no-ops through v3, removed in v4):
`claudeBridge.enabled`, `claudeBridge.settingsTarget`, `claudeBridge.debounceMs`,
`claudeBridge.contextPrefix`, `claudeBridge.autoSetup`.

### 13.3 Commands

All palette commands live under `Claude Bridge:`.

| Command                                            | Prompts       |
| -------------------------------------------------- | ------------- |
| `Claude Bridge: Open Dashboard`                    | no            |
| `Claude Bridge: Open Full Settings`                | no            |
| `Claude Bridge: Install at User…`                  | no            |
| `Claude Bridge: Install at Project…`               | picks folder  |
| `Claude Bridge: Install at Project (local)…`       | picks folder  |
| `Claude Bridge: Uninstall…`                        | picks scope   |
| `Claude Bridge: Uninstall Everywhere`              | confirms      |
| `Claude Bridge: Clear Selection`                   | no            |
| `Claude Bridge: Preview Current Selection`         | no            |
| `Claude Bridge: Export Preset to JSON…`            | save dialog   |
| `Claude Bridge: Import Preset from JSON…`          | open dialog   |
| `Claude Bridge: Diagnose Auto-open`                | no            |
| `Claude Bridge: Clear Workspace Overrides`         | confirms      |

### 13.4 Notifications

Plain, short, one-liners. See §2 for patterns. One toast per action max —
stacked toasts feel like a crash.

### 13.5 Output channel

Name: **"Claude Bridge"**. Line format:

```
[hh:mm:ss.mmm] <event> <args>
```

Example:

```
[14:03:27.418] activate v2.4.3
[14:03:27.423] installAt(user) additions=[hook,statusLine,autoOpen]
[14:03:27.451] writeStatusLineScript wrote 5733 bytes
[14:04:01.006] onDidChangeConfiguration: claudeBridge.statusLineSegments
[14:04:01.058] regenerate statusLine script
```

### 13.6 Preset JSON format

Current envelope (locked):

```json
{
  "claudeBridgePreset": 1,
  "label": "My team preset",
  "description": "Four-segment compact layout for cost-conscious teams.",
  "settings": {
    "contextInjection": true,
    "statusLine": true,
    "maxLines": 500
  },
  "segments": [
    { "id": "model", "enabled": true },
    { "id": "gitBranch", "enabled": true },
    { "id": "contextBar", "enabled": true },
    { "id": "contextPercentage", "enabled": true },
    { "id": "tokensUsed", "enabled": true },
    { "id": "cost", "enabled": true },
    { "id": "linesChanged", "enabled": false },
    { "id": "rateLimits", "enabled": false },
    { "id": "selection", "enabled": true }
  ]
}
```

The envelope version bumps only on breaking format changes.

---

## 14. Marketplace presence

### 14.1 Title

`Claude Code – VS Code Bridge` (en-dash intentional; matches the current
published title and is already indexed).

### 14.2 Tagline (short description, 140 char limit)

> Pipes your VS Code selection into Claude Code. Select code, ask a
> question — Claude sees it automatically.

### 14.3 Long description structure

1. **Hero line** — the one sentence (`Your VS Code selection, piped
   straight into Claude Code.`)
2. **What it does** — 3 short paragraphs covering: selection injection,
   status line, local-only.
3. **Highlights** — 6–8 bullets. Keep them specific: nine segments,
   drag-to-reorder, 10 ms status line, preset profiles, OSC-8 link to
   source.
4. **How it works** — ASCII diagram (kept).
5. **Install** — 3-step list.
6. **Configuration** — link to the settings panel, a few key settings
   spelled out.
7. **Privacy** — short paragraph affirming local-only.
8. **Requirements**.
9. **Changelog link**.

### 14.4 Screenshot plan (6 images)

1. **Hero** — the banner SVG rendered as PNG, 1600 × 400.
2. **Dashboard** — sidebar screenshot with a selection active.
3. **Settings panel** — cropped to the segment list + preset pills.
4. **Status line** — terminal screenshot showing the full layout.
5. **Selection injection** — split screen: VS Code on the left, Claude
   Code prompt on the right, with the context blob visible.
6. **First-run** — the setup card on an empty dashboard.

All screenshots use the Claude Code dark theme + VS Code Dark+ theme.
Monospace font rendering at 14 px. No OS chrome beyond what each product
already shows.

### 14.5 Marketplace keywords

`claude`, `claude-code`, `anthropic`, `ai`, `selection`, `bridge`,
`statusline`, `context`, `terminal`, `cli`, `vs-code`. Eleven is enough —
don't load it up to feel thorough.

### 14.6 Categories

`AI`, `Other`. Already set. Add `Visualization` only if VS Code adds a
"Terminal" category in the future.

---

## 15. States & flows

All rendered side-by-side in `design-preview.html § States`. Numbered so
the preview can deep-link.

| #  | Setup | Install | Selection | Workspace override | Rendered                             |
| -- | ----- | ------- | --------- | ------------------ | ------------------------------------ |
| S1 | no    | none    | —         | —                  | First-run card, dim toggles          |
| S2 | yes   | user    | —         | —                  | Normal dashboard                     |
| S3 | yes   | user    | active    | —                  | Normal + live selection chip         |
| S4 | yes   | project | —         | —                  | Normal + "Project install" ribbon    |
| S5 | yes   | user    | —         | yes                | Normal + "Workspace overrides" banner|
| S6 | yes   | multi   | —         | —                  | Normal + "3 installs" badge          |
| S7 | yes   | user    | —         | disabled           | Dim sections, hint copy              |
| S8 | yes   | user    | —         | no workspace       | Normal + "No workspace" ghost        |

Flows:

- **Install flow** — setup card → choose scope → confirm → dashboard
  renders with new badge. 280 ms card slide-out, 180 ms dashboard
  sections fade-in.
- **Uninstall flow** — "Uninstall" button → modal confirm → badge flips
  to "Not installed" → setup card reappears. 280 ms symmetric.
- **Preset apply** — click pill → pills re-render (120 ms spring) →
  segment list re-renders (staggered 20 ms per row, total ≤ 180 ms).
- **Workspace override set** — row border briefly flashes terracotta
  (600 ms total, fade-in 80 ms, hold 200 ms, fade-out 320 ms).

---

## 16. Motion catalogue

Full list with the canonical token and the event that triggers it.

| Event                              | Duration | Easing     | Property                 |
| ---------------------------------- | -------- | ---------- | ------------------------ |
| Button hover                       |  80      | out        | `background`, `border`   |
| Toggle check → fill                | 100      | spring     | `clip-path`, `background`|
| Row hover                          |  80      | out        | `background`             |
| Section disabled fade              | 180      | out        | `opacity`, `filter`      |
| Preset pill activate               | 120      | spring     | `background`, `color`    |
| Drag pick-up                       | 120      | ease-in-out| `transform`, `shadow`    |
| Drop into slot                     | 180      | ease-in-out| `transform`              |
| Setup card mount                   | 280      | out        | `opacity`, `translateY`  |
| Install badge → full row (first)   | 280      | ease-in-out| `max-height`, `opacity`  |
| Workspace-override flash           | 600      | custom     | `border-color`           |
| Segment list staggered re-render   | 180      | out        | `opacity`                |

All respect `prefers-reduced-motion`.

---

## 17. Accessibility

- **Minimum contrast** 4.5:1 for body text on any surface, 3:1 for large
  titles. Tokens chosen to clear this on both VS Code Dark+ and Light+.
- **Focus ring** always visible on keyboard navigation; never removed by
  `outline: none` without a custom replacement.
- **Reachable order**: header → toggles → preset → segments → install
  badge → footer. Tab order matches visual order.
- **Drag reorder keyboard fallback**: `Up / Down` move the focused
  segment; `Space` to pick-up, `Enter` to commit. (New in v3.)
- **Screen readers**: each row has `aria-label` including label + current
  state + preview. "Model, on, currently Opus 4.7."
- **Reduced motion**: §16.

---

## 18. Performance budget

| Surface                      | Budget   | v2.4.3 baseline |
| ---------------------------- | -------- | --------------- |
| Status-line script / run     | 10 ms    | ~10 ms ✓        |
| Webview state broadcast      | 50 ms    | ~180 ms ✗       |
| Dashboard first paint        | 120 ms   | unmeasured      |
| Toggle latency (click→disk)  | 60 ms    | ~200 ms ✗       |
| Drag reorder commit          | 80 ms    | ~120 ms         |
| Extension activation         | 250 ms   | unmeasured      |

Wins we'll ship:

- **Diff-render** in `webview/sidebar/main.ts` and
  `webview/settings/main.ts`. Each section keeps its DOM; only changed
  rows update.
- **Preload** `tokens.css` in both webview HTMLs (`<link rel="preload">`).
- **Coalesce** onDidChangeConfiguration work already debounced at 50 ms;
  also coalesce `writeStatusLineScript` calls within the same tick.
- **Selection debounce** stays at 10 ms; already tuned.
- **Activation** — defer `initFileOpener` until after first paint of the
  sidebar (it watches a log file, not time-critical).

---

## 19. Open decisions

One pick per row. My preferred option marked **(pick)**. All variants
rendered in `design-preview.html § Decisions`.

| #   | Decision                                | Options                                                                                  |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| D1  | Accent usage                            | A fill everywhere · **B focus/primary only (pick)** · C no accent                        |
| D2  | Sidebar header                          | A logo + title + version · **B logo + title, version inline right (pick)** · C monogram  |
| D3  | Section separation                      | A flex gaps · **B eyebrow + gap (pick)** · C elevated cards                              |
| D4  | Checkbox fill animation                 | A instant · **B clip-path reveal (pick)** · C fade + scale                               |
| D5  | Drag handle                             | A always visible · **B fade-in on hover (pick)**                                         |
| D6  | Preset selector                         | A dropdown · **B pill group (pick)** · C segmented                                       |
| D7  | Segment preview                         | **A mono chip (pick)** · B below label · C tooltip only                                  |
| D8  | Install state when complete             | A hide · **B compact badge (pick)** · C inline ribbon                                    |
| D9  | Settings panel structure                | **A single scroll + sticky scope (pick)** · B tabs · C accordion                         |
| D10 | Selection color in status line          | A cyan · **B terracotta (pick)**                                                         |
| D11 | No-workspace state                      | A hide toggles · **B dim + hint (pick)**                                                 |
| D12 | Primary CTA copy                        | A "Install" · **B "Install at User scope" (pick)** · C "Get started"                     |
| D13 | Footer button text                      | A "All settings…" · **B "Open full settings" (pick)**                                    |
| D14 | Marketplace banner bg                   | A flat dark · **B dark gradient + hairline rule (pick, current)** · C flat off-white     |
| D15 | Wordmark weight                         | A 500 · **B 600 (pick)** · C 700                                                         |
| D16 | Settings keys deprecation               | A remove in v3 · **B no-op through v3, remove v4 (pick)**                                |
| D17 | Preview tag font                        | A UI · **B editor mono (pick)**                                                          |
| D18 | "Claude Bridge" vs "claude-bridge"      | **A Title Case in UI, kebab in code (pick)** · B single form                             |

If you're happy with every pick, reply "ship it" and I'll go in the order
in §20. Otherwise name the overrides (`D3: A, D6: C, …`).

---

## 20. Implementation order

Each step is its own commit. None of them change architecture; each is a
drop-in replacement for a file or set of files that already exists.

1. **Tokens rewrite.** `webview/shared/tokens.css` per §4–§6. No DOM
   changes yet. Visual diff only. (~80 LoC)
2. **Components pass.** Checkbox animation, buttons, eyebrow helper,
   badge — in both webviews. (~180 LoC)
3. **Sidebar layout.** Apply §9. Hook diff-render. (~220 LoC)
4. **Settings panel layout.** Apply §10. Hook diff-render. (~260 LoC)
5. **Motion + micro-interactions.** §11, §16 across both surfaces.
   (~120 LoC)
6. **States / flows.** Install, uninstall, preset apply, workspace
   overrides. (~140 LoC)
7. **Perf pass.** Preload, diff, coalesce. (~80 LoC)
8. **Backend copy pass.** Every `showInformationMessage` /
   `showErrorMessage` call normalized to §2 voice. Log channel lines
   normalized to §13.5. (~60 LoC)
9. **Marketplace refresh.** README, tagline, screenshots (PNG exports
   from `design-preview.html`). (docs-only commit)
10. **Tag and publish.** v3.0.0. Changelog written in §2 voice.

Each step should be reviewable in ≤ 10 minutes. No step introduces a
regression in the other steps — they're strictly additive or in-place
replacements.

---

## Appendix A — Token export (for the implementation pass)

```css
:root {
  /* color */
  --cb-accent:          #D97757;
  --cb-accent-hover:    #E48770;
  --cb-accent-active:   #C86B4F;
  --cb-accent-subtle:   rgba(217, 119, 87, 0.10);
  --cb-accent-border:   rgba(217, 119, 87, 0.36);
  --cb-accent-fg:       #FFFFFF;
  --cb-bridge:          #4FC3F7;
  --cb-bridge-subtle:   rgba(79, 195, 247, 0.10);
  --cb-fg:              var(--vscode-foreground);
  --cb-muted:           var(--vscode-descriptionForeground);
  --cb-surface:         transparent;
  --cb-surface-raised:  rgba(255, 255, 255, 0.025);
  --cb-surface-pressed: rgba(255, 255, 255, 0.05);
  --cb-border:          rgba(128, 128, 128, 0.18);
  --cb-border-strong:   rgba(128, 128, 128, 0.30);
  --cb-focus:           var(--vscode-focusBorder);
  --cb-on:              var(--vscode-testing-iconPassed, #73c991);
  --cb-off:             var(--vscode-charts-red, #f14c4c);
  --cb-warn:            var(--vscode-charts-yellow, #e2b93b);
  --cb-info:            var(--cb-bridge);

  /* type */
  --cb-font-ui:         var(--vscode-font-family);
  --cb-font-mono:       var(--vscode-editor-font-family, ui-monospace,
                          SFMono-Regular, "SF Mono", Menlo, monospace);

  /* spacing */
  --cb-space-1:   4px;
  --cb-space-2:   8px;
  --cb-space-3:  12px;
  --cb-space-4:  16px;
  --cb-space-5:  24px;
  --cb-space-6:  32px;
  --cb-space-7:  48px;

  /* radius */
  --cb-radius-sm:  3px;
  --cb-radius-md:  6px;
  --cb-radius-lg: 10px;
  --cb-radius-full: 9999px;

  /* motion */
  --cb-dur-fast:    100ms;
  --cb-dur-normal:  180ms;
  --cb-dur-slow:    280ms;
  --cb-ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --cb-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* elevation */
  --cb-elev-0: none;
  --cb-elev-1: inset 0 0 0 1px var(--cb-border);
  --cb-elev-2: inset 0 0 0 1px var(--cb-accent-border);
}

@media (prefers-color-scheme: light) {
  :root {
    --cb-accent-hover:    #C8684A;
    --cb-surface-raised:  rgba(0, 0, 0, 0.025);
    --cb-surface-pressed: rgba(0, 0, 0, 0.05);
    --cb-elev-1:          0 1px 2px rgba(0, 0, 0, 0.04);
    --cb-elev-2:          0 2px 8px rgba(217, 119, 87, 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --cb-dur-fast:   0ms;
    --cb-dur-normal: 0ms;
    --cb-dur-slow:   0ms;
  }
}
```
