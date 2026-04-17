import * as vscode from "vscode";
import { InboundMessage, OutboundMessage, State } from "./messages";
import { getNonce } from "./nonce";

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
    const tokensUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview", "shared", "tokens.css"),
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
  <main class="sidebar">
    <header class="brand">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6.5L3.5 12 8 17.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M16 6.5L20.5 12 16 17.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M12 7.5l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1z" fill="#D97757"/>
      </svg>
      <span class="brand-title">Claude Bridge</span>
      <span class="brand-version" id="brandVersion"></span>
    </header>

    <section class="setup-section" id="setupSection"></section>

    <section class="session-strip" id="sessionStrip" aria-label="Session stats"></section>

    <section class="cb-section" id="statusSection" aria-label="Feature toggles">
      <div class="cb-eyebrow"><span class="eyebrow-label">Toggles</span></div>
      <div class="status-grid" id="statusGrid"></div>
    </section>

    <section class="cb-section" id="presetSection" aria-label="Preset">
      <div class="cb-eyebrow"><span class="eyebrow-label">Preset</span></div>
      <div class="preset-row" id="presetRow"></div>
      <p class="preset-desc" id="presetDesc"></p>
    </section>

    <section class="cb-section" id="segmentsSection" aria-label="Status line segments">
      <div class="cb-eyebrow"><span class="eyebrow-label">Segments</span><span class="eyebrow-hint">Drag to reorder</span></div>
      <ul id="segmentsList" class="segments-list"></ul>
    </section>

    <footer id="footerSection">
      <button id="openSettingsBtn" type="button" class="cb-btn-ghost">Open full settings</button>
    </footer>
  </main>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
