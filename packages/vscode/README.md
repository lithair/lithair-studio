# Lithair Studio (VS Code extension)

Authoring support for Lithair sites, layered on top of rust-analyzer (it does
not replace it — install `rust-lang.rust-analyzer` for the actual Rust
intelligence).

## What it contributes

- **Snippets** (`snippets/lithair.json`) for the real Lithair derive attributes
  and builder API. Prefixes include `lithairserver`, `lithairmodel`, `#[db`,
  `#[lifecycle`, `#[http`, `#[http-validate`, `#[permission`, `#[persistence`,
  `#[pinned`, `#[retention`, `#[schema`, `with_vhost`, `with_redirect`,
  `with_rbac`. Tokens are transcribed from lithair @ v0.13.0 source, not
  invented.
- **Lithair Studio: Playground** — a webview spec editor (toggle features,
  define models). Generated Rust is produced by the shared
  `@lithair-studio/generator` running on the extension host. **Insert into
  editor** injects the generated Rust at the active editor's cursor.
- **Lithair Studio: New Project** — scaffolds a minimal Cargo crate
  (`DeclarativeModel` + `serve()`), shaped like `examples/01-hello-world`.
- **Lithair Studio: Run** — runs `cargo run` in the integrated terminal.

## Build

```bash
# from the monorepo root (links the @lithair-studio/generator workspace dep)
npm install
cd packages/vscode
npm run build      # tsc -> dist/extension.js
```

## Load and test it

### Option A — F5 debug (no packaging)

1. Open the **`packages/vscode`** folder in VS Code.
2. Make sure it's built: `npm run build`.
3. Press **F5** ("Run Extension"). VS Code opens an Extension Development Host.
4. In that host, open a `.rs` file and try a snippet (type `lithairmodel`,
   Tab), then run **Lithair Studio: Playground** from the Command Palette
   (`Ctrl+Shift+P`).

> Note: this scaffold does not ship a `.vscode/launch.json`. F5 on a folder with
> a `main` entry in `package.json` offers "Run Extension" automatically; if it
> doesn't, add a standard `extensionHost` launch config, or use Option B.

### Option B — build and install a `.vsix`

`@vscode/vsce` is not installed in this scaffold. Install it, then package:

```bash
cd packages/vscode
npx --yes @vscode/vsce package --no-dependencies
#   -> produces lithair-studio-0.1.0.vsix
code --install-extension lithair-studio-0.1.0.vsix
```

`--no-dependencies` is required because `@lithair-studio/generator` is a
workspace dependency resolved by a symlink; vsce's default dependency walk does
not follow workspace links. The generator is compiled into `dist/` and bundled
via the normal `tsc` output, so the runtime require resolves at load time
**provided `node_modules/@lithair-studio/generator` is present** next to the
packaged extension. For a fully self-contained `.vsix`, bundle with esbuild
before packaging (left out of Layer 1 to keep the toolchain minimal):

```bash
# illustrative — not wired up in Layer 1
npx esbuild src/extension.ts --bundle --platform=node \
  --external:vscode --outfile=dist/extension.js
```

For local F5 development (Option A) no bundling is needed — the workspace
symlink resolves directly.

## Snippet token accuracy

Snippet choices only offer tokens the v0.13 parser actually accepts. Notably
`#[lifecycle]` does **not** offer `auto_timestamp` (the parser ignores it), and
`#[retention]` is presented as a struct-level attribute (place it above the
`struct`, not on a field) because that is where the parser reads it. See
`../../docs/architecture.md` for the full token→source map.
