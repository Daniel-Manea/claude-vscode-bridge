import * as vscode from "vscode";
import { InboundMessage, OutboundMessage, State } from "./messages";

export class ClaudeBridgeSettingsPanel {
  public static readonly viewType = "claudeBridge.settings";
  private static _instance: ClaudeBridgeSettingsPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static showOrReveal(
    extensionUri: vscode.Uri,
    getState: () => State,
    handleMessage: (msg: InboundMessage) => void,
  ): ClaudeBridgeSettingsPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (this._instance) {
      this._instance._panel.reveal(column);
      return this._instance;
    }
    const panel = vscode.window.createWebviewPanel(
      ClaudeBridgeSettingsPanel.viewType,
      "Claude Bridge",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "out", "webview"),
          vscode.Uri.joinPath(extensionUri, "webview"),
          vscode.Uri.joinPath(extensionUri, "media"),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "logo.png");
    this._instance = new ClaudeBridgeSettingsPanel(panel, extensionUri, getState, handleMessage);
    return this._instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    _getState: () => State,
    handleMessage: (msg: InboundMessage) => void,
  ) {
    this._panel = panel;
    this._panel.webview.html = this.renderHtml(panel.webview, extensionUri);
    this._panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => handleMessage(msg),
      null,
      this._disposables,
    );
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  postState(state: State): void {
    this.post({ type: "state", state });
  }

  post(msg: OutboundMessage): void {
    this._panel.webview.postMessage(msg);
  }

  isVisible(): boolean {
    return this._panel.visible;
  }

  dispose(): void {
    ClaudeBridgeSettingsPanel._instance = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "out", "webview", "settings", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "webview", "settings", "style.css"),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "logo.png"),
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Claude Bridge Settings</title>
</head>
<body>
  <div class="container">
    <header class="app-header">
      <img class="logo" src="${logoUri}" alt="" aria-hidden="true" />
      <div class="title-block">
        <h1 class="title">Claude Bridge</h1>
        <span class="version" id="version"></span>
      </div>
    </header>

    <section class="preview-block">
      <h2>Status line preview</h2>
      <div class="preview-frame">
        <div class="preview-line" id="previewLine">\u2014</div>
      </div>
      <p class="preview-hint">Live preview of the enabled segments in their current order.</p>
    </section>

    <section class="group">
      <h2>Core</h2>
      <div class="fields" id="coreFields"></div>
    </section>

    <section class="group">
      <h2>Behavior</h2>
      <div class="fields" id="behaviorFields"></div>
    </section>

    <section class="group">
      <h2>Content</h2>
      <div class="fields" id="contentFields"></div>
    </section>

    <section class="group">
      <div class="group-header">
        <h2>Segments</h2>
        <span class="hint">Drag to reorder. Toggle to show/hide.</span>
      </div>
      <ul class="segments-list" id="segmentsList"></ul>
    </section>

    <section class="group">
      <h2>Presets</h2>
      <div class="preset-chips" id="presetChips"></div>
      <div class="preset-actions">
        <button id="exportBtn" type="button" class="secondary">Export current as JSON\u2026</button>
        <button id="importBtn" type="button" class="secondary">Import from JSON\u2026</button>
      </div>
    </section>

    <section class="group">
      <h2>Claude Code integration</h2>
      <div class="fields" id="integrationFields"></div>
      <div class="integration-actions">
        <button id="setupBtn" type="button" class="secondary">Re-run setup</button>
        <button id="removeConfigBtn" type="button" class="danger">Remove Claude Code config</button>
      </div>
    </section>
  </div>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
