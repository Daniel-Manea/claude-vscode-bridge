# Claude Bridge

> **Your VS Code selection, instantly available to Claude CLI.**

Select code in VS Code, ask Claude a question in your terminal, and Claude automatically sees what you selected. No copy-paste, no `@`-mentions, no extra steps. The bridge runs entirely on your machine — no MCP server, no network, no external services.

---

## What it does

When you highlight code in VS Code, Claude Bridge writes three small files to your home directory. A hook configured in your Claude Code settings reads those files at the moment you submit a prompt, so Claude sees the selection without you having to paste it. The Claude CLI status line also gets a customisable rendering that includes your selection, the model, git branch, context usage, and more.

When the selection is empty, the files are deleted — the hook outputs nothing, the status line goes back to normal.

## Highlights

- **Automatic context injection.** Claude sees your selection on every prompt without copy-paste.
- **Customisable status line.** Nine segments — model, git branch, context bar, percentage, cost, lines changed, rate limits, session duration, selection — that you can toggle and **drag to reorder** from the new dashboard.
- **Preset profiles.** Pick from *Minimal*, *Default*, *Power user*, or *Cost-conscious* to apply a full configuration in one click. Export your tweaks to a JSON file to share with teammates, or import a shared preset.
- **Live preview.** The settings panel renders your status line as you configure it, so you see the result immediately.
- **Partial selections.** Highlight a fragment of a line and Claude sees the full line with caret markers showing what you picked.
- **Fast and quiet.** 30 ms debounce, atomic writes, deduplication. No noise when nothing is selected.
- **Local only.** Selections are written to `~/.claude-vscode-*` files. Nothing leaves your machine.

## How it works

```
VS Code                                          Claude CLI (any terminal)
(you select code)                                (you ask a question)
      |                                                |
      v                                                v
Extension writes 3 files       ──────────▶   Hook injects context
  ~/.claude-vscode-selection.json              (additionalContext)
  ~/.claude-vscode-context.json                Status line shows your selection
  ~/.claude-vscode-statusline.txt              Opus 4.6 · main · ████░░ 45% · @file#12-55
```

1. **VS Code extension** watches selections and writes pre-formatted files (async, atomic, deduped).
2. **`UserPromptSubmit` hook** in Claude Code settings cats the context file when you send a prompt — only when the selection has changed since last time.
3. **Status line script** (also configured in Claude Code settings) renders the segments you've enabled, in the order you've set, plus the current VS Code selection.

No MCP server. No external scripts. No dependencies beyond bash.

## Install

1. Install the **Claude Code – VS Code Bridge** extension from the Marketplace (or via `code --install-extension claude-vscode-bridge-X.Y.Z.vsix` if you have a `.vsix`).
2. On first launch the extension auto-configures Claude Code by merging the hook and status line entries into `~/.claude/settings.json`. You can change the target with the **Settings target** option (User / Project / Project local / Ask).
3. Open any file in VS Code, highlight some code, and run Claude in your terminal. The selection is in.

## Configuration

Open the dashboard from the Claude Bridge icon in the activity bar, then click **Open full settings…** for the complete panel.

### Available settings

| Setting | Default | What it does |
|---|---|---|
| `claudeBridge.enabled` | `true` | Master switch. When off, no files are written. |
| `claudeBridge.contextInjection` | `true` | Inject the selection into Claude's context on every prompt. |
| `claudeBridge.statusLine` | `true` | Show the status line in Claude CLI. |
| `claudeBridge.autoSetup` | `true` | Merge the hook + status line config into Claude Code settings on activation. |
| `claudeBridge.maxLines` | `500` | Selections larger than this are truncated before being sent. |
| `claudeBridge.debounceMs` | `30` | How long to wait before writing the selection. |
| `claudeBridge.statusLineMaxPath` | `30` | Max path length in the status line before truncation. |
| `claudeBridge.contextPrefix` | `[VS Code Selection]` | Prefix shown before the file path in injected context. |
| `claudeBridge.showPartialLineContext` | `true` | For partial selections, show the full line with caret markers. |
| `claudeBridge.statusLineSegments` | *ordered list* | Which segments to render and in what order. |
| `claudeBridge.activePreset` | `default` | Currently applied preset; updates automatically when you tweak. |
| `claudeBridge.settingsTarget` | `user` | Where to write Claude Code config (User / Project / Project local / Ask). |

### Status line example

```
Opus 4.6 · main · ████░░░░░░ 45% · @src/file.ts#12-55 (44 lines)
```

### Partial selection example

```
[VS Code Selection] plugin.json#L10 (partial)
    "repository": "https://github.com/..."
                    ^^^
Selected text: "://"
```

## Commands

| Command | What it does |
|---|---|
| **Claude Bridge: Open Settings** | Opens the full settings panel. |
| **Claude Bridge: Setup Claude Code Integration** | Re-runs the auto-setup; useful after you change the target. |
| **Claude Bridge: Remove Claude Code Configuration** | Removes the bridge's hook and status line entries from Claude Code settings. |
| **Claude Bridge: Preview Current Selection** | Shows what Claude will see for your current selection. |
| **Claude Bridge: Clear Selection** | Manually deletes the selection files. |
| **Claude Bridge: Export Preset to JSON** | Saves the current configuration as a JSON file you can share. |
| **Claude Bridge: Import Preset from JSON** | Loads a previously-exported preset. |

## Privacy

Everything runs locally. The bridge writes plain text files under your home directory and does not communicate with any external service. Files are deleted when nothing is selected or when VS Code closes.

## Requirements

- VS Code 1.85 or later
- Claude Code CLI
- bash, grep, sed, cat (standard on macOS and Linux)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes. The current major release (2.0) introduces the new settings UI, drag-to-reorder segments, and preset profiles, and includes a breaking change to the segment configuration format — see the changelog for details.

## License

MIT. See [LICENSE](LICENSE).
