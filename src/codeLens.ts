// Only surface: the CodeAction provider (lightbulb menu). No CodeLens rows,
// no diff / revert / accept, no test-failure nudges.

import * as vscode from "vscode";

import { getConfig } from "./settings";

// "<✱>" is the Claude Bridge logo rendered as three characters — two
// chevrons wrapping the terracotta spark, which is literally how the icon
// is drawn. CodeAction titles are plain text (no custom-image support), so
// this is the closest we can get to putting the actual logo in the menu.
const LOGO = "\u27E8\u2731\u27E9 ";

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
        this.make(`${LOGO}Preview what Claude will see`, "claude-bridge.preview"),
      );
    }
    actions.push(
      this.make(`${LOGO}Inject enclosing symbol`, "claude-bridge.injectCurrentSymbol"),
    );
    return actions;
  }

  private make(title: string, command: string): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
    action.command = { title, command };
    return action;
  }
}
