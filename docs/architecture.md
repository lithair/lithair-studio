# Architecture

## The shape: generator core + two faces

```
                      ┌───────────────────────────┐
                      │   packages/generator       │
                      │   (pure TS, no I/O)         │
                      │                             │
                      │   spec model (spec.ts)      │
                      │   generate(spec) -> Rust    │
                      └─────────────┬───────────────┘
                                    │ imported by
                  ┌─────────────────┴──────────────────┐
                  ▼                                     ▼
      ┌───────────────────────┐             ┌────────────────────────┐
      │  packages/vscode       │             │  packages/harness      │
      │  (authoring face)      │             │  (verification face)   │
      │                        │             │  — Layer 2 STUB —      │
      │  webview playground    │             │                        │
      │  posts spec to host →  │             │  spec -> generate() -> │
      │  host runs generate()  │             │  Cargo project ->      │
      │  -> Rust -> insert     │             │  cargo check -> boot ->│
      │  into editor           │             │  HTTP CRUD -> assert   │
      └───────────────────────┘             └────────────────────────┘
```

The generator is the only place that knows how a spec maps to Lithair Rust.
Both consumers import it, so the IDE's playground and the test oracle can never
disagree about what a given spec produces.

## Why a shared core (vs. vendoring the playground JS)

The website playground holds its spec→Rust logic as inline JS. The natural
shortcut for an IDE playground is to copy that JS into a webview. We didn't:

- A copy means two implementations to keep in sync with the framework as it
  evolves — exactly the drift risk called out in the extension proposal.
- A shared, typed, **tested** module gives the harness something to validate.
  Validating a copy buried in a webview is much harder.

So the extension's webview is a thin UI; the actual generation runs on the
extension host by importing `@lithair-studio/generator`. The harness imports
the same module. One code path, one set of tests, one thing to re-verify on a
Lithair release.

## Generator internals

`packages/generator/src/`:

- `spec.ts` — the `LithairSpec` type (features + models + port + dataDir),
  mirroring the playground's `state` object. `defaultSpec()` reproduces the
  playground's initial state.
- `generate.ts` — `generate(spec)`, `buildFieldAttributes(field)`, and
  `modelSlug(name)`, faithfully ported from `generateCode` /
  `buildFieldAttributes` / `modelSlug` in `playground.astro`.
- `index.ts` — public surface.

`generate()` emits, in order: `use` imports (only what's used), an optional
env-var comment block, the `DeclarativeModel` structs, an `rbac_config()` fn
(when auth is on), a `firewall_config()` fn (when firewall or rate-limit is on),
then `#[tokio::main] async fn main()` with the `LithairServer` builder chain
ending in `.serve().await`.

## Verification pass: corrections vs. the playground / proposal

These were found by re-reading lithair @ v0.13.0 while porting (the
verify-before-encoding rule), and are documented inline in `generate.ts`:

1. **`auto_timestamp` is inert.** The playground emits
   `#[lifecycle(auto_timestamp)]`, but the v0.13 parser
   (`lithair-macros/src/declarative_simple.rs`, `parse_lifecycle_attributes`)
   recognizes only `immutable`, `audited`, `snapshot_only`, `versioned`, and
   `retention`. `auto_timestamp` is silently ignored — not a compile error. The
   generator keeps emitting it (byte-parity with the website); the extension's
   `#[lifecycle]` snippet **omits** it from its choices so it never suggests a
   no-op token.

2. **`#[retention(...)]` is struct-level, not field-level.**
   `parse_model_retention` iterates `input.attrs` (the struct's attributes), not
   field attributes. The proposal's snippet list grouped retention with field
   attributes; the actual snippet places it at struct level with a note.

3. **Builder methods all exist in v0.13.** Every method the generator emits
   (`with_port`, `with_model`, `with_sessions`, `with_models_require_session`,
   `with_frontend_at`, `with_rbac_config`, `with_mfa_totp`,
   `with_firewall_config`, `with_route_guard`, `with_admin_panel`,
   `with_data_admin`, `with_data_admin_ui`, `serve`) was confirmed in
   `lithair-core/src/app/builder.rs`. The playground's "v0.12" comments are
   stale labels; no builder-name drift was found in the generated chain.

4. **`use lithair_core::DeclarativeModel;` is valid.** `lithair-core` re-exports
   the derive (`lithair-core/src/lib.rs:125`,
   `pub use lithair_macros::{... DeclarativeModel ...}`). The in-repo examples
   import it from `lithair_macros` instead; both compile. The generator keeps
   the playground's `lithair_core` import.

## Field attribute → token reference (v0.13 source)

| UI toggle      | Emitted                         | Parser site (`declarative_simple.rs`) |
|----------------|----------------------------------|----------------------------------------|
| primaryKey     | `#[db(primary_key)]`            | `:397`                                  |
| indexed        | `#[db(indexed)]`               | `:399`                                  |
| unique         | `#[db(unique)]`                | `:398`                                  |
| immutable      | `#[lifecycle(immutable)]`      | `:436`                                  |
| audited        | `#[lifecycle(audited)]`        | `:437`                                  |
| versioned (N)  | `#[lifecycle(versioned = N)]`  | `:439`                                  |
| autoTimestamp  | `#[lifecycle(auto_timestamp)]` | *(not parsed — inert)*                  |
| expose         | `#[http(expose)]`              | `:491`                                  |
| validate       | `#[http(validate = "...")]`    | `:495` (rules: `generate_validation_check` `:731`) |
| replicate      | `#[persistence(replicate)]`    | `:547`                                  |
| trackHistory   | `#[persistence(track_history)]`| `:548`                                  |

Other recognized tokens not surfaced by the playground UI (available via
snippets only): `#[db(nullable)]`, `#[db(fk = "...")]`,
`#[lifecycle(snapshot_only)]`, `#[permission(read = "...", write = "...")]`,
`#[persistence(cache)]`, `#[pinned]`, struct-level `#[retention(memory = N)]`
and `#[schema(version = N)]`.
