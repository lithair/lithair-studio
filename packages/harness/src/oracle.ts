/**
 * Layer 2 — generative regression-test oracle (DESIGN SKETCH, not implemented).
 *
 * The oracle's job: prove that what `@lithair-studio/generator` emits actually
 * compiles AND behaves correctly against a real Lithair runtime. It shares the
 * exact same `generate()` the VS Code extension uses, so a green oracle run is
 * evidence the extension's output is sound — there is no second code path to
 * keep in sync.
 *
 * Pipeline (each stage is a stub below):
 *
 *   spec ──generate()──▶ Rust source
 *        │
 *        ▼
 *   write a throwaway Cargo project (Cargo.toml + src/main.rs + data dir)
 *        │
 *        ▼
 *   cargo check / cargo build  ── fail fast if the generated code is invalid
 *        │
 *        ▼
 *   boot the binary on a free port, wait for readiness
 *        │
 *        ▼
 *   fire HTTP CRUD against each generated model's /api/<slug> routes
 *        │
 *        ▼
 *   assert event-sourcing invariants:
 *     - write→read: POSTed entity is byte-faithful on GET /:id
 *     - write→list: POSTed entity appears in GET (list)
 *     - update consistency: PUT/PATCH reflected on subsequent GET
 *     - immutability: PUT changing an #[lifecycle(immutable)] field is rejected
 *     - uniqueness: duplicate #[db(unique)] insert returns 409
 *     - retention: with #[retention(memory = N)], only N most-recent survive
 *     - fk integrity: #[db(fk = "...")] referencing a missing parent is rejected
 *        │
 *        ▼
 *   tear down (kill process, remove temp dir) and report
 *
 * IMPORTANT (Lithair house rule): every invariant the oracle asserts must be
 * checked against the ACTUAL runtime behavior of the lithair version under
 * test — not against this comment. The comment is a design intent; the parser
 * and runtime are the source of truth. A sub-agent implementing any stage must
 * re-read the relevant lithair-core source first and halt-and-report if the
 * real behavior differs from what is sketched here.
 */

import type { LithairSpec } from "@lithair-studio/generator";

/** How a spec is sourced for an oracle run. */
export type SpecSource =
  | { kind: "file"; path: string }
  | { kind: "inline"; spec: LithairSpec }
  | { kind: "random"; seed: number };

/** One invariant assertion result. */
export interface InvariantResult {
  name: string;
  model: string;
  passed: boolean;
  detail?: string;
}

/** Full result of one oracle run. */
export interface OracleReport {
  spec: LithairSpec;
  /** Did `generate()` produce code at all. */
  generated: boolean;
  /** Result of `cargo check`/build. */
  compiled: boolean;
  compileOutput?: string;
  /** Did the server boot and become reachable. */
  booted: boolean;
  /** Per-invariant results. */
  invariants: InvariantResult[];
  /** Overall pass = compiled && booted && all invariants passed. */
  passed: boolean;
}

/** Options for an oracle run. */
export interface OracleOptions {
  /** Working directory for the throwaway Cargo project. */
  workDir: string;
  /** How to resolve `lithair-core` (path/git/version). */
  lithairCoreDep: string;
  /** Stop at compile (skip boot + HTTP) — fast smoke mode. */
  compileOnly?: boolean;
  /** Port to bind; 0 = pick a free one. */
  port?: number;
}

/**
 * The oracle interface. Layer 2 will implement this; the signature is fixed
 * here so the CLI and any callers can be written against it now.
 */
export interface Oracle {
  /** Resolve a {@link SpecSource} into a concrete spec (random gen lives here). */
  resolveSpec(source: SpecSource): Promise<LithairSpec>;

  /** Run the full pipeline for one spec and return a structured report. */
  run(spec: LithairSpec, options: OracleOptions): Promise<OracleReport>;
}

/**
 * Placeholder factory. Layer 2 implements this. It deliberately throws so that
 * nothing downstream mistakes the stub for a working oracle — the CLI checks
 * for this and prints the design plan instead of pretending to run.
 */
export function createOracle(): Oracle {
  throw new Error(
    "Layer 2 oracle is not implemented yet. See packages/harness/README.md " +
      "for the design and the implementation order."
  );
}
