import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { defaultSpec } from "@lithair-studio/generator";
import {
  resolveLithairCoreDep,
  renderCargoToml,
  writeCargoProject,
  defaultWorkDir,
  createOracle,
} from "../oracle";

test("resolveLithairCoreDep treats a version string as crates.io", () => {
  const dep = resolveLithairCoreDep("0.13");
  assert.equal(dep.toml, '"0.13"');
  assert.match(dep.label, /crates\.io:0\.13/);

  const pinned = resolveLithairCoreDep("=0.13.0");
  assert.equal(pinned.toml, '"=0.13.0"');
});

test("resolveLithairCoreDep treats a path-like override as a path dep", () => {
  const dep = resolveLithairCoreDep("/some/abs/lithair-core");
  assert.equal(dep.toml, '{ path = "/some/abs/lithair-core" }');
  assert.match(dep.label, /^path:/);
});

test("resolveLithairCoreDep honors LITHAIR_STUDIO_DEP when no override", () => {
  const prev = process.env.LITHAIR_STUDIO_DEP;
  process.env.LITHAIR_STUDIO_DEP = "0.99";
  try {
    const dep = resolveLithairCoreDep();
    assert.equal(dep.toml, '"0.99"');
  } finally {
    if (prev === undefined) delete process.env.LITHAIR_STUDIO_DEP;
    else process.env.LITHAIR_STUDIO_DEP = prev;
  }
});

test("renderCargoToml carries the verified dep set", () => {
  const toml = renderCargoToml('"0.13"');
  assert.match(toml, /lithair-core = "0\.13"/);
  assert.match(toml, /tokio = \{ version = "1", features = \["full"\] \}/);
  assert.match(toml, /anyhow = "1\.0"/);
  assert.match(toml, /serde = \{ version = "1\.0", features = \["derive"\] \}/);
  assert.match(toml, /edition = "2021"/);
});

test("writeCargoProject materializes Cargo.toml + src/main.rs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lstudio-check-test-"));
  try {
    writeCargoProject(dir, "fn main() {}", '"0.13"');
    assert.ok(fs.existsSync(path.join(dir, "Cargo.toml")));
    const main = fs.readFileSync(path.join(dir, "src", "main.rs"), "utf8");
    assert.equal(main, "fn main() {}\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultWorkDir is stable (reused for cargo caching), not a fresh tmpdir", () => {
  const a = defaultWorkDir();
  const b = defaultWorkDir();
  assert.equal(a, b);
  assert.match(a, /lithair-studio[\/\\]check$/);
});

test("oracle.run on the default (empty) spec generates a project and reports a structured result", async () => {
  // This does NOT invoke cargo (that is the documented manual / integration
  // run, which compiles deps and takes minutes). It exercises generate() +
  // project materialization + the report shape with a throwaway work dir.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lstudio-oracle-test-"));
  try {
    const oracle = createOracle();
    // crates.io dep so this stays offline-safe even if cargo were to run;
    // we set a bogus version and rely on the materialization, then assert the
    // project was written. We can't assert `compiled` without invoking cargo.
    const dep = resolveLithairCoreDep("0.13");
    const report = await oracle.run(defaultSpec(), {
      workDir: dir,
      lithairCoreDep: dep.toml,
      compileOnly: true,
    });
    assert.equal(report.generated, true);
    assert.equal(report.workDir, dir);
    assert.equal(report.lithairCoreDep, dep.toml);
    assert.ok(fs.existsSync(path.join(dir, "Cargo.toml")));
    assert.ok(fs.existsSync(path.join(dir, "src", "main.rs")));
    // `compiled`/`passed` depend on cargo; not asserted here.
    assert.equal(typeof report.compiled, "boolean");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
