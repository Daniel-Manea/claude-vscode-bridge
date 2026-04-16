// Inline CodeLens affordances:
//   - Top of every file Claude has edited this session → Diff · Revert · Accept
//   - Above every failing-test diagnostic location → Ask Claude about this failure

import * as vscode from "vscode";

import { getClaudeEdits, forgetClaudeEdit, onClaudeEditsChanged } from "./fileOpener";
import { getConfig } from "./settings";

// Terracotta spark (Unicode character, no SVG in CodeLens title text). All
// lenses from this extension start with this so users learn "this is Claude
// Bridge" and not some other extension's sidecar.
const MARK = "\u2731";

export class ClaudeEditsLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this._onDidChange,
      onClaudeEditsChanged(() => this._onDidChange.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("claudeBridge.codeLensClaudeEdits")) {
          this._onDidChange.fire();
        }
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!getConfig().get<boolean>("codeLensClaudeEdits", true)) return [];
    if (document.uri.scheme !== "file") return [];
    const edits = getClaudeEdits();
    const match = edits.find((e) => e.absolutePath === document.uri.fsPath);
    if (!match) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    const countStr = `${match.count} edit${match.count === 1 ? "" : "s"}`;
    const header: vscode.CodeLens = new vscode.CodeLens(range, {
      title: `${MARK} Claude edited this file \u00B7 ${countStr}`,
      command: "",
    });
    const diffLens: vscode.CodeLens = new vscode.CodeLens(range, {
      title: "$(diff)  Diff vs. HEAD",
      command: "claude-bridge.diffClaudeEdit",
      arguments: [document.uri.fsPath],
      tooltip: "Open a two-pane diff of this file vs. the HEAD commit.",
    });
    const acceptLens: vscode.CodeLens = new vscode.CodeLens(range, {
      title: "$(check)  Accept",
      command: "claude-bridge.acceptClaudeEdit",
      arguments: [document.uri.fsPath],
      tooltip: "Drop this file from the edits log (doesn't touch the file).",
    });
    const revertLens: vscode.CodeLens = new vscode.CodeLens(range, {
      title: "$(discard)  Revert",
      command: "claude-bridge.revertClaudeEdit",
      arguments: [document.uri.fsPath],
      tooltip: "Run `git checkout HEAD -- <file>` after a confirm.",
    });
    return [header, diffLens, acceptLens, revertLens];
  }
}

export class TestFailureLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this._onDidChange,
      vscode.languages.onDidChangeDiagnostics(() => this._onDidChange.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("claudeBridge.codeLensTestFailures")) {
          this._onDidChange.fire();
        }
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!getConfig().get<boolean>("codeLensTestFailures", true)) return [];
    if (document.uri.scheme !== "file") return [];
    // Only add lenses for files that VS Code's Testing API recognises as
    // test files, OR whose path matches common test patterns. Keeps the
    // lens from cluttering plain code with unrelated error squiggles.
    const p = document.uri.fsPath.toLowerCase();
    const looksLikeTest =
      /[/\\](tests?|__tests?__|spec|specs)[/\\]/.test(p) ||
      /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java|kt|swift|cs)$/.test(p);
    if (!looksLikeTest) return [];

    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const errors = diagnostics.filter(
      (d) => d.severity === vscode.DiagnosticSeverity.Error,
    );
    if (errors.length === 0) return [];

    // One lens per error location (but cap at 5 so we don't flood a file
    // full of cascading errors).
    return errors.slice(0, 5).map((d) => {
      const line = d.range.start.line;
      const range = new vscode.Range(line, 0, line, 0);
      return new vscode.CodeLens(range, {
        title: `${MARK} Ask Claude about this failure`,
        command: "claude-bridge.askClaudeAboutFailure",
        arguments: [document.uri.fsPath, d.range.start.line, d.range.start.character, d.message, d.source ?? ""],
        tooltip: "Inject the failing test + the diagnostic message into Claude's context and nudge you to ask.",
      });
    });
  }
}
