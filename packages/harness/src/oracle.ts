/**
 * Layer 2 — generative regression-test oracle.
 *
 * The oracle's job: prove that what `@lithair-studio/generator` emits actually
 * compiles AND behaves correctly against a real Lithair runtime. It shares the
 * exact same `generate()` the VS Code extension uses, so a green oracle run is
 * evidence the extension's output is sound — there is no second code path to
 * keep in sync.
 *
 * STATUS (Layer 2, brick 1): the `check` stage (spec → temp Cargo project →
 * `cargo check`) is IMPLEMENTED. The boot + HTTP CRUD + invariant stages are
 * still sketched below and not yet wired — `run({ compileOnly: false })`
 * currently performs the compile stage and reports the invariant stages as
 * not-yet-implemented rather than faking results.
 *
 * Pipeline:
 *
 *   spec ──generate()──▶ Rust source
 *        │
 *        ▼
 *   write a throwaway Cargo project (Cargo.toml + src/main.rs + data dir)  [DONE]
 *        │
 *        ▼
 *   cargo check                ── fail fast if the generated code is invalid [DONE]
 *        │
 *        ▼
 *   boot the binary on a free port, wait for readiness                      [TODO]
 *        │
 *        ▼
 *   fire HTTP CRUD against each generated model's /api/<slug> routes        [TODO]
 *        │
 *        ▼
 *   assert event-sourcing invariants:                                       [TODO]
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
 *
 * The Cargo.toml the `check` stage emits was derived by reading a real Lithair
 * example (verify-before-encoding house rule):
 *   - dep set: lithair-core (default features → brings the `macros` re-export),
 *     tokio (full), serde (derive), anyhow, uuid, chrono — confirmed against
 *     `lithair/examples/03-rest-api/Cargo.toml` and `lithair-core/Cargo.toml`
 *     (`default = ["macros"]`, so `use lithair_core::DeclarativeModel;` resolves
 *     without a separate lithair-macros dep — re-export at lib.rs:125).
 *   - edition 2021 — `lithair/Cargo.toml` workspace.package.edition.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { generate, type LithairSpec } from "@lithair-studio/generator";

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
  /** Which lithair-core dependency the temp project pinned. */
  lithairCoreDep?: string;
  /** Where the temp Cargo project / target cache lives. */
  workDir?: string;
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
 * The oracle interface. Layer 2 implements this incrementally; the signature is
 * fixed here so the CLI and any callers can be written against it.
 */
export interface Oracle {
  /** Resolve a {@link SpecSource} into a concrete spec (random gen lives here). */
  resolveSpec(source: SpecSource): Promise<LithairSpec>;

  /** Run the full pipeline for one spec and return a structured report. */
  run(spec: LithairSpec, options: OracleOptions): Promise<OracleReport>;
}

/* ───────────────────────── lithair-core dependency ───────────────────────── */

/**
 * Where the local Lithair sibling checkout is expected, relative to this repo.
 * `lithair-studio` and `lithair` are siblings (see CLAUDE.md). From the built
 * file (`dist/oracle.js`) we walk up to the studio repo root and across.
 */
export function siblingLithairCorePath(): string | null {
  // studioRoot = .../lithair-studio ; sibling = .../lithair/lithair-core
  // __dirname at runtime is .../packages/harness/dist
  const studioRoot = path.resolve(__dirname, "..", "..", "..");
  const candidate = path.resolve(studioRoot, "..", "lithair", "lithair-core");
  try {
    if (
      fs.existsSync(path.join(candidate, "Cargo.toml")) &&
      fs.statSync(candidate).isDirectory()
    ) {
      return candidate;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve the lithair-core dependency spec for the generated Cargo.toml.
 *
 * Precedence: explicit override (flag/env) > local sibling path > crates.io.
 *
 * Returns a TOML fragment AND a human label:
 *   - `{ path = "/abs/.../lithair/lithair-core" }`  (drift detection)
 *   - `"0.13"`                                       (portability fallback)
 *
 * @param override a path (absolute or relative, points at the lithair-core
 *   crate dir) or a bare version string ("0.13"). When undefined, auto-detect.
 */
export function resolveLithairCoreDep(override?: string): {
  toml: string;
  label: string;
} {
  let value = override;
  if (value === undefined || value === "") {
    const env = process.env.LITHAIR_STUDIO_DEP;
    if (env && env.trim() !== "") value = env.trim();
  }

  if (value === undefined || value === "") {
    const sibling = siblingLithairCorePath();
    if (sibling) {
      return {
        toml: `{ path = ${JSON.stringify(sibling)} }`,
        label: `path:${sibling} (local sibling — drift detection)`,
      };
    }
    return {
      toml: `"0.13"`,
      label: "crates.io:0.13 (no local sibling found — portability fallback)",
    };
  }

  // Heuristic: a value that looks like a version ("0.13", "=0.13.0", "^1.2")
  // is treated as a crates.io version; anything else is treated as a path.
  if (/^[\^~=]?\d+(\.\d+){0,2}$/.test(value)) {
    return { toml: JSON.stringify(value), label: `crates.io:${value}` };
  }

  const abs = path.resolve(value);
  return {
    toml: `{ path = ${JSON.stringify(abs)} }`,
    label: `path:${abs}`,
  };
}

/* ─────────────────────────── Cargo project writer ────────────────────────── */

/**
 * Render the Cargo.toml for the throwaway project.
 *
 * Dep set verified against `lithair/examples/03-rest-api/Cargo.toml` and
 * `lithair-core/Cargo.toml` (verify-before-encoding):
 *   - lithair-core with DEFAULT features → `default = ["macros"]` re-exports the
 *     `DeclarativeModel` derive (lithair-core/src/lib.rs:125), which is what the
 *     generator imports (`use lithair_core::DeclarativeModel;`). No separate
 *     lithair-macros dep is required.
 *   - tokio `full` — generated `main` is `#[tokio::main]`.
 *   - serde `derive` — generated structs `#[derive(... Serialize, Deserialize)]`.
 *   - anyhow — generated `main` returns `anyhow::Result<()>`.
 *   - uuid / chrono — available in case a spec uses `Uuid` / `DateTime` field
 *     types (the example declares both; harmless if unused).
 */
export function renderCargoToml(lithairCoreDepToml: string): string {
  return `# Generated by lithair-studio harness (check oracle). Throwaway project.
[package]
name = "lithair-studio-check"
version = "0.0.0"
edition = "2021"
publish = false

[[bin]]
name = "lithair-studio-check"
path = "src/main.rs"

[dependencies]
lithair-core = ${lithairCoreDepToml}
tokio = { version = "1", features = ["full"] }
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
`;
}

/**
 * Materialize the throwaway Cargo project at {@link workDir}.
 * Returns the directory written.
 */
export function writeCargoProject(
  workDir: string,
  rustSource: string,
  lithairCoreDepToml: string
): string {
  fs.mkdirSync(path.join(workDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workDir, "Cargo.toml"),
    renderCargoToml(lithairCoreDepToml)
  );
  fs.writeFileSync(
    path.join(workDir, "src", "main.rs"),
    rustSource.endsWith("\n") ? rustSource : rustSource + "\n"
  );
  return workDir;
}

/**
 * Default work directory: a STABLE, reused location so cargo's target cache
 * survives across runs (the first run compiles lithair-core + tokio + deps,
 * which is slow; subsequent runs reuse the cache). NOT a fresh tmpdir per run.
 *
 * Honors `XDG_CACHE_HOME`; otherwise `~/.cache/lithair-studio/check`.
 */
export function defaultWorkDir(): string {
  const base =
    process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.trim() !== ""
      ? process.env.XDG_CACHE_HOME
      : path.join(os.homedir(), ".cache");
  return path.join(base, "lithair-studio", "check");
}

/* ─────────────────────────────── compile stage ───────────────────────────── */

/** Trim cargo output to something readable in a terminal / CI log. */
function trimCargoOutput(out: string, maxLines = 200): string {
  const text = out.replace(/\s+$/, "");
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const head = lines.slice(0, maxLines);
  return (
    head.join("\n") +
    `\n... (${lines.length - maxLines} more lines trimmed; rerun cargo check in the work dir for full output)`
  );
}

/** Run `cargo check` in {@link workDir}, capturing combined stdout+stderr. */
export function cargoCheck(workDir: string): {
  ok: boolean;
  output: string;
} {
  const res = spawnSync("cargo", ["check", "--color", "never"], {
    cwd: workDir,
    encoding: "utf8",
    // Keep the target dir inside workDir so the cache is stable & co-located.
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    maxBuffer: 64 * 1024 * 1024,
  });

  if (res.error) {
    return {
      ok: false,
      output: `failed to spawn cargo: ${res.error.message}`,
    };
  }

  const combined =
    (res.stdout || "") + (res.stderr ? "\n" + res.stderr : "");
  return { ok: res.status === 0, output: trimCargoOutput(combined) };
}

/* ──────────────────────────────── the oracle ─────────────────────────────── */

class HarnessOracle implements Oracle {
  async resolveSpec(source: SpecSource): Promise<LithairSpec> {
    switch (source.kind) {
      case "inline":
        return source.spec;
      case "file": {
        const raw = fs.readFileSync(source.path, "utf8");
        return JSON.parse(raw) as LithairSpec;
      }
      case "random":
        throw new Error(
          "random spec generation is not implemented yet (Layer 2, later brick)"
        );
    }
  }

  async run(spec: LithairSpec, options: OracleOptions): Promise<OracleReport> {
    const dep = options.lithairCoreDep;

    // 1+2. generate() → Rust source.
    const source = generate(spec);
    const report: OracleReport = {
      spec,
      generated: source.length > 0,
      compiled: false,
      lithairCoreDep: dep,
      workDir: options.workDir,
      booted: false,
      invariants: [],
      passed: false,
    };

    // 3. Materialize the throwaway Cargo project (stable work dir for caching).
    writeCargoProject(options.workDir, source, dep);

    // 4+5. cargo check.
    const check = cargoCheck(options.workDir);
    report.compiled = check.ok;
    report.compileOutput = check.output;

    if (!check.ok) {
      report.passed = false;
      return report;
    }

    if (options.compileOnly) {
      // `check` command: green == compiles. No boot/HTTP performed.
      report.passed = true;
      return report;
    }

    // Boot + HTTP + invariants are not wired yet. Be honest: report the compile
    // success but flag the remaining stages as unimplemented rather than
    // pretending they passed.
    report.booted = false;
    report.invariants = [
      {
        name: "boot+http+invariants",
        model: "*",
        passed: false,
        detail:
          "not implemented yet (Layer 2, later bricks). Use compileOnly/`check` for now.",
      },
    ];
    report.passed = false;
    return report;
  }
}

/** Factory for the oracle. The `check` (compile-only) stage is implemented. */
export function createOracle(): Oracle {
  return new HarnessOracle();
}
