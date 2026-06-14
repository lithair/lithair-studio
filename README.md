# lithair-studio

Authoring tools for [Lithair](https://lithair.net) sites. A Lithair site is a
plain Rust binary crate: a `LithairServer` builder chain plus model `struct`s
carrying `DeclarativeModel` derive attributes. rust-analyzer already provides
full language intelligence for that Rust; this repo adds the Lithair-specific
ergonomics on top — it does not replace rust-analyzer.

This is a npm-workspaces monorepo with three packages, organized around one
shared idea: there should be **a single piece of code that turns a site spec
into Lithair Rust**, and everything else reuses it.

```
lithair-studio/
├── packages/
│   ├── generator/   shared core — spec model + generate(spec) -> Rust string (TS lib)
│   ├── vscode/      VS Code extension — snippets, embedded playground, scaffolding
│   └── harness/     STUB — design of the Layer 2 generative test oracle
└── docs/
    └── architecture.md
```

## The vision: one generator, two faces

The website playground (`lithair-website`) is a client-side code generator: you
toggle features and define models, and it emits Lithair Rust you copy into a
project. Its spec→Rust logic lived as inline JS in a single Astro page.

`packages/generator` lifts that logic into a pure, tested TypeScript library.
Two consumers then share it:

- **The extension's playground** (a "face" for authoring): the same spec→Rust
  generation, but inside the IDE, with an *Insert into editor* action that
  closes the loop the website's Copy button can't — configure, inject into the
  real `main.rs`, `cargo run`.
- **The harness** (a "face" for verification, Layer 2): feed specs through the
  same generator, compile and boot the result, and assert the runtime behaves.
  Because it shares the generator, a green harness run is direct evidence the
  extension's output is sound — there is no second code path to keep in sync.

## Packages

### `packages/generator` (built)

Pure TypeScript. `generate(spec)` returns compilable Lithair Rust. No I/O, no
DOM. Faithfully ported from the playground's `generateCode`, then verified
against lithair @ v0.13.0 source (see `docs/architecture.md` for the
corrections found during porting).

```bash
cd packages/generator
npm run build   # tsc
npm test        # tsc + node:test unit tests
```

### `packages/vscode` (built)

A VS Code extension (`name: lithair-studio`). Contributes:

- **Snippets** (`snippets/lithair.json`) for the real derive attributes
  (`#[db]`, `#[lifecycle]`, `#[http]`, `#[permission]`, `#[persistence]`,
  `#[pinned]`, struct-level `#[retention]`/`#[schema]`) and the builder API.
  Every token is transcribed from the v0.13 parser, not invented.
- **Lithair Studio: Playground** — a webview spec editor; generated Rust comes
  from the shared generator running on the extension host. *Insert into editor*
  injects it at the cursor.
- **Lithair Studio: New Project** — scaffold a minimal Cargo crate (a
  `DeclarativeModel` + `serve()`), shaped like `examples/01-hello-world`.
- **Lithair Studio: Run** — `cargo run` in the integrated terminal.

```bash
cd packages/vscode
npm run build   # tsc -> dist/
```

See [packages/vscode/README.md](packages/vscode/README.md) for loading/testing
the extension (F5 debug or building a `.vsix`).

### `packages/harness` (stub — Layer 2)

Design sketch of a generative regression-test oracle. Interfaces and a CLI
skeleton only; the compile/boot/HTTP pipeline is not implemented. The one
working command today is `preview` (spec → generated Rust via the shared core).
See [packages/harness/README.md](packages/harness/README.md).

## Build everything

```bash
npm install        # at repo root — links the workspaces
npm run build      # build all packages that define a build script
```

## Status

Layer 1 (this repo): generator + extension are built and compile; generator has
unit tests. Harness is an explicit stub. The extension has **not** been
exercised inside a running VS Code instance in this scaffold — loading
instructions are in the extension README so that can be verified next.

## Known risk: playground/framework API drift

The website playground hardcodes the Lithair API in JS and its comments label it
"v0.12"; the workspace is v0.13.0. The builder methods the generator emits were
re-verified against v0.13 source and all exist, so the generated builder chain
compiles. But this drift is structural: when Lithair's API changes, the
generator must be re-verified against source. The harness (Layer 2) is the
durable answer — it makes `cargo check` + a real boot the source of truth
instead of a hand-maintained mirror.
