import * as vscode from "vscode";
import * as fs from "fs/promises";
import { existsSync, unlinkSync } from "fs";
import * as path from "path";
import * as os from "os";

const HOME = os.homedir();
const SELECTION_FILE = path.join(HOME, ".claude-vscode-selection.json");
const CONTEXT_FILE = path.join(HOME, ".claude-vscode-context.json");
const STATUSLINE_FILE = path.join(HOME, ".claude-vscode-statusline.txt");
const CONTEXT_SENT_FILE = path.join(HOME, ".claude-vscode-context-sent");

const ALL_FILES = [SELECTION_FILE, CONTEXT_FILE, STATUSLINE_FILE, CONTEXT_SENT_FILE];

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastSelectionKey = "";

// Pre-allocate buffer for atomic writes — avoids GC pressure
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

async function cleanupFiles(): Promise<void> {
  lastSelectionKey = "";
  await Promise.allSettled(
    ALL_FILES.flatMap((f) => [
      fs.unlink(f).catch(() => {}),
      fs.unlink(f + ".tmp").catch(() => {}),
    ])
  );
}

function cleanupFilesSync(): void {
  lastSelectionKey = "";
  for (const f of ALL_FILES) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
    try { if (existsSync(f + ".tmp")) unlinkSync(f + ".tmp"); } catch {}
  }
}

function truncatePath(relativePath: string, maxLen: number): string {
  if (relativePath.length <= maxLen) return relativePath;
  const fileName = path.basename(relativePath);
  const available = maxLen - fileName.length - 3;
  return available > 0
    ? relativePath.slice(0, available) + "..." + fileName
    : "..." + fileName;
}

function buildContext(
  relativePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  text: string,
  fullLine: string | null,
  startChar: number,
  endChar: number
): string {
  if (fullLine !== null) {
    // Partial single-line selection — show full line with marker
    const marker = " ".repeat(startChar) + "^".repeat(endChar - startChar);
    return (
      `[VS Code Selection] ${relativePath}#L${startLine} (partial)\n` +
      `\`\`\`\n${fullLine}\n${marker}\n\`\`\`\n` +
      `Selected text: "${text}"`
    );
  }
  // Multi-line or full-line selection
  return (
    `[VS Code Selection] ${relativePath}:${startLine}-${endLine} (${lineCount} lines)\n` +
    `\`\`\`\n${text}\n\`\`\``
  );
}

function buildStatusLine(
  relativePath: string,
  absolutePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  isPartial: boolean
): string {
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  const displayPath = truncatePath(relativePath, 30);
  const lineRef = isPartial
    ? `#L${startLine}`
    : `#${startLine}-${endLine}`;
  const countLabel = isPartial
    ? "(selection)"
    : `(${lineCount} lines)`;

  const uri = `vscode://file${absolutePath}:${startLine}:1`;
  const linkText = `@${displayPath}${lineRef}`;
  const link = `\x1b]8;;${uri}\x07${linkText}\x1b]8;;\x07`;

  return `${CYAN}${BOLD}${link}${RESET} ${DIM}${countLabel}${RESET}`;
}

function writeSelection(editor: vscode.TextEditor | undefined): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    try {
      if (!editor || editor.selection.isEmpty) {
        await cleanupFiles();
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection);

      if (text.trim().length === 0) {
        await cleanupFiles();
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        editor.document.uri
      );
      const absolutePath = editor.document.uri.fsPath;
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, absolutePath)
        : path.basename(absolutePath);

      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;
      const lineCount = endLine - startLine + 1;

      // Deduplicate
      const key = `${absolutePath}:${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`;
      if (key === lastSelectionKey) return;
      lastSelectionKey = key;

      // Detect partial single-line selection
      const isSingleLine = selection.start.line === selection.end.line;
      const fullLineText = isSingleLine
        ? editor.document.lineAt(selection.start.line).text
        : null;
      const isPartial = isSingleLine && fullLineText !== null && text !== fullLineText.trim();

      // Build all content before any I/O
      const selectionJson = JSON.stringify({
        file: absolutePath,
        relativePath,
        startLine,
        endLine,
        lineCount,
        text,
        isPartial,
        fullLine: fullLineText,
        startChar: selection.start.character,
        endChar: selection.end.character,
        timestamp: Date.now(),
      });

      const contextStr = buildContext(
        relativePath, startLine, endLine, lineCount,
        text, isPartial ? fullLineText : null,
        selection.start.character, selection.end.character
      );

      const contextJson = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: contextStr,
        },
      });

      const statusLine = buildStatusLine(
        relativePath, absolutePath,
        startLine, endLine, lineCount, isPartial
      );

      // Write all 3 files in parallel with atomic rename
      await Promise.all([
        atomicWrite(SELECTION_FILE, selectionJson),
        atomicWrite(CONTEXT_FILE, contextJson),
        atomicWrite(STATUSLINE_FILE, statusLine),
      ]);
    } catch {
      // Silently fail
    }
  }, 30);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      writeSelection(event.textEditor);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      writeSelection(editor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.clearSelection", () => {
      cleanupFiles();
      vscode.window.showInformationMessage("Claude bridge selection cleared.");
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      cleanupFilesSync();
    },
  });
}

export function deactivate(): void {
  cleanupFilesSync();
}
