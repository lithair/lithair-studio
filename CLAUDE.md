# Lithair Studio — tooling companion for the Lithair framework

This file is the operating manual for anyone — human or AI agent — working on
Lithair Studio. Read it before changing code.

Lithair Studio is **developer tooling for [Lithair](../lithair)**, the
memory-first Rust web framework. It is *a dependency on Lithair, not an end in
itself*: its whole reason to exist is to make Lithair faster to author, easier
to learn, and continuously provable. It is the front door for people who want to
build with Lithair.

## What it is (and is not)

**Is:** a small mono-repo with one shared core and two faces.

| Package | Role | Status |
|---------|------|--------|
| `packages/generator` | Pure TS core: a `LithairSpec` → Lithair **Rust source** generator. The only place that knows how a spec maps to Lithair code. | shipped (L1) |
| `packages/vscode` | The **authoring face**: a VS Code extension — dedicated snippets + a webview playground that runs the shared `generate()` and inserts the result into the editor. | shipped (L1) |
| `packages/harness` | The **verification face**: a CLI oracle that takes a spec (hand-written or AI/randomly generated) → `generate()` → temp Cargo project → `cargo check` → boot → HTTP CRUD → asserts event-sourcing invariants. | design stub (L2) |

**Is NOT:** a Lithair fork, a runtime, or a new language. Lithair code is *plain
Rust* (structs + derive-macro attributes), so **rust-analyzer already provides
all language smarts** — completion, type-check, rename, go-to-def. Studio adds
**no grammar and no LSP** (an LSP would fight rust-analyzer). Studio's value is
snippets, scaffolding, and — the real payoff — the generative test harness.

## 🔴 Prime directive: stay in lockstep with Lithair

The generator and the snippets **mirror Lithair's public authoring surface**.
When Lithair's macro DSL or builder API changes, Studio must follow *in the same
release window* — otherwise it silently emits code that no longer compiles, or
suggests tokens the parser ignores. Keeping Studio in sync with Lithair is the
**number-one maintenance responsibility of this repo.** Everything else is
secondary.

This is the same failure class Lithair itself fights (silently-dropped macro
attributes, e.g. lithair #75/#122). Studio must never become a second source of
that bug.

### The Lithair → Studio source-of-truth map

Every token Studio emits has an authority in the Lithair source. These are the
files to re-read on any change (paths relative to `../lithair`):

| Studio emits | Authority in Lithair (verified @ v0.13.0) |
|--------------|-------------------------------------------|
| `#[db(primary_key\|indexed\|unique)]` | `lithair-macros/src/declarative_simple.rs:397-399` |
| `#[lifecycle(immutable\|audited\|snapshot_only\|versioned=N\|retention)]` | `declarative_simple.rs` `parse_lifecycle_attributes` (~:430-453) |
| `#[retention(...)]` (struct-level) | `declarative_simple.rs` `parse_model_retention` (~:284-318) |
| `#[pinned]`, field types | `declarative_simple.rs` + playground `FIELD_TYPES` |
| `LithairServer::new().with_model/with_handler/with_vhost(...).serve()` | `lithair-core/src/app/builder.rs` |
| `use lithair_core::DeclarativeModel;` | re-export at `lithair-core/src/lib.rs:125` |

The generator's `generate.ts` carries a `CORRECTIONS` block documenting where the
website playground (`lithair-website/frontend/src/pages/playground.astro`,
`generateCode` :807-1060) diverges from the v0.13 parser. Keep it current.

### 🔴 House rule: verify before encoding

**Never add or change a token, attribute, or builder method from memory.** Open
the authority file, confirm the parser actually accepts it, and cite the
`file:line` in a comment. An uncited token is suspect and gets flagged on the
next pass.

The canonical example, already in the code: the playground emits
`#[lifecycle(auto_timestamp)]`, but the v0.13 parser does **not** recognize
`auto_timestamp` — it's silently ignored. So the generator keeps it only for
byte-parity with the website, and the `#[lifecycle]` **snippet omits it** to
never suggest a no-op. That decision is only defensible because someone *read the
parser*. Do the same for every token.

### Keeping in sync on a Lithair release (the procedure)

When a new Lithair version lands:

1. Re-read the source-of-truth files above; diff the accepted token set against
   what `generator/src/{spec,generate}.ts` and `vscode/snippets/lithair.json`
   emit.
2. Update the generator + snippets to match; add/refresh `file:line` citations
   and the `CORRECTIONS` block.
3. Bump the "Verified against lithair @ vX.Y.Z" line in `generate.ts`.
4. **Once the L2 harness exists, run `lithair-studio check` first** — let
   `cargo check` against real Lithair be the oracle. The endgame is that the
   compiler, not a hand-maintained mirror, is what catches drift.

## Architecture

One generator, two faces — so the IDE playground and the test oracle can never
disagree about what a spec produces. The webview is a *thin UI*; generation runs
on the extension host by importing `@lithair-studio/generator`. Full diagram and
rationale in `docs/architecture.md`. Do not vendor a second copy of the
spec→Rust logic into the webview — that reintroduces the drift this design
exists to prevent.

## Development

npm workspaces. From the repo root:

- `npm install` — links the three workspaces (`generator` is a dep of the others).
- `npm run build` — `tsc` all packages.
- `npm test` — generator unit tests (`node:test`).
- **Run the extension:** open the **repo root** in VS Code → Run & Debug →
  "Run Lithair Studio Extension" (F5). The `.vscode/launch.json` builds all
  packages then launches an Extension Development Host. A self-contained `.vsix`
  needs esbuild bundling (deferred); F5 needs none.
- Package: `cd packages/vscode && npx --yes @vscode/vsce package --no-dependencies`.

Keep the generator **pure and tested**. Every change to `generate()` should come
with or update a unit test, because the harness leans on it being trustworthy.

## Roadmap (layers)

- **Layer 1 — done.** Generator core + snippets + webview playground with
  insert-into-editor + scaffold/run commands.
- **Layer 2 — the point.** The harness oracle. First brick: the `check` command
  (spec → temp Cargo project → `cargo check`). That alone makes the compiler the
  source of truth for generator correctness. Then: boot the generated app, fire
  HTTP CRUD, assert event-sourcing invariants (write→read/list consistency,
  immutability rejection, uniqueness 409, retention budget, fk integrity).
- **The vision behind L2:** *"generate any API in Lithair, then test it"* —
  generative regression testing. An AI (or a random generator) emits arbitrary
  valid Lithair apps; the oracle proves they still compile and behave across
  Lithair versions. It is non-regression testing without a frozen suite — the
  test that removes fear instead of feeding it.

## Relationship to the rest of the ecosystem

Studio depends on Lithair; the reverse is never true (Lithair must not depend on
Studio). Studio may *later* be added to the Vigil monitoring rotation, but that
is undecided — it is a Lithair dependency, not a monitored project in its own
right yet. If it is added, it follows the same project-agent protocol as the
others.

## Tone for any docs/READMEs in this repo

Honest, plain, evidence-based. No marketing language ("blazingly fast",
"production-ready") unless there is a benchmark behind it. State what is shipped,
what is a stub, and what is unverified — the same bar Lithair holds itself to.
