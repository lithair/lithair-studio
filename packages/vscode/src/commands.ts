import * as vscode from "vscode";
import * as path from "path";

/**
 * "Lithair Studio: New Project" — scaffold a minimal Cargo binary crate that
 * depends on lithair-core and serves a hello model.
 *
 * The generated shape mirrors lithair/examples/01-hello-world and 03-rest-api
 * (verified against v0.13.0): a `DeclarativeModel` struct + a `LithairServer`
 * builder chain that registers it and calls `.serve().await`.
 */
export async function newProject(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const defaultParent = folders && folders.length > 0 ? folders[0].uri : undefined;

  const name = await vscode.window.showInputBox({
    prompt: "New Lithair project name (Cargo package name)",
    value: "my-lithair-site",
    validateInput: (v) =>
      /^[a-z][a-z0-9_-]*$/.test(v)
        ? undefined
        : "Use a lowercase Cargo-style name (letters, digits, '-', '_').",
  });
  if (!name) {
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: defaultParent,
    openLabel: "Create project here",
  });
  if (!picked || picked.length === 0) {
    return;
  }

  const root = vscode.Uri.joinPath(picked[0], name);
  const srcDir = vscode.Uri.joinPath(root, "src");
  await vscode.workspace.fs.createDirectory(srcDir);

  const enc = new TextEncoder();

  const cargoToml = `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "${name}"
path = "src/main.rs"

[dependencies]
# Point this at a published release once lithair-core is on crates.io,
# or at a local path / git dependency in the meantime.
lithair-core = "0.13"
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1.0"
`;

  const mainRs = `use lithair_core::app::LithairServer;
use lithair_core::DeclarativeModel;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, DeclarativeModel)]
struct Greeting {
    #[db(primary_key, unique)]
    #[lifecycle(immutable)]
    #[http(expose)]
    id: String,

    #[http(expose, validate = "non_empty")]
    #[lifecycle(audited)]
    message: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    LithairServer::new()
        .with_port(port)
        // One line: struct -> full CRUD API at /api/greetings
        .with_model::<Greeting>("./data/greetings", "/api/greetings")
        .serve()
        .await
}
`;

  const gitignore = `/target
/data
`;

  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, "Cargo.toml"),
    enc.encode(cargoToml)
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(srcDir, "main.rs"),
    enc.encode(mainRs)
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, ".gitignore"),
    enc.encode(gitignore)
  );

  const open = await vscode.window.showInformationMessage(
    `Created Lithair project "${name}".`,
    "Open in new window",
    "Add to workspace"
  );
  if (open === "Open in new window") {
    await vscode.commands.executeCommand("vscode.openFolder", root, {
      forceNewWindow: true,
    });
  } else if (open === "Add to workspace") {
    vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length ?? 0,
      0,
      { uri: root, name }
    );
  }
}

/**
 * "Lithair Studio: Run" — run `cargo run` in the integrated terminal at the
 * crate root that owns the active file (or the first workspace folder).
 */
export async function runProject(): Promise<void> {
  const cwd = resolveCrateCwd();
  if (!cwd) {
    vscode.window.showWarningMessage(
      "Lithair Studio: open a folder or a Rust file inside a Cargo project first."
    );
    return;
  }

  const terminal =
    vscode.window.terminals.find((t) => t.name === "Lithair Run") ??
    vscode.window.createTerminal({ name: "Lithair Run", cwd });
  terminal.show();
  terminal.sendText("cargo run");
}

/**
 * Best-effort crate root: the active file's nearest ancestor that looks like a
 * project root, falling back to the first workspace folder. Kept simple — the
 * integrated terminal's own cwd resolution does the rest.
 */
function resolveCrateCwd(): vscode.Uri | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === "file") {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder) {
      return folder.uri;
    }
    return vscode.Uri.file(path.dirname(active.fsPath));
  }
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : undefined;
}
