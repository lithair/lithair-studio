# Proposal: Lithair editor extension (VS Code)

> Status: draft / feasibility study
> Date: 2026-06-14
> Author: assistant (grounded in source read of `lithair` @ v0.13.0 and `lithair-website`)
> Scope: an editor extension giving arcker (1) syntax/authoring support for Lithair
> sites and (2) the website playground embedded in the IDE.

---

## 0. Ground truth (what I actually read)

Everything below is grounded in the source, not in assumptions. Files read:

- `lithair-macros/src/lib.rs` — the proc-macro entry points and the attribute lists
  registered on each derive.
- `lithair-macros/src/declarative_simple.rs` — the actual parser for the
  `DeclarativeModel` field attributes (which tokens are recognized).
- `lithair-core/src/app/` — the `LithairServer` builder method surface
  (`grep "pub fn with_*"`).
- `README.md` — the public API examples and the `#[retention]`/`#[pinned]` surface.
- `lithair-website/frontend/src/pages/playground.astro` (1405 lines) and the built
  `sites/lithair.net/playground/index.html` — the entire playground implementation.
- `.vscode/extensions.json` — what the repo already recommends.

Two facts dominate the design and I want them stated up front because they
contradict the most natural reading of the request:

1. **Lithair code is plain Rust.** There is no separate Lithair file type, no
   custom grammar, no `.lithair` files. A "Lithair site" is a normal Cargo binary
   crate whose `main.rs` uses `LithairServer::new().with_*(...).serve().await` and
   whose models are normal `struct`s carrying derive-macro **attributes**
   (`#[db(...)]`, `#[lifecycle(...)]`, `#[http(...)]`, `#[permission(...)]`,
   `#[persistence(...)]`, `#[retention(...)]`, `#[pinned]`). Critically, those
   attributes are **inert helper attributes consumed by the `DeclarativeModel`
   derive** — the standalone `#[proc_macro_attribute]` forms in `lib.rs` are gated
   behind `#[cfg(feature = "attr_macros")]` and off by default (`lib.rs:90-144`).
   So from a tooling standpoint this is 100% valid Rust that **rust-analyzer already
   parses, type-checks, completes, and renames correctly.** The repo already knows
   this — `.vscode/extensions.json` recommends `rust-lang.rust-analyzer` first.

2. **The playground is a client-side code *generator*, not a compiler or runtime.**
   `playground.astro` is a single Astro page with ~1000 lines of inline vanilla JS.
   It holds a `state` object (features toggled + models defined), and `generateCode(state)`
   concatenates **Rust source as strings** into a `<pre>`. There is a **Copy** button
   and **no Run button**. There is no WASM (the only `.wasm` files in the repo are
   third-party astro/shiki tooling under `node_modules`), no `fetch` to a compile
   backend, no `lithair` crate compiled to wasm. It emits text you paste into a real
   `cargo` project and build yourself.

These two facts make feature (1) much *smaller* than it sounds and feature (2)
much *easier* than it sounds — for the opposite reason you'd expect.

---

## 1. Verdict per feature

| Feature | Verdict | One-line reason |
|---|---|---|
| **1. Syntax support** | **feasible, but mostly redundant** | Lithair code is plain Rust; rust-analyzer already does the heavy lifting. The marginal value is snippets + attribute-key awareness, not a grammar or LSP. |
| **2. Embedded playground** | **feasible (genuinely easy)** | The playground is self-contained client-side JS string-generation. No server, no WASM, no compile step. It drops into a VS Code webview almost verbatim. |
| **2b. "Run" inside the IDE** | **feasible but out of playground scope** | Actually building/running a Lithair site = `cargo run`, which the IDE already does. The extension can add a one-click task; it does not need the playground for this. |

The honest headline: **the part arcker probably thinks is hard (embedding the
playground) is the easy one, and the part he probably thinks is the main feature
(syntax support) is the one with the least marginal value**, because rust-analyzer
already covers it.

---

## 2. How the playground actually works (cited)

Source: `lithair-website/frontend/src/pages/playground.astro`.

- **Architecture**: one Astro page, no framework islands. All logic is in a single
  inline `<script>` (lines 383–1402). Built output is `sites/lithair.net/playground/index.html`
  with the same logic minified into `_astro/playground.astro_astro_type_script_index_0_lang.CZTIginB.js`.
- **State** (`playground.astro:387-400`): a plain object — `features` (each with an
  `enabled` flag + config), `models` (array of `{name, fields[]}`), `port`, `dataDir`.
- **Input**: DOM event handlers (`initFeatureToggles`, `renderRoles`, `renderModels`)
  mutate `state` and call `render()`.
- **Output**: `render()` (`:1124`) calls `generateCode(state)` (`:807`) which builds an
  **array of Rust source lines** and joins them. It then runs a hand-rolled regex
  syntax highlighter `highlightRust()` (`:1065`) and sets `innerHTML`.
- **What `generateCode` knows about Lithair** is hardcoded JS that mirrors the real
  API: it emits `use lithair_core::app::LithairServer;`, `#[derive(... DeclarativeModel)]`,
  `.with_model::<T>("path","/api/route")`, `.with_rbac_config(...)`, `.with_mfa_totp(...)`,
  `.with_firewall_config(...)`, `.with_route_guard(...)`, `.with_admin_panel(...)`,
  `.serve().await` (`:807-1026`). Field attributes are built by `buildFieldAttributes()`
  (`:1028`) producing `#[db(...)]`, `#[lifecycle(...)]`, `#[http(...)]`, `#[persistence(...)]`.
- **No compilation, no execution.** The terminal action is the **Copy** button
  (`:1133`) → `navigator.clipboard.writeText(generateCode(state))`. There is no
  `fetch`, no websocket, no wasm import, no eval. I grepped the whole repo for wasm and
  found only `node_modules` tooling artifacts.

**Implication for embedding**: because the playground has zero server dependency and
zero network calls, it is **fully offline-capable** and can be embedded in a VS Code
webview essentially as-is. The webview just needs the HTML + the JS + the compiled
Tailwind CSS. This is the best possible case for embedding.

One caveat worth naming: the generator's API knowledge is **hardcoded and frozen at
the version it was written against** (the comments say v0.12; the workspace is now
v0.13.0). The website playground and the framework can drift. If the extension
**vendors** the playground JS, it inherits that drift. See Risks.

---

## 3. Recommended architecture

A single VS Code extension (TypeScript), no LSP server process, structured as two
loosely-coupled features behind one `package.json`:

```
lithair-vscode/
  package.json            # contributes: snippets, commands, (optional) grammar injection
  snippets/lithair.json   # the real value-add for "syntax support"
  syntaxes/               # OPTIONAL: injection grammar for Lithair attribute keys
    lithair-attrs.tmLanguage.json
  media/playground/       # vendored copy of the playground (html/js/css)
  src/
    extension.ts          # activation, command registration
    playgroundPanel.ts    # WebviewPanel host for the embedded playground
    commands.ts           # "New Lithair project", "Run site" (cargo task), "Insert from playground"
```

**Why no LSP / no custom language server:**
- rust-analyzer already provides parsing, completion, type-checking, go-to-def,
  rename, and inlay hints for the entire file, *including* the macro-expanded code,
  because it's real Rust. Standing up a second language server that understands the
  attributes better than r-a would be a large project for marginal gain, and risks
  fighting r-a over the same `.rs` buffers.
- The attributes are not a separate language; they're Rust attribute syntax. A
  TextMate **injection** grammar can add semantic coloring to the *keys inside*
  `#[db(...)]` etc., but that is cosmetic.

**Feature 1 (syntax support) = snippets + optional injection grammar.**
- **Snippets** carry the real value: tab-completable scaffolds for the builder chain
  and the model attributes, so arcker doesn't memorize method names. Grounded in the
  real surface I read:
  - `lithairserver` → the `LithairServer::new().with_port(...).with_model::<T>(...).serve().await` skeleton.
  - `lithairmodel` → `#[derive(Debug, Clone, Serialize, Deserialize, DeclarativeModel)] struct ...`.
  - per-attribute snippets: `#[db(${1|primary_key,indexed,unique|})]`,
    `#[lifecycle(${1|immutable,audited,auto_timestamp,versioned = 3|})]`,
    `#[http(expose${2:, validate = "email"})]`, `#[permission(read = "...", write = "...")]`,
    `#[retention(memory = ${1:1000})]`, `#[pinned]`.
  - vhost/redirect snippets for `with_vhost`/`with_redirect`.
  The snippet *choices* must be drawn from what `declarative_simple.rs` actually
  parses (e.g. `primary_key`, `unique`, `indexed`, `immutable`, `audited`,
  `versioned`, `expose`, `validate`, `replicate`, `track_history`) — not invented.
- **Injection grammar (optional, low priority)**: color attribute keys distinctly.
  Pure cosmetics; do last or skip.

**Feature 2 (embedded playground) = a `WebviewPanel`.**
- Command `lithair.openPlayground` opens a `WebviewPanel`, loads the vendored
  `media/playground/index.html`, rewrites asset URLs to `webview.asWebviewUri(...)`,
  and sets a CSP. Because the playground is offline and self-contained, this works
  without network access.
- **Added value over the website** (this is what makes the embed worth doing rather
  than just opening lithair.net/playground in a browser): wire the playground's
  "Copy" path to a `postMessage` → extension host → **insert the generated Rust
  directly into the active editor or a new `main.rs`**. That closes the loop the web
  version can't: configure → insert into the real project → `cargo run`.

---

## 4. MVP scope (smallest shippable v0.1 arcker can use immediately)

Ship **Feature 1 (snippets) + a thin project scaffold command**. Defer the embedded
playground to v0.2.

**v0.1 contents:**
1. `snippets/lithair.json` — the builder skeleton + model + attribute snippets above.
   This is the single highest-value-per-effort artifact: it removes the "what was the
   method/attribute called again?" friction without duplicating rust-analyzer.
2. Command `lithair.newProject` — generates a minimal Cargo project (the
   `01-hello-world` shape from `examples/`) with correct `Cargo.toml`
   (`lithair-core = "0.13"`, `serde`, `tokio`) and a starter `main.rs`.
3. Command `lithair.runSite` — a thin wrapper that runs `cargo run` in the integrated
   terminal (or contributes a task). Optional; nice for discoverability.
4. `extensions.json`-style dependency hint: the extension declares it works best with
   `rust-lang.rust-analyzer` and does not try to replace it.

That's a usable authoring experience the same day: arcker opens a Lithair project,
gets rust-analyzer's full Rust intelligence, plus tab-completable Lithair scaffolds,
plus one-command project creation and run.

**v0.2:** embedded playground webview with "insert generated code into editor".

**Explicitly out of MVP:** custom LSP, semantic-token provider, diagnostics beyond
what `cargo check`/rust-analyzer already give, injection grammar.

---

## 5. Effort estimate (rough, honest)

| Deliverable | Estimate | Confidence |
|---|---|---|
| v0.1 snippets (`lithair.json`) | ~half a day | high — it's a static JSON file; the only work is transcribing the real attribute/method surface accurately |
| v0.1 `newProject` + `runSite` commands + packaging (`package.json`, `vsce` build) | ~half to one day | high — standard VS Code extension boilerplate |
| **v0.1 total** | **~1 day** | high |
| v0.2 embedded playground (vendor JS, webview host, CSP, asset URI rewrite) | ~1 day **if** vendoring the existing JS as-is | medium |
| v0.2 "insert into editor" message bridge | ~half a day | medium — needs a small patch to the vendored playground to `postMessage` on copy |
| Optional injection grammar | ~half a day | low value |
| **Keeping the vendored playground in sync with the framework** | **ongoing, unbounded** | this is the real cost, not the initial build — see Risks |

So: **MVP (snippets + scaffold): ~a day. Embedded playground: ~1.5 days to build,
but with an open-ended maintenance tail** because the playground encodes the API by
hand.

---

## 6. Risks & unknowns

**R1 — Playground/framework API drift (the main one).** The playground's Rust
knowledge is hardcoded JS frozen at ~v0.12 (per its own comments) while the workspace
is v0.13.0. Embedding it in the IDE risks shipping code snippets that don't compile
against the user's `lithair-core` version. The website has the same problem, but in
the IDE it's worse because the user is *about to compile* the output.
*Mitigations*: (a) vendor by reference, not copy — have the extension fetch the live
playground from lithair.net at runtime (loses offline, re-introduces a network dep);
or (b) accept the drift and treat the playground as a *scaffold generator*, with the
real check being `cargo check`; or (c) longer-term, extract `generateCode()` into a
shared module both the website and extension import, so there's one source of truth.
I'd recommend (b) for v0.2 and consider (c) only if the extension proves useful.

**R2 — Snippets encoding the wrong tokens.** If a snippet offers an attribute key
that `declarative_simple.rs` doesn't parse (or offers a removed builder method), it
silently produces non-compiling code. *Mitigation*: every snippet choice must be
transcribed from the actual parser (`declarative_simple.rs`) and the actual builder
(`grep pub fn with_*`), and re-verified on each minor release. This is cheap but must
be disciplined. A small CI check in the lithair repo that diffs the snippet token set
against the parser's recognized tokens would make this durable — worth considering.

**R3 — Webview CSS/asset pipeline.** The playground depends on compiled Tailwind
(`_astro/_slug_.CNvwm_L2.css`). Vendoring that one CSS file is fine, but if the site
restyles, the embedded copy goes stale cosmetically. Low severity (cosmetic only).

**R4 — "Syntax support" expectation mismatch.** arcker may expect a dedicated Lithair
grammar / language mode. The honest answer is that would be *worse* than relying on
rust-analyzer — it would lose type-checking, completion, and rename across the rest of
the Rust file. The right framing to set with him: "syntax support" here means snippets
+ optional attribute coloring layered on top of rust-analyzer, not a replacement for
it. If he genuinely wants a distinct language experience, that's a much larger,
lower-value project and should be a separate decision.

**R5 — Marketplace/publishing overhead.** Publishing to the VS Code Marketplace
(publisher account, `vsce`, icon, README) is real but small one-time work. For
arcker's own use, a local `.vsix` install sidesteps it entirely.

**Unknowns I could not resolve from source:**
- Whether arcker wants this for personal use only (→ skip marketplace, skip
  injection grammar, just `.vsix`) or as a public artifact (→ drift maintenance
  matters much more). This changes the R1/R5 calculus and should be confirmed before
  building v0.2.
- Whether a future Lithair release intends to introduce actual `.lithair` files or a
  real macro DSL distinct from Rust. If that's on the roadmap, the "plain Rust"
  premise of this proposal changes and a grammar/LSP would become justified. Nothing
  in the current source suggests it.

---

## 7. Recommendation

Build **v0.1 (snippets + scaffold commands), ~1 day**, install it locally as a
`.vsix`, and use it. It delivers real authoring friction reduction immediately and
costs almost nothing to maintain. Treat the embedded playground (v0.2) as a nice
follow-up that's genuinely easy to build but carries an open-ended sync cost — only
invest in it once v0.1 has proven it earns its keep, and prefer the "scaffold
generator, `cargo check` is the real validator" framing to keep the maintenance
burden honest.
