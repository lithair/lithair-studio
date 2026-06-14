#!/usr/bin/env node
/**
 * lithair-harness — CLI sketch for the Layer 2 oracle (STUB).
 *
 * The interface is real; the pipeline is not implemented. Running any command
 * prints the design plan rather than faking a run, so the stub is honest and
 * still demonstrates the intended UX and the shared-generator wiring.
 *
 * Intended commands (Layer 2):
 *   lithair-harness run <spec.json>     run the oracle on a spec file
 *   lithair-harness run --random[=SEED] generate a random spec and run
 *   lithair-harness check <spec.json>   compile-only smoke (no boot/HTTP)
 *   lithair-harness preview <spec.json> print generate(spec) and exit  [works today]
 */

import * as fs from "fs";
import { generate, type LithairSpec } from "@lithair-studio/generator";

const PLAN = `lithair-harness (Layer 2 oracle) — DESIGN STUB

Pipeline once implemented:
  spec -> generate() -> Cargo project -> cargo check -> boot -> HTTP CRUD
       -> assert event-sourcing invariants -> report

Invariants asserted per model:
  write->read, write->list, update consistency, immutability rejection,
  uniqueness 409, retention budget, fk integrity.

Shares @lithair-studio/generator with the VS Code extension: a green run is
evidence the extension's generated code is sound (single code path).

Implementation order: see packages/harness/README.md.
`;

function previewCmd(specPath: string): number {
  let spec: LithairSpec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as LithairSpec;
  } catch (err) {
    console.error(`Could not read spec "${specPath}": ${String(err)}`);
    return 1;
  }
  // `preview` is the one command that works today — it exercises the shared
  // generator without needing the (unimplemented) compile/boot pipeline.
  process.stdout.write(generate(spec) + "\n");
  return 0;
}

function main(argv: string[]): number {
  const [cmd, arg] = argv;

  switch (cmd) {
    case "preview":
      if (!arg) {
        console.error("usage: lithair-harness preview <spec.json>");
        return 2;
      }
      return previewCmd(arg);

    case "run":
    case "check":
      console.log(PLAN);
      console.log(
        `(command "${cmd}" is part of Layer 2 and is not implemented yet)`
      );
      return 0;

    default:
      console.log(PLAN);
      console.log(
        "usage: lithair-harness <preview|run|check> [spec.json|--random]"
      );
      return cmd ? 2 : 0;
  }
}

process.exit(main(process.argv.slice(2)));
