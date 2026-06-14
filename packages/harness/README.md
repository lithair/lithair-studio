# @lithair-studio/harness (Layer 2 — STUB)

Design of a generative regression-test oracle for Lithair. **Not implemented.**
This package ships interfaces (`src/oracle.ts`) and a CLI skeleton
(`src/cli.ts`); the compile/boot/HTTP pipeline is a stub.

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

## CLI (sketch)

```
lithair-harness preview <spec.json>     # WORKS today — spec -> generate() -> stdout
lithair-harness run <spec.json>         # Layer 2 — full oracle
lithair-harness run --random[=SEED]     # Layer 2 — random spec + oracle
lithair-harness check <spec.json>       # Layer 2 — compile-only smoke
```

Only `preview` is implemented (it exercises the shared generator without the
unimplemented pipeline). `run`/`check` print the design plan and exit.

```bash
npm run build
node dist/cli.js preview ./some-spec.json
```

## Shared generator

The oracle takes a dependency on `@lithair-studio/generator` (see
`package.json`). This is deliberate: the thing under test is the same generator
the IDE ships, so validating the harness validates the extension.

## Cleanest next step for Layer 2

Implement `createOracle()` in `src/oracle.ts` stage by stage, smallest first:

1. **`resolveSpec` + project writer** — spec → temp Cargo project on disk
   (pure I/O; easy to test against a golden directory).
2. **compile stage** — shell out to `cargo check`; surface stdout/stderr in
   `OracleReport.compileOutput`. This alone (the `check` command) already
   catches the API-drift risk the generator carries, with no runtime needed.
3. **boot + HTTP stage** — spawn the binary, poll readiness, run the CRUD
   invariants. Implement invariants in the order listed above; each must be
   verified against the actual lithair-core runtime behavior first (re-read the
   relevant source and halt-and-report if it differs from the sketch — Lithair
   house rule).

Starting at step 2 (`check` only) delivers most of the value: it turns
`cargo check` into the source of truth for generator correctness, replacing the
hand-maintained API mirror as the thing that catches drift.
