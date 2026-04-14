# Claude VS Code Bridge

See your VS Code selections in Claude CLI — in any terminal.

Select code in VS Code, ask Claude a question in your terminal, and Claude automatically sees what you selected. No copy-paste, no @-mentions, no extra steps.

## How It Works

```
VS Code                                             Claude CLI (any terminal)
(you select code)                                   (you ask a question)
      |                                                   |
      v                                                   v
Extension writes 3 files ──────────────────▶ Hook injects context
  ~/.claude-vscode-selection.json              (additionalContext)
  ~/.claude-vscode-context.json           Status line shows selection
  ~/.claude-vscode-statusline.txt            Opus · main · ████░░ 45% · @file#12-55
```

1. **VS Code extension** watches selections, writes pre-formatted files (async, atomic, deduped)
2. **UserPromptSubmit hook** (Claude Code settings) cats the context file on prompt submit — only when selection changes
3. **Status line** (Claude Code settings) shows model, git branch, context bar, and clickable `@file#lines`
4. When nothing is selected, all files are deleted — hook and status line output nothing

No MCP server. No external scripts. No dependencies beyond bash.

## Install

### 1. VS Code Extension

```bash
git clone https://github.com/Daniel-Manea/claude-vscode-bridge.git
cd claude-vscode-bridge
npm install && npm run compile
```

Then in VS Code: `Cmd+Shift+P` → "Developer: Install Extension from Location..." → select this folder.

### 2. Claude Code Settings

Add to your `~/.claude/settings.json` (or managed settings):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat>/dev/null;F=\"$HOME/.claude-vscode-context.json\";S=\"$HOME/.claude-vscode-context-sent\";[ -f \"$F\" ]||exit 0;NEW=$(stat -f%m \"$F\" 2>/dev/null||stat -c%Y \"$F\" 2>/dev/null);OLD=$(cat \"$S\" 2>/dev/null);[ \"$NEW\" = \"$OLD\" ]&&exit 0;cat \"$F\";echo \"$NEW\">\"$S\""
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "cat>/dev/null;[ -f \"$HOME/.claude-vscode-statusline.txt\" ] && cat \"$HOME/.claude-vscode-statusline.txt\"",
    "refreshInterval": 1
  }
}
```

## Features

**Context injection** — Claude sees your selection automatically when you send a message. Only re-injects when the selection changes.

**Partial selection** — Select a word on a line and Claude sees the full line with a caret marker showing what you highlighted:
```
[VS Code Selection] plugin.json#L10 (partial)
    "repository": "https://github.com/..."
                    ^^^
Selected text: "://"
```

**Status line** — Shows model, git branch, context usage bar, and current selection:
```
Opus · main · ████░░░░░░ 45% · @src/file.ts#12-55 (44 lines)
```

**Performance** — 30ms debounce, async writes, atomic rename (no half-reads), deduplication (skips if selection unchanged).

**Privacy** — Everything runs locally. No network calls. Files deleted on deselect or VS Code close. 5-minute staleness fallback.

## Requirements

- VS Code 1.85+
- Claude Code CLI
- bash, grep, sed, cat (standard on macOS/Linux)
