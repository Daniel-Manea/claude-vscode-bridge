// Only surface: the CodeAction provider (lightbulb menu). No CodeLens rows,
// no diff / revert / accept, no test-failure nudges.

import * as vscode from "vscode";

import { getConfig } from "./settings";

// Each title starts with "Claude Bridge · " so the brand is the first thing
// the user reads in the lightbulb menu. VS Code groups actions by
// CodeActionKind and doesn't expose a way to relabel the "More Actions…"
// header, so branding the individual titles is the cleanest way to make the
// group self-identify.
const BRAND = "Claude Bridge \u00B7 ";

export class ClaudeBridgeActionsProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!getConfig().get<boolean>("showInlineActions", true)) return [];
    if (document.uri.scheme !== "file") return [];

    const hasSelection = range instanceof vscode.Selection && !range.isEmpty;
    const actions: vscode.CodeAction[] = [];

    if (hasSelection) {
      actions.push(
        this.make(`${BRAND}Pin selection to Claude's context`, "claude-bridge.pinSelection"),
        this.make(`${BRAND}Preview what Claude will see`, "claude-bridge.preview"),
        this.make(`${BRAND}Clear current selection`, "claude-bridge.clearSelection"),
      );
    }
    actions.push(
      this.make(`${BRAND}Inject enclosing symbol`, "claude-bridge.injectCurrentSymbol"),
    );
    return actions;
  }

  private make(title: string, command: string): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
    action.command = { title, command };
    return action;
  }
}
