#!/usr/bin/env node
/**
 * lithair-harness — CLI for the Layer 2 oracle.
 *
 * Commands:
 *   lithair-harness preview <spec.json>   print generate(spec) and exit
 *   lithair-harness check <spec.json>     spec -> generate() -> temp Cargo
 *                                         project -> `cargo check` -> green/red
 *   lithair-harness run <spec.json>       full oracle (boot + HTTP CRUD) — the
 *                                         boot/invariant stages are not wired yet
 *
 * `check` is the Layer-2 brick-1 implementation: it makes the Rust compiler the
 * source of truth for generator correctness. Exit code 0 == compiles (green),
 * non-zero == compile error (red, cargo output relayed). That contract lets CI
 * and an AI driver consume it.
 *
 * lithair-core dependency strategy (see oracle.ts:resolveLithairCoreDep):
 *   default = local sibling `../lithair/lithair-core` path dep if present
 *             (drift detection — checks the generator against LIVE Lithair),
 *             else crates.io `"0.13"` (portability).
 *   override via `--lithair <path|version>` or LITHAIR_STUDIO_DEP env var.
 *
 * Work/target cache: a STABLE reused dir (default ~/.cache/lithair-studio/check,
 * honors XDG_CACHE_HOME) so cargo's target/ survives across runs — the first
 * check compiles lithair-core + tokio + deps (minutes); repeats are fast.
 * Override with `--work-dir <dir>`.
 */

import * as fs from "fs";
import { generate, type LithairSpec } from "@lithair-studio/generator";
import {
  createOracle,
  defaultWorkDir,
  resolveLithairCoreDep,
} from "./oracle";

function loadSpec(specPath: string): LithairSpec {
  // Same spec-loading the `preview` command uses: parse the JSON file.
  return JSON.parse(fs.readFileSync(specPath, "utf8")) as LithairSpec;
}

function previewCmd(specPath: string): number {
  let spec: LithairSpec;
  try {
    spec = loadSpec(specPath);
  } catch (err) {
    console.error(`Could not read spec "${specPath}": ${String(err)}`);
    return 1;
  }
  process.stdout.write(generate(spec) + "\n");
  return 0;
}

interface CheckArgs {
  specPath?: string;
  lithair?: string;
  workDir?: string;
}

/** Parse `check [--lithair <x>] [--work-dir <d>] <spec.json>`. */
function parseCheckArgs(rest: string[]): CheckArgs | { error: string } {
  const out: CheckArgs = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--lithair") {
      const v = rest[++i];
      if (v === undefined) return { error: "--lithair requires a value" };
      out.lithair = v;
    } else if (a.startsWith("--lithair=")) {
      out.lithair = a.slice("--lithair=".length);
    } else if (a === "--work-dir") {
      const v = rest[++i];
      if (v === undefined) return { error: "--work-dir requires a value" };
      out.workDir = v;
    } else if (a.startsWith("--work-dir=")) {
      out.workDir = a.slice("--work-dir=".length);
    } else if (a.startsWith("-")) {
      return { error: `unknown flag: ${a}` };
    } else if (out.specPath === undefined) {
      out.specPath = a;
    } else {
      return { error: `unexpected argument: ${a}` };
    }
  }
  return out;
}

async function checkCmd(rest: string[]): Promise<number> {
  const parsed = parseCheckArgs(rest);
  if ("error" in parsed) {
    console.error(`error: ${parsed.error}`);
    console.error(
      "usage: lithair-harness check [--lithair <path|version>] [--work-dir <dir>] <spec.json>"
    );
    return 2;
  }
  if (!parsed.specPath) {
    console.error(
      "usage: lithair-harness check [--lithair <path|version>] [--work-dir <dir>] <spec.json>"
    );
    return 2;
  }

  let spec: LithairSpec;
  try {
    spec = loadSpec(parsed.specPath);
  } catch (err) {
    console.error(`Could not read spec "${parsed.specPath}": ${String(err)}`);
    return 1;
  }

  const dep = resolveLithairCoreDep(parsed.lithair);
  const workDir = parsed.workDir ?? defaultWorkDir();

  console.error(`lithair-core dep: ${dep.label}`);
  console.error(`work dir (cargo cache reused here): ${workDir}`);
  console.error("running cargo check (first run compiles deps — may take minutes)...");

  const oracle = createOracle();
  const report = await oracle.run(spec, {
    workDir,
    lithairCoreDep: dep.toml,
    compileOnly: true,
  });

  if (report.compiled) {
    console.log("✓ check passed — generated code compiles");
    return 0;
  }

  console.log("✗ check failed — generated code does not compile\n");
  if (report.compileOutput) {
    process.stdout.write(report.compileOutput + "\n");
  }
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "preview": {
      const arg = rest[0];
      if (!arg) {
        console.error("usage: lithair-harness preview <spec.json>");
        return 2;
      }
      return previewCmd(arg);
    }

    case "check":
      return checkCmd(rest);

    case "run":
      console.error(
        "`run` (full oracle: boot + HTTP CRUD + invariants) is not wired yet.\n" +
          "Use `check <spec.json>` for the compile oracle (Layer 2, brick 1)."
      );
      return 2;

    default:
      console.log(
        "usage: lithair-harness <preview|check|run> [--lithair <path|version>] [--work-dir <dir>] <spec.json>"
      );
      return cmd ? 2 : 0;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
