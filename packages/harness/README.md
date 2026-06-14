# @lithair-studio/harness (Layer 2)

A generative regression-test oracle for Lithair.

**Status:** the `check` stage — spec → `generate()` → temp Cargo project →
`cargo check` — is **implemented** (Layer 2, brick 1). The boot + HTTP CRUD +
event-sourcing invariant stages are still sketched (`src/oracle.ts`) and not
yet wired.

## `check` — the compile oracle (implemented)

```bash
npm run build
node packages/harness/dist/cli.js check <spec.json>
```

It loads the spec, runs the shared `generate()`, writes a throwaway Cargo
project, runs `cargo check`, and reports **green** (`✓`, exit 0) or **red**
(`✗` + cargo's error output, non-zero exit). The exit-code contract lets CI or
an AI driver consume it.

### lithair-core dependency strategy

The generated `Cargo.toml` pins `lithair-core` one of two ways:

- **Default — local sibling path dep** `{ path = "../lithair/lithair-core" }`
  when the sibling checkout exists. This is the prime-directive use case:
  `cargo check` validates the generator against the **live** Lithair source, so
  drift surfaces immediately.
- **Fallback — crates.io** `"0.13"` when no sibling is present (portability).

Override with `--lithair <path|version>` or the `LITHAIR_STUDIO_DEP` env var
(a value that looks like a version → crates.io; anything else → a path).

The dep set (lithair-core with default features → the `macros` re-export, tokio
`full`, serde `derive`, anyhow, uuid, chrono; edition 2021) was copied from a
real example — `lithair/examples/03-rest-api/Cargo.toml` and
`lithair-core/Cargo.toml` (`default = ["macros"]`) — per the verify-before-encoding
house rule. The generator's `use lithair_core::DeclarativeModel;` resolves via
the re-export at `lithair-core/src/lib.rs:125`, so no separate `lithair-macros`
dep is needed.

### Work/target cache

The throwaway project lives in a **stable, reused** directory
(`~/.cache/lithair-studio/check`, honoring `XDG_CACHE_HOME`; override with
`--work-dir`). The first `check` compiles lithair-core + tokio + deps (minutes);
because the `target/` is reused, repeat checks are sub-second.

## Other commands

```
lithair-harness preview <spec.json>   # spec -> generate() -> stdout
lithair-harness check   <spec.json>   # compile oracle (above)
lithair-harness run     <spec.json>   # full oracle — boot/HTTP not wired yet
```

## What it will do

Prove that what `@lithair-studio/generator` emits both **compiles** and
**behaves correctly** against a real Lithair runtime. It imports the exact same
`generate()` the VS Code extension uses, so a green oracle run is evidence the
extension's output is sound — there is no second code path to keep in sync.

### Pipeline

```
spec ──generate()──▶ Rust source
     ──▶ write throwaway Cargo project (Cargo.toml + src/main.rs + data dir)
     ──▶ cargo check / build        (fail fast on invalid generated code)
     ──▶ boot the binary on a free port, wait for readiness
     ──▶ fire HTTP CRUD against each model's /api/<slug>
     ──▶ assert event-sourcing invariants
     ──▶ tear down + report
```

### Invariants asserted (per model)

- **write→read** — a POSTed entity is byte-faithful on `GET /:id`
- **write→list** — a POSTed entity appears in the list response
- **update consistency** — `PUT`/`PATCH` reflected on subsequent `GET`
- **immutability** — `PUT` changing a `#[lifecycle(immutable)]` field is rejected
- **uniqueness** — duplicate `#[db(unique)]` insert returns 409
- **retention** — with `#[retention(memory = N)]`, only N most-recent survive
- **fk integrity** — `#[db(fk = "...")]` referencing a missing parent is rejected

### Spec sources

- a `spec.json` file,
- an inline spec object,
- a randomly generated spec (seeded) — fuzz the generator and the runtime
  together.

## Shared generator

The oracle takes a dependency on `@lithair-studio/generator` (see
`package.json`). This is deliberate: the thing under test is the same generator
the IDE ships, so validating the harness validates the extension.

## Layer 2 implementation order

`createOracle()` in `src/oracle.ts`, stage by stage:

1. ✅ **`resolveSpec` + project writer** — spec → temp Cargo project on disk.
2. ✅ **compile stage** (`check` command) — shell out to `cargo check`; surface
   stdout/stderr in `OracleReport.compileOutput`. This turns `cargo check` into
   the source of truth for generator correctness, replacing the hand-maintained
   API mirror as the thing that catches drift — no runtime needed.
3. ⬜ **boot + HTTP stage** — spawn the binary, poll readiness, run the CRUD
   invariants. Implement invariants in the order listed above; each must be
   verified against the actual lithair-core runtime behavior first (re-read the
   relevant source and halt-and-report if it differs from the sketch — Lithair
   house rule).
