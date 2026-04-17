// Only surface: the CodeAction provider (lightbulb menu). No CodeLens rows,
// no diff / revert / accept, no test-failure nudges.

import * as vscode from "vscode";

import { getConfig } from "./settings";

const MARK = "\u2731";

/** CodeAction provider — surfaces Claude Bridge actions via VS Code's
 *  lightbulb 💡 anywhere you have a cursor in a file. Click the bulb, pick
 *  an action, it runs.
 */
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
        this.make(`${MARK} Pin selection to Claude's context`, "claude-bridge.pinSelection"),
        this.make(`${MARK} Preview what Claude will see`, "claude-bridge.preview"),
        this.make(`${MARK} Clear current selection`, "claude-bridge.clearSelection"),
      );
    }
    actions.push(
      this.make(`${MARK} Inject enclosing symbol`, "claude-bridge.injectCurrentSymbol"),
    );
    return actions;
  }

  private make(title: string, command: string): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
    action.command = { title, command };
    return action;
  }
}
