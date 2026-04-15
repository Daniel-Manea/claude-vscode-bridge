# Changelog

All notable changes to **Claude Bridge** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
