# Changelog

All notable changes to **Claude Bridge** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 3.2.8

### Added

- **Sidebar first-run card** now shows a numbered three-step walkthrough: *Install → Select code → Ask Claude*. Makes the product's job self-explanatory before install.
- **"How it works" card** at the top of the settings panel with the same three steps + a line about pin / multi-cursor / diagnostics. Dismissible — state persists in `globalState` so it doesn't nag you after you've read it once.

### Changed

- Copy in the first-run card explains the wedge ("pipes your VS Code selection into Claude Code's terminal so Claude always knows what you're looking at") instead of just "install into Claude Code."

---

## 3.2.7

### Fixed

- **Preview matches what Claude actually receives.** `Claude Bridge: Preview Current Selection` now runs the same pipeline as the live writer — multi-cursor regions, diagnostics, and pinned context are all included. Previously the preview only showed the primary selection, so the "you have +2 regions" status line disagreed with what the preview reported.

---

## 3.2.6

### Fixed

- **Multi-cursor now actually works.** Selections used to be gated by whether *the primary cursor* had non-empty text — if your leader cursor was empty but secondary cursors had selections, nothing was injected. Now we pick the first non-empty selection as primary and bundle every other non-empty region into the context.
- **Multi-cursor is visible in the status line.** Terminal selection segment appends ` +N` when there are extra regions: `app.ts L12–45 +2 (33)`. VS Code status-bar item mirrors it: `● app.ts L12–45 +2`. Tooltip reads naturally.

---

## 3.2.5

### Removed

- **Session stats strip** and its toggle. Sidebar goes back to pure configuration — brand / setup / toggles / preset / segments / footer. No passive telemetry widget, no setting to manage it.

---

## 3.2.4

### Removed

- **All diff / review / accept / revert tooling.** Git-diff-to-Claude command, `Send Git Diff` keybinding + editor-context entry, the `Claude's edits this session` picker with *Diff vs. HEAD / Accept / Revert* per file, the *Ask Claude about this failure* lightbulb on failing tests, the CodeLens row on Claude-edited files, the test-failure CodeLens, and their settings (`codeLensClaudeEdits`, `codeLensTestFailures`).
- Session-log persistence across VS Code reloads.
- *Claude edits review* card in the settings panel.
- Lightbulb menu slims to: *Pin selection*, *Preview*, *Clear selection* (when selected), and *Inject enclosing symbol* (always).

### Rationale

Review of Claude's changes is outside the wedge — VS Code's native git UI, Source Control view, and diff editor already cover it well. Claude Bridge stays focused on the editor → Claude handoff.

---

## 3.2.3

### Changed

- **Sidebar is back to configuration-only.** Removed the six-button "Session" wizard added in 3.2.1. All actions now live on the editor lightbulb (3.2.2). Sidebar = toggles / preset / segments / session stats.
- **Status-bar click opens the dashboard again** (not the Command Center). The Command Center quickpick is still available as a palette command for anyone who wants it, just not wired to any UI surface by default.
- **Settings → Command Center card** simplified: toggle the inline lightbulb + the session stats strip. No shortcut cheat sheet, no status-bar click option.

---

## 3.2.2

### Added

- **In-file lightbulb** (`💡`) with Claude Bridge actions. Place the cursor or make a selection, click the lightbulb that appears, pick any action — no shortcuts, no sidebar, no status-bar. Menu items are selection-aware: with a selection you get *Pin* / *Preview*; always available: *Inject enclosing symbol* / *Send git diff* / *Open Command Center*.
- Setting: `claudeBridge.showInlineActions` (default `true`). Turn off if the lightbulb is noisy for you.

---

## 3.2.1

### Changed

- **Sidebar wizard.** The three small "session" buttons become a proper six-row wizard panel: each row a big clickable card with icon, label, inline description, and a count chip where relevant. Rows: *Inject current symbol · Pin this selection · Send git diff · Pinned selections · Recent selections · Claude's edits*. Each runs the same commands the Command Center ran, so keyboard shortcuts become optional — every action is one click from the dashboard.
- **Dropped the Keyboard Shortcuts cheat sheet** from the settings panel — shortcuts still work and can still be rebound via VS Code's Keyboard Shortcuts UI, they're just no longer advertised.

---

## 3.2.0

Sharpness release — every new feature reachable from the editor or the status-bar Command Center, no dashboard diving required.

### Added

- **Pinned context.** Pin a selection with `⌘⇧⌥P` (Mac) / `Ctrl+⇧+Alt+P` — Claude sees it on every prompt until unpinned. Optional note per pin. Persisted to `~/.claude-vscode-pinned.json` so pins survive VS Code reloads.
- **Git diff as context.** `⌘⇧⌥G` (or palette) → picks *Working tree* / *Staged only* / *PR vs. default branch*, injects the diff (capped at 2 000 lines) into Claude's context.
- **Multi-cursor selections.** When you have more than one cursor, every selected region gets bundled into the injected context. Toggle: `claudeBridge.multiCursorSelection`.
- **Command Center.** Clicking the `Claude Bridge` status-bar item opens a unified quickpick with every action + its keybind — one entry point, no dashboard diving. Opens with `⌘⇧⌥C`.
- **CodeLens on Claude-edited files.** Inline `✱ Claude edited this file · N edits` row with *Diff vs HEAD*, *Accept* (drop from log), *Revert* (git checkout HEAD).
- **CodeLens on failing tests.** Inline `✱ Ask Claude about this failure` row above every error diagnostic in test files. One click writes the failure message + enclosing symbol into Claude's context.
- **Session strip** at the top of the sidebar: `N selections sent · M files Claude edited · K pinned`. Live-updating, passively visible.
- **Diagnostics toggle.** The diagnostics auto-injection from 3.1 is now togglable via `claudeBridge.includeDiagnostics`.
- **Editor context menu submenu.** Right-click in an editor → *Claude Bridge* → Pin / Inject current symbol / Send git diff.
- **Persistent Claude-edits log.** Restored across VS Code reloads via `globalState`.

### Fixed

- *Show Claude's Edits* diff button now opens a proper two-pane `HEAD ↔ working` diff view (previously silently fell back to opening the file because the internal `git:` URI scheme isn't stable).

### Settings (new)

| Key | Default | Purpose |
|---|---|---|
| `claudeBridge.includeDiagnostics` | `true` | Diagnostics in context |
| `claudeBridge.multiCursorSelection` | `true` | Bundle all cursors |
| `claudeBridge.pinnedContextEnabled` | `true` | Allow pinned context |
| `claudeBridge.codeLensClaudeEdits` | `true` | CodeLens on Claude-edited files |
| `claudeBridge.codeLensTestFailures` | `true` | CodeLens on failing tests |
| `claudeBridge.commandCenterOnStatusClick` | `true` | Status-bar click opens Command Center |
| `claudeBridge.showSessionStats` | `true` | Session strip in sidebar |

### Deferred to 3.3

- LSP-powered resolved-type injection (the `includeTypeContext` setting exists but the UI and backend aren't wired yet).
- Transcript search across `~/.claude/projects/*/transcript.jsonl`.

---

## 3.1.0

New workflow features that sharpen the "select and ask" wedge.

### Added

- **Diagnostics in the injected context.** If the selected lines have a red/yellow squiggle (TypeScript error, ESLint warning, linter complaint), Claude gets the diagnostic message appended to the context block — so asking "why does this break?" gives Claude the actual error without you having to paste it.
- **Inject current symbol (`⌘⇧I` / `Ctrl⇧I`).** One shortcut sends the enclosing function / class / method at your cursor — no manual selection required. Uses VS Code's document-symbol provider.
- **Recent selections (`Claude Bridge: Recent Selections…`).** Last ten selections surfaced in a QuickPick; picking one re-opens the file and reselects the range (which re-injects automatically). Ring-buffered in memory, de-duplicated on same range.
- **Claude's edits this session (`Claude Bridge: Show Claude's Edits…`).** Running session log of every file Claude edits. Per-file buttons in the picker: *Diff vs. HEAD* opens VS Code's two-pane diff editor, *Revert to HEAD* runs `git checkout HEAD -- <file>` after a confirm. A *Clear* button on the picker header empties the session log without touching files.
- **Sidebar "Session" section.** Three new buttons at the bottom of the dashboard: *Inject current symbol*, *Recent selections* (with a live count), *Claude's edits this session* (with a live count). Counts highlight terracotta when non-zero.

### Changed

- `fileOpener.ts` refactored: the edits watcher now runs unconditionally; the auto-open toggle only decides whether to open files as they appear. Tracking is always on so the edits log is populated regardless.

---

## 3.0.1

### Fixed

- Activity-bar icon: the brand spark sat 1 unit above the chevron midpoint. Re-centered on (12, 12).

---

## 3.0.0

Full v3 brand + performance rewrite. Most visible changes land in the status-line script, the sidebar dashboard, and the settings panel.

### Added

- **Brand mark on the status line.** Every rendered line opens with a dim terracotta `✱` so you can tell at a glance which line is Claude Bridge's.
- **Terracotta separator** between segments — subtle, constant brand presence.
- **High-context warning.** `⚠` appears before the bar / percentage when context usage reaches 90 %.
- **Branch hyperlink.** The git-branch segment becomes an OSC-8 clickable link to the remote tree page for GitHub / GitLab / Bitbucket repos. Supporting terminals (iTerm, WezTerm, recent macOS Terminal) make it clickable.
- **`claudeBridge.statusLineBarStyle`** — context-bar glyphs: `blocks` (█░, default), `squares` (■□), `shades` (▓░), or `dots` (●○). Live preview follows the choice.
- **`claudeBridge.statusLineCompact`** — drops the separators between segments for tighter rendering in narrow terminals.
- **`tokensUsed` segment.** Sums `context_window.total_input_tokens + total_output_tokens` and renders as a compact `45k` / `1.2m`.
- **Max Lines preview** in the settings panel showing a mock truncated selection so the limit is tangible.
- **Partial-line preview** showing exactly what Claude receives with the toggle on vs. off.
- **Status-bar item reacts to injection state.** Dot goes green when the hook has delivered the selection, yellow while pending, `circle-slash` when context injection is turned off — you see at a glance whether your selection has actually reached Claude.
- **Perf instrumentation** on both webviews. Every state broadcast logs `perf sidebar.render <ms>` / `perf settings.render <ms>` to the *Claude Bridge* output channel.

### Changed — performance

- **Status-line script: ~160 ms → ~10 ms per run.** Eliminated the ~100 ms `git status --porcelain` fork by reading `.git/HEAD` directly, and replaced every `jf` / `jn` / `jnested` grep/sed/tr pipeline (~50 forks) with bash built-in regex via `[[ =~ ]]`. Trade-off: no dirty marker / ahead-behind on the branch.
- **Webview diff-render.** Hot sections (master toggles, preset pills, segment list) build their DOM once and mutate existing nodes on subsequent state broadcasts. No more full-tree rebuilds on every toggle click.
- **`refreshInterval: 1`** (from `1000`) so segment toggles land in the status line on the next Claude tick.
- **`<link rel="preload">`** on the shared tokens stylesheet in both webview HTMLs.

### Changed — UX

- **Single install scope — user only.** The project- and project-local install paths, the marker-file mutex, and the hook-command variants are gone. `claudeSettings.ts` is ~230 LoC (was ~530).
- **Workspace-scope override plumbing removed.** Every `claudeBridge.*` setting now writes to Global. The sticky Global/Workspace switcher and the "Clear workspace overrides" button are gone.
- **Presets are dropdowns again** (both webviews). Pills took too much width.
- **`contextBar` and `contextPercentage` are independent.** Disabling the bar no longer hides the percentage, and vice-versa.
- **Context injection card gets visible spacing.** Wrapper divs inside cards (`#context-fields`, `#master-rows`, …) render as flex columns with `var(--cb-space-4)` gap so subsections don't butt up against each other.
- **Settings panel trimmed.** Removed the Danger Zone (redundant with the Install card's Uninstall button), the install-locations grid (user-only now), and the two-toggle redundancy on auto-open.
- **Sidebar trimmed.** Removed the compact install badge at the bottom — "Manage ›" duplicated the footer's "Open full settings". Empty `#setupSection` collapses so there's no phantom gap under the header.
- **Toggle rows centered** on their label + description stack. Matches segment rows.
- **Notifications normalized** to `Claude Bridge: <past-tense verb> <object>.`
- **Activity-bar icon** chevrons pushed to the edges of the 24×24 canvas, strokes thickened to 2.1 px so the mark holds its own next to built-in codicons.

### Changed — brand

- **Logo redesigned.** Circular medallion in a dark-gradient badge with a thin terracotta ring; white chevrons + terracotta spark inside. PNG rendered with `@resvg/resvg-js` to preserve alpha.
- **Banner redesigned.** Dropped cyan in favour of white chevrons. Thicker strokes (12 px) + heavier wordmark (54 px / 800) so the mark carries weight.
- **`galleryBanner`** set in `package.json` (`#1C1C1E`, dark theme) so the marketplace listing header matches the brand.
- **README rewritten** — minimal, text-only, no external badge dependencies.
- **New design spec.** `PLAN.md` is the source of truth for the brand and design system; `design-preview.html` is the live browser-renderable version of every component.

### Removed

- `outputStyle`, `thinking`, `sessionDuration` segments (Claude Code doesn't emit the underlying data, so they were always empty).
- Settings keys: `enabled`, `settingsTarget`, `debounceMs`, `contextPrefix`, `autoSetup` were already deprecated in v2.x and are now fully gone.
- Commands: `claudeBridge.installAt`, `claudeBridge.uninstallAt`, `claudeBridge.clearProjectOverrides` replaced by the single `install` / `uninstall` / (no workspace-overrides command) pair.

### Fixed

- **Statusline title flicker.** Script runs in ~10 ms so macOS Terminal's "current foreground process" display no longer flashes `bash ↔ claude` several times per second.
- **Cost segment disappearing when tokens were enabled.** `visible_width` was byte-counting UTF-8 characters, over-reporting width and tripping truncation. Swapped to locale-aware `wc -m`.
- **Context-bar / % truncation needle.** The old `"m "` truncation needle was matching ANSI reset escapes and silently dropping unrelated segments. Removed.
- **BSD sed `\x1b` escape.** macOS `sed` doesn't interpret hex escapes in patterns; we pass real escape bytes via `$'…'` now.
- **Spurious toast storm on config change.** The "Restart Claude Code" notification no longer fires on self-heal / auto-install paths.

### Breaking

- Multi-scope install (project / project-local) is removed. Existing project-scope installs keep working — the hooks stay on disk — but the UI no longer manages new project installs. *Uninstall Everywhere* still cleans them.
- `claudeBridge.statusLineSegments` no longer accepts `outputStyle`, `thinking`, or `sessionDuration`. Those entries are silently dropped on load.

---

## 2.3.0

Three independent install scopes, marker-file mutex, dim-over-hide, and a proper Installations card.

### Added

- **Three install scopes, independently managed.** *User* (`~/.claude/settings.json`), *Project* (`<folder>/.claude/settings.json`, git-shared), and *Project local* (`<folder>/.claude/settings.local.json`, gitignored). Each row in the Installations card has its own Install / Uninstall button and live status dot.
- **Marker-file mutex.** The user-scope hook checks for `<folder>/.claude/.claude-bridge-marker` and exits early when a project-scope install is present — so you never get double-fire. Uninstalling the project-scope install removes the marker and the user scope resumes firing.
- **Recommended tag** on the User scope with a one-liner explaining when each scope makes sense.
- **Multi-root workspace folder picker** on Project-scope installs: clicking Install surfaces a QuickPick with every open folder.
- **Uninstall Claude Bridge (everywhere)** command — nukes every install location, clears all VS Code-scope preferences, resets the welcome state. Opt-in via the command palette.

### Changed

- **Disabled ≠ hidden.** Sections whose prerequisites are off (Bridge disabled, Status line off, etc.) dim and become non-interactive instead of vanishing. Each dimmed section shows a tiny reason hint in the top-right so users understand what to enable to make it work.
- **Sidebar shows compact install status.** First-run renders *Install for all projects* + *Other install options…*. After install, a badge summarizes which scopes are active with a *Manage installations* link to the full panel.
- **Installations section** replaces the old "Setup" one-click card in the full settings panel.
- `refreshInterval` for the Claude Code statusLine switched from `1` (1 ms, terminal tab thrash) to `1000` (1 s).

### Fixed

- **Bridge toggle now respects existing scope.** If a workspace-scope value was defined, toggling no longer silently writes to Global where it got shadowed. Writes land at the scope where the value is defined unless the webview explicitly picks one.
- **Settings.local.json migration is surgical** — it only strips our own stale entries during scope migration, never custom hooks other extensions put there.

---

## 2.2.0

The setup story is now **install once, customize per project**.

### Changed — setup flow

- **Single-install model.** Setup is one click: installs the hook and status-line script in `~/.claude/settings.json`. No more picking between *User / Project / Project local / Ask*.
- **Per-project customization via VS Code settings.** Every `claudeBridge.*` preference can be overridden at the workspace level using VS Code's native settings layering. Workspace values take precedence over user defaults automatically — no hook double-fire, no overlap.
- **Injection indicator in the status-bar tooltip.** The hook marks each selection as *Delivered* or *Queued*. Hover the status-bar item to see exactly what Claude Code has or has not yet picked up.
- **Session-duration segment now also shows seconds** for very short sessions (previously silent under one minute).
- **Output style + Thinking segments** added (off by default). Output Style reads `output_style.name` from Claude Code's statusline JSON; Thinking probes `thinking` / `reasoning_effort` / `thinking_level`.

### Removed

- `claudeBridge.settingsTarget` — no longer meaningful.
- `claudeBridge.settingsTargetFolder` — no longer needed.
- `claudeBridge.autoSetup` — replaced by the one-click install button.
- Old commands: *Set Up Claude Code Integration*, *Remove Claude Code Configuration*.

### Added

- **Commands:** *Install Claude Bridge*, *Clear Project Overrides*, *Uninstall Claude Bridge*, *Diagnose Auto-Open Edited Files*.
- **Project-aware remove.** Uninstall scans every possible settings path (user-level and every open workspace folder's `.claude/` pair) and only strips the bridge's own entries — other hooks and settings you have there are preserved.
- **Migration safety.** Existing users with an install already present in `~/.claude/settings.json` are detected on activate and skipped past the welcome.

### Notifications

- Every change the extension makes to Claude's `settings.json` surfaces as a bottom-right notification describing exactly what was added or removed and where. No silent background writes.

---

## 2.1.0

End-to-end design pass and a handful of overdue architecture fixes.

### Added

- **New brand identity.** Refined activity-bar icon and marketplace logo (tighter chevrons + an 8-point spark in Claude terracotta). New banner in terracotta → cyan.
- **Shared design tokens.** Sidebar and full settings panel now draw from one token file — spacing, radii, motion, and the brand accent are defined once and inherited.
- **Status bar item redesign.** Always visible. Three states: *Bridge off* (dim), *Ready*, and *file · L12–45*. Click opens the dashboard. Rich tooltip shows per-feature state dots and command links (Open dashboard · Preview · Toggle bridge · Settings).
- **Status line polish.**
  - Selection segment rebranded to terracotta; the verbose `[VS Code Selection]` prefix is gone.
  - Cost rounded to 2 decimals.
  - Lines-changed split — additions in green, removals in red.
  - Git branch gains a dirty marker (`main*`) and ahead/behind indicators (`↑2 ↓1`).
  - Context-% color now matches the bar color.
  - Separator is a subtler dim `·`.
  - Smart truncation drops secondary segments when the terminal is narrow.
- **Commands.** *Claude Bridge: Open Dashboard* and *Claude Bridge: Toggle Bridge On/Off* join the palette; the latter powers the tooltip link.
- **Test suite.** Pure-function tests for `segments.ts` and `presets.ts`, plus a bash test that exercises the status-line parsers and segment markers. Run with `npm test`.

### Changed

- **`displayName`** is now `Claude Bridge` (was `Claude Code - VS Code Bridge`).
- **Top-level toggles** (*Bridge*, *Context injection*, *Status line*) now act as true master switches: flipping one off *removes* the corresponding entry from Claude Code's `settings.json`, not just the bridge's on-disk files.
- **Configuration target.** `cfg.update` now writes at the scope where a setting is actually defined (workspace-level overrides are no longer silently shadowed by writes to Global).
- **Configuration-change handler** is debounced 50 ms so applying a preset collapses ~8 sequential updates into a single sync cycle.
- **Error handling.** The silent `catch {}` blocks are gone — errors land in the *Claude Bridge* output channel.
- **Copy pass.** Every user-facing string — command titles, setting descriptions, segment labels, toasts, README — rewritten for consistency and clarity. Standardised on *Claude Code* (not "Claude CLI") throughout.

### Removed

- `media/logo.png` regenerated from the new SVG; `media/banner.png` compressed from 409 KB to 50 KB.

### Internal

- `extension.ts` split into cohesive modules: `paths.ts`, `settings.ts`, `statusLineScript.ts`, `claudeSettings.ts`, `selectionWriter.ts`. Down from 1,080 lines in one file to ~400 in the orchestrator plus peer modules.
- Shared webview code (types + drag-and-drop + nonce) extracted to `webview/shared/` and `src/webview/nonce.ts`.

---

## 2.0.0

A redesigned configuration experience for Claude Bridge.

### Added

- **Sidebar dashboard.** A compact webview replaces the old tree views — status indicators, preset picker, and drag-to-reorder segments, all in the activity bar.
- **Full settings panel.** Open with **Claude Bridge: Open Settings** (or the dashboard's *Open full settings…* button) for grouped sections, sliders, a live status-line preview, and one-click preset chips.
- **Reorderable status line segments.** Drag segments by their handle to choose the order in which they render in Claude CLI's status line.
- **Preset profiles.** Four built-ins ship in the box:
  - **Minimal** — selection only, nothing else.
  - **Default** — model, branch, context bar, percentage, selection.
  - **Power user** — every segment enabled with a larger selection buffer.
  - **Cost-conscious** — adds cost and rate-limit visibility to the default.
- **Preset import / export.** Save the current configuration as a JSON file or load a shared one. Commands: **Claude Bridge: Export Preset to JSON** / **Import Preset from JSON**.
- **`claudeBridge.activePreset` setting.** Tracks which preset is currently active; flips to `custom` automatically when you tweak.
- **New extension logo and activity-bar icon.** The bridge motif — Claude spark framed by VS Code-style angle brackets.

### Changed

- The activity-bar view is now a single webview (`claude-bridge.dashboard`) instead of two separate tree views.
- Status line script generation now honours segment order — segments are emitted in the user's chosen sequence rather than the template's hardcoded order.

### Breaking

- **`claudeBridge.statusLineSegments` schema changed** from an unordered object (`{ model: true, gitBranch: true, … }`) to an ordered array (`[{ id: "model", enabled: true }, … ]`). Existing values from 1.x are silently ignored on first launch and the default segments are restored. Reconfigure via the new settings UI.
- **Removed command** `claude-bridge.toggleSegment`. Segment toggles are handled by the dashboard.
- **Removed views** `claude-bridge.status` and `claude-bridge.segments`. Replaced by `claude-bridge.dashboard`.

---

## 1.1.2

- Use a template-based status line script to avoid TypeScript escaping issues that affected complex bash quoting.

## 1.1.1

- Sidebar tree view tweaks; minor refresh.

## 1.1.0

- Add sidebar panel with status and segment toggles.
- Configurable status line segments (model, branch, context bar, percentage, cost, lines changed, rate limits, session duration, selection).

## 1.0.x

- Initial releases — selection bridge, context injection, status line basics, partial-line markers.
