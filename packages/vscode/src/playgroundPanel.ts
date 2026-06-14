import * as vscode from "vscode";
import {
  generate,
  defaultSpec,
  type LithairSpec,
} from "@lithair-studio/generator";

/**
 * "Lithair Studio: Playground" — a webview embedding a spec editor whose
 * generated Rust is produced by the SHARED `@lithair-studio/generator` core
 * (the same `generate()` the website playground's logic was ported into).
 *
 * Design: the webview owns the UI and a spec object. On every change it posts
 * the spec to the extension host; the host runs `generate(spec)` and posts the
 * Rust string back. This keeps a single source of truth (the node-side
 * generator) instead of bundling a second copy into the webview, so the panel
 * and the editor commands can never drift from each other.
 *
 * The win over the website's Copy button: an "Insert into editor" action that
 * injects the generated Rust at the active editor's cursor.
 */

let panel: vscode.WebviewPanel | undefined;
let lastSpec: LithairSpec = defaultSpec();
let lastEditor: vscode.TextEditor | undefined;

export function openPlayground(context: vscode.ExtensionContext): void {
  // Remember the editor the user came from, so "Insert" targets it even after
  // the webview takes focus.
  lastEditor = vscode.window.activeTextEditor;

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "lithairStudioPlayground",
    "Lithair Studio: Playground",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getHtml(panel.webview);

  panel.webview.onDidReceiveMessage(
    (msg: { type: string; spec?: LithairSpec }) => {
      if (msg.type === "spec" && msg.spec) {
        lastSpec = msg.spec;
        const rust = safeGenerate(msg.spec);
        panel?.webview.postMessage({ type: "rust", rust });
      } else if (msg.type === "insert") {
        insertIntoEditor(safeGenerate(lastSpec));
      } else if (msg.type === "copy" && msg.spec) {
        vscode.env.clipboard.writeText(safeGenerate(msg.spec));
        vscode.window.setStatusBarMessage("Lithair: code copied", 2000);
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions
  );
}

function safeGenerate(spec: LithairSpec): string {
  try {
    return generate(spec);
  } catch (err) {
    return `// generation error: ${String(err)}`;
  }
}

function insertIntoEditor(rust: string): void {
  const editor =
    (lastEditor && !lastEditor.document.isClosed ? lastEditor : undefined) ??
    vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window
      .showWarningMessage(
        "Lithair Studio: no editor to insert into. Open a .rs file first.",
        "New main.rs"
      )
      .then((choice) => {
        if (choice === "New main.rs") {
          vscode.workspace
            .openTextDocument({ language: "rust", content: rust })
            .then((doc) => vscode.window.showTextDocument(doc));
        }
      });
    return;
  }

  editor.edit((b) => b.insert(editor.selection.active, rust)).then((ok) => {
    if (ok) {
      vscode.window.showTextDocument(editor.document, editor.viewColumn);
      vscode.window.setStatusBarMessage("Lithair: code inserted", 2000);
    }
  });
}

/**
 * The webview UI. Kept intentionally compact and dependency-free: a feature
 * toggle row, a model editor (name + fields + attribute checkboxes), and a
 * read-only generated-Rust pane. It does NOT contain the spec->Rust logic —
 * that lives in the shared generator and runs on the host side.
 *
 * A strict CSP is set; only the inline script (pinned by nonce) runs.
 */
function getHtml(webview: vscode.Webview): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Lithair Studio Playground</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 12px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
       opacity: .7; margin: 16px 0 8px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
  label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
  input[type=text], input[type=number] {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
    padding: 2px 6px; font: inherit; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  .model { border: 1px solid var(--vscode-panel-border); border-radius: 6px;
    padding: 10px; margin-bottom: 10px; }
  .field { border: 1px solid var(--vscode-panel-border); border-radius: 4px;
    padding: 8px; margin: 6px 0; }
  pre { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 12px;
    border-radius: 6px; overflow: auto; font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px; white-space: pre; }
  .actions { display: flex; gap: 8px; margin: 8px 0; }
  .muted { opacity: .6; font-size: 11px; }
</style>
</head>
<body>
  <h2>Features</h2>
  <div class="row" id="features"></div>

  <h2>Models</h2>
  <div id="models"></div>
  <button class="secondary" id="add-model">+ Add model</button>

  <h2>Generated Rust</h2>
  <div class="actions">
    <button id="insert">Insert into editor</button>
    <button class="secondary" id="copy">Copy</button>
    <span class="muted">Generated by the shared @lithair-studio/generator core.</span>
  </div>
  <pre id="output">// configure a model to generate code…</pre>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

const FIELD_TYPES = ["String","bool","u32","u64","f64","Uuid","DateTime","Vec<String>","Option<String>"];
const FEATURE_KEYS = ["staticFiles","auth","mfa","rateLimit","firewall","routeGuard","adminPanel"];
const FEATURE_LABELS = {
  staticFiles:"static files", auth:"auth (RBAC)", mfa:"MFA", rateLimit:"rate limit",
  firewall:"firewall", routeGuard:"route guard", adminPanel:"admin panel"
};
const ATTR_DEFS = [
  ["primaryKey","primary_key"],["indexed","indexed"],["unique","unique"],
  ["immutable","immutable"],["audited","audited"],
  ["expose","expose"],["replicate","replicate"],["trackHistory","track_history"]
];

function defaultField(name) {
  return { name: name||"field", type:"String", attrs: {
    primaryKey:false,indexed:false,unique:false,immutable:false,audited:false,
    autoTimestamp:false,versioned:false,versionedN:3,expose:true,validate:"",
    replicate:false,trackHistory:false } };
}

// Spec mirrors @lithair-studio/generator defaultSpec(); only the fields the UI
// edits are surfaced here. The host fills the rest from its own default.
const spec = {
  features: {
    staticFiles:{enabled:false,mountPath:"/",dir:"./public",maxMemoryMb:100,maxFileSizeMb:10,hotReload:false,compression:false,compressionThresholdKb:50},
    auth:{enabled:false,roles:[{name:"Admin",perms:["*"]}],sessionStorePath:"./data/sessions",sessionMaxAgeSecs:28800},
    mfa:{enabled:false,issuer:"My App",required:["Admin"],optional:[],devBypass:false},
    rateLimit:{enabled:false,globalQps:1000,perIpQps:50},
    firewall:{enabled:false,allowIps:"",denyIps:"",protectedPrefixes:"/admin"},
    routeGuard:{enabled:false,prefix:"/admin",redirect:"/admin/login",sessionCookie:"lithair_session",exclude:""},
    adminPanel:{enabled:false,adminPath:"/admin",uiPath:"/_data",enableStatus:true,enableHealth:true,enableInfo:true,firewallEnabled:false,firewallAllowIps:"loopback,internal,private_v4"}
  },
  models: [],
  port: 3007,
  dataDir: "./data"
};

function sync() { vscode.postMessage({ type:"spec", spec }); }

function renderFeatures() {
  const box = document.getElementById("features");
  box.innerHTML = "";
  FEATURE_KEYS.forEach(k => {
    const lbl = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = spec.features[k].enabled;
    cb.addEventListener("change", () => { spec.features[k].enabled = cb.checked; sync(); });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(FEATURE_LABELS[k]));
    box.appendChild(lbl);
  });
}

function renderModels() {
  const box = document.getElementById("models");
  box.innerHTML = "";
  spec.models.forEach((m, mi) => {
    const card = document.createElement("div");
    card.className = "model";

    const head = document.createElement("div");
    head.className = "row";
    const nameIn = document.createElement("input");
    nameIn.type = "text"; nameIn.value = m.name;
    nameIn.addEventListener("input", () => { m.name = nameIn.value; sync(); });
    const del = document.createElement("button");
    del.className = "secondary"; del.textContent = "Delete model";
    del.addEventListener("click", () => { spec.models.splice(mi,1); renderModels(); sync(); });
    head.appendChild(nameIn); head.appendChild(del);
    card.appendChild(head);

    m.fields.forEach((field, fi) => {
      const fEl = document.createElement("div");
      fEl.className = "field";
      const fr = document.createElement("div");
      fr.className = "row";
      const fn = document.createElement("input");
      fn.type = "text"; fn.value = field.name;
      fn.addEventListener("input", () => { field.name = fn.value; sync(); });
      const ft = document.createElement("select");
      FIELD_TYPES.forEach(t => {
        const o = document.createElement("option");
        o.value = t; o.textContent = t; if (t === field.type) o.selected = true;
        ft.appendChild(o);
      });
      ft.addEventListener("change", () => { field.type = ft.value; sync(); });
      const fdel = document.createElement("button");
      fdel.className = "secondary"; fdel.textContent = "×";
      fdel.addEventListener("click", () => { m.fields.splice(fi,1); renderModels(); sync(); });
      fr.appendChild(fn); fr.appendChild(ft); fr.appendChild(fdel);
      fEl.appendChild(fr);

      const ar = document.createElement("div");
      ar.className = "row";
      ATTR_DEFS.forEach(([key,label]) => {
        const l = document.createElement("label");
        const c = document.createElement("input");
        c.type = "checkbox"; c.checked = !!field.attrs[key];
        c.addEventListener("change", () => { field.attrs[key] = c.checked; sync(); });
        l.appendChild(c); l.appendChild(document.createTextNode(label));
        ar.appendChild(l);
      });
      fEl.appendChild(ar);
      card.appendChild(fEl);
    });

    const addF = document.createElement("button");
    addF.className = "secondary"; addF.textContent = "+ Add field";
    addF.addEventListener("click", () => { m.fields.push(defaultField("field")); renderModels(); sync(); });
    card.appendChild(addF);
    box.appendChild(card);
  });
}

document.getElementById("add-model").addEventListener("click", () => {
  const m = { name:"MyModel", fields:[ (() => { const f = defaultField("id"); f.type="String"; f.attrs.primaryKey=true; f.attrs.unique=true; f.attrs.immutable=true; return f; })() ] };
  spec.models.push(m);
  renderModels(); sync();
});

document.getElementById("insert").addEventListener("click", () => vscode.postMessage({ type:"insert" }));
document.getElementById("copy").addEventListener("click", () => vscode.postMessage({ type:"copy", spec }));

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "rust") {
    document.getElementById("output").textContent = e.data.rust;
  }
});

renderFeatures();
renderModels();
sync();
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
