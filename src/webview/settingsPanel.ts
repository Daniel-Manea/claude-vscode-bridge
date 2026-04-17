import * as vscode from "vscode";
import { InboundMessage, OutboundMessage, State } from "./messages";
import { getNonce } from "./nonce";

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
    const tokensUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "webview", "shared", "tokens.css"),
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}' 'strict-dynamic';" />
  <link rel="preload" as="style" href="${tokensUri}" />
  <link rel="stylesheet" href="${tokensUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Claude Bridge</title>
</head>
<body>
  <div class="panel">

    <section class="hero">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6.5L3.5 12 8 17.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M16 6.5L20.5 12 16 17.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M12 7.5l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1z" fill="#D97757"/>
      </svg>
      <div class="hero-body">
        <div class="hero-title">Claude Bridge</div>
        <div class="hero-tag">Your VS Code selection, piped straight into Claude Code.</div>
      </div>
      <span class="brand-version" id="version" style="font-size:11px; color:var(--cb-muted); font-variant-numeric:tabular-nums;"></span>
    </section>

    <section class="card" id="install-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Install</span><span class="eyebrow-hint">~/.claude/settings.json</span></div>
      <div id="install-root"></div>
    </section>

    <section class="card" id="master-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Master toggles</span></div>
      <div id="master-rows"></div>
    </section>

    <section class="card" id="preset-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Preset</span><span class="eyebrow-hint">Built-ins update as you tweak.</span></div>
      <div class="preset-row" id="preset-row"></div>
      <div class="preset-actions">
        <button id="export-btn" class="cb-link" type="button">Export to JSON…</button>
        <span style="color:var(--cb-muted);">·</span>
        <button id="import-btn" class="cb-link" type="button">Import JSON…</button>
      </div>
    </section>

    <section class="card" id="statusline-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Status line</span><span class="eyebrow-hint">Drag to reorder</span></div>
      <ul class="segments-list" id="segments-list"></ul>
      <div id="pathstyle-root" class="field-row"></div>
      <div id="statusline-look" class="field"></div>
      <div class="field">
        <label class="field-label">Preview</label>
        <div class="preview-line" id="preview-line">\u2014</div>
      </div>
    </section>

    <section class="card" id="context-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Context injection</span></div>
      <div id="context-fields"></div>
    </section>

    <section class="card" id="command-center-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Command center</span><span class="eyebrow-hint">Quickpick + shortcuts</span></div>
      <div id="command-center-root"></div>
    </section>

    <section class="card" id="autoopen-card">
      <div class="cb-eyebrow"><span class="eyebrow-label">Auto-open edited files</span></div>
      <div id="autoopen-root"></div>
    </section>

  </div>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

