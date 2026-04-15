import * as vscode from "vscode";
import { InboundMessage, OutboundMessage, State } from "./messages";

export class ClaudeBridgeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claude-bridge.dashboard";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getState: () => State,
    private readonly handleMessage: (msg: InboundMessage) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "out", "webview"),
        vscode.Uri.joinPath(this.extensionUri, "webview"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: InboundMessage) => this.handleMessage(msg));
  }

  postState(state: State): void {
    this.post({ type: "state", state });
  }

  post(msg: OutboundMessage): void {
    this._view?.webview.postMessage(msg);
  }

  isVisible(): boolean {
    return !!this._view && this._view.visible;
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "sidebar", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "sidebar", "style.css"),
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Claude Bridge</title>
</head>
<body>
  <main class="sidebar">
    <header class="brand">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5L3 12l4 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M17 5l4 7-4 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M12 7.5l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1z" fill="#D97757"/>
      </svg>
      <span class="brand-title">Claude Bridge</span>
    </header>

    <section class="status-grid" id="statusGrid" aria-label="Feature toggles"></section>

    <section class="preset">
      <label for="presetSelect">Preset</label>
      <select id="presetSelect"></select>
      <p class="preset-desc" id="presetDesc"></p>
    </section>

    <section class="segments">
      <div class="segments-header">
        <h3>Segments</h3>
        <span class="hint">Drag to reorder</span>
      </div>
      <ul id="segmentsList" class="segments-list" aria-label="Status line segments"></ul>
    </section>

    <footer>
      <button id="openSettingsBtn" type="button" class="primary">Open full settings\u2026</button>
    </footer>
  </main>

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
