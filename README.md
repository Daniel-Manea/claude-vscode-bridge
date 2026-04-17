# Claude Bridge

> **Your VS Code selection, piped straight into Claude Code.**

Select code in VS Code. Ask Claude Code a question in your terminal. Claude already has your selection. No copy-paste, no `@`-mentions, no MCP server, no network, no telemetry.

---

## What it does

When you highlight code in VS Code, Claude Bridge writes three small files in your home directory. A `UserPromptSubmit` hook configured in your Claude Code settings reads those files the moment you submit a prompt, so Claude sees the selection without you having to paste it. The Claude CLI status line gets a custom rendering with your selection, model, git branch, context usage, cost, and more — plus a clickable hyperlink back to the exact file and line.

When the selection goes away, the files are deleted. The hook outputs nothing. The status line goes back to normal.

## Highlights

- **Automatic context injection.** Claude sees your selection on every prompt.
- **Custom status line.** Nine segments — model, git branch, context bar, context %, tokens used, cost, lines changed, rate limits, selection — drag to reorder, toggle to hide.
- **Preset profiles.** Minimal · Default · Power user · Cost-conscious. Export and import as JSON.
- **Live preview.** The settings panel renders the status line as you configure it.
- **Partial-line awareness.** Highlight a fragment and Claude sees the full line with caret markers showing what you picked.
- **High-context warning.** A warning mark appears before the context bar at 90 % or above.
- **Branch hyperlink.** GitHub, GitLab, and Bitbucket repos get a clickable branch name in the status line.
- **Fast.** ~10 ms per status-line tick. 10 ms debounce on selection writes.
- **Local only.** Files live in `~/.claude-vscode-*`. No MCP server, no telemetry, no network.

## How it works

```
VS Code                                          Claude CLI (any terminal)
(you select code)                                (you ask a question)
      │                                                │
      ▼                                                ▼
  Extension writes 3 files         ──────────▶   Hook injects context
    ~/.claude-vscode-selection.json               (additionalContext)
    ~/.claude-vscode-context.json                 Status line shows your selection
    ~/.claude-vscode-statusline.txt               Opus 4.7 · main · ████░░ 45% · app.ts L12–45
```

1. **Extension** watches selections, writes pre-formatted files (async, atomic, deduped).
2. **`UserPromptSubmit` hook** in `~/.claude/settings.json` reads the context file when you send a prompt — only when the selection has changed since last time.
3. **Status-line script** at `~/.claude/claude-bridge-statusline.sh` renders the segments you've enabled, in the order you set, plus the current VS Code selection.

No MCP server. No external scripts. Standard bash only.

## Install

1. Install **Claude Bridge** from the Visual Studio Marketplace, or run `code --install-extension claude-vscode-bridge-X.Y.Z.vsix` with a local `.vsix`.
2. First launch opens the dashboard. Click **Install at User scope** — this merges the hook and status-line entry into `~/.claude/settings.json`.
3. Start Claude Code in any terminal. Select code in VS Code. Your selection is in.

## Configuration

The dashboard covers day-to-day toggles, preset switching, and segment reordering. For power-user settings — path style, bar glyphs, compact mode, excluded patterns, max line count — click **Open full settings**.

### Useful settings

| Setting | Default | What it does |
|---|---|---|
| `claudeBridge.contextInjection` | `true` | Inject the selection on every prompt. |
| `claudeBridge.statusLine` | `true` | Render the status line in Claude Code. |
| `claudeBridge.autoOpenModifiedFiles` | `false` | Open files Claude edits in VS Code. |
| `claudeBridge.maxLines` | `500` | Truncate selections longer than this. |
| `claudeBridge.statusLinePathStyle` | `basename` | `basename` / `truncated` / `full` |
| `claudeBridge.statusLineBarStyle` | `blocks` | `blocks` / `squares` / `shades` / `dots` |
| `claudeBridge.statusLineCompact` | `false` | Drop the separators for tighter lines. |
| `claudeBridge.excludedPatterns` | 22 defaults | Globs that block selections from being sent (secrets, keys, env files). |

### Preset JSON

Export your configuration to share with a teammate:

```
> Claude Bridge: Export Preset to JSON…
```

The envelope is self-contained and versioned. Import on the other side with **Import Preset from JSON…**.

## Commands

| Command | What it does |
|---|---|
| Claude Bridge: Open Dashboard | Jumps to the sidebar view. |
| Claude Bridge: Open Full Settings | Opens the full settings panel. |
| Claude Bridge: Install | Adds the hook and status line to `~/.claude/settings.json`. |
| Claude Bridge: Uninstall | Removes everything cleanly. |
| Claude Bridge: Preview Current Selection | Shows exactly what Claude would receive right now. |
| Claude Bridge: Export Preset to JSON | Saves the current configuration to a JSON file. |
| Claude Bridge: Import Preset from JSON | Loads a previously exported preset. |
| Claude Bridge: Diagnose Auto-open | Prints a status report to the Output channel. |

## Privacy

Everything runs locally. The bridge writes plain-text files under your home directory and does not communicate with any external service. No MCP server, no telemetry, no network. Files are deleted when nothing is selected or when VS Code closes.

Excluded patterns (defaults cover `.env*`, `*.key`, `*.pem`, `.ssh/**`, `secrets/**`, `.aws/credentials`, and more) block matching files from ever being serialised — even if you select inside them.

## Requirements

- VS Code 1.85 or later
- Claude Code CLI installed and on `PATH`
- bash with `grep`, `sed`, `cat` (macOS and Linux have these out of the box)

## License

MIT. See [LICENSE](LICENSE).
