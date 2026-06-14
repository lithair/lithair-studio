import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generate,
  buildFieldAttributes,
  modelSlug,
  defaultSpec,
  defaultFieldAttributes,
  type LithairSpec,
  type ModelSpec,
} from "../index";

function todoModel(): ModelSpec {
  return {
    name: "Todo",
    fields: [
      {
        name: "id",
        type: "String",
        attrs: { ...defaultFieldAttributes(), unique: true, immutable: true, expose: true },
      },
      {
        name: "title",
        type: "String",
        attrs: { ...defaultFieldAttributes(), expose: true, validate: "non_empty", audited: true },
      },
      {
        name: "done",
        type: "bool",
        attrs: { ...defaultFieldAttributes(), expose: true },
      },
    ],
  };
}

test("modelSlug pluralizes like the playground", () => {
  assert.equal(modelSlug("Article"), "articles");
  assert.equal(modelSlug("Category"), "categories"); // y -> ies
  assert.equal(modelSlug("Box"), "boxes"); // x -> es
  assert.equal(modelSlug("Class"), "classes"); // s -> es
  assert.equal(modelSlug("Dish"), "dishes"); // sh -> es
  assert.equal(modelSlug("Day"), "days"); // vowel+y stays +s
  assert.equal(modelSlug(""), "models"); // empty -> "model" -> "models"
});

test("buildFieldAttributes emits only the toggled derive attributes", () => {
  const field = {
    name: "title",
    type: "String",
    attrs: {
      ...defaultFieldAttributes(),
      expose: true,
      validate: "non_empty",
      audited: true,
      indexed: true,
    },
  };
  const out = buildFieldAttributes(field);
  assert.deepEqual(out, [
    "#[db(indexed)]",
    "#[lifecycle(audited)]",
    '#[http(expose, validate = "non_empty")]',
  ]);
});

test("buildFieldAttributes emits versioned = N", () => {
  const field = {
    name: "name",
    type: "String",
    attrs: { ...defaultFieldAttributes(), versioned: true, versionedN: 5 },
  };
  assert.deepEqual(buildFieldAttributes(field), ["#[lifecycle(versioned = 5)]"]);
});

test("generate produces a minimal compilable skeleton for an empty spec", () => {
  const rust = generate(defaultSpec());
  assert.match(rust, /use lithair_core::app::LithairServer;/);
  assert.match(rust, /#\[tokio::main\]/);
  assert.match(rust, /async fn main\(\) -> anyhow::Result<\(\)> \{/);
  assert.match(rust, /LithairServer::new\(\)/);
  assert.match(rust, /\.with_port\(3007\)/);
  assert.match(rust, /\.serve\(\)\n {8}\.await/);
  // No models, no auth → none of these appear.
  assert.doesNotMatch(rust, /with_model::</);
  assert.doesNotMatch(rust, /with_rbac_config/);
});

test("generate emits a DeclarativeModel struct and with_model registration", () => {
  const spec: LithairSpec = { ...defaultSpec(), models: [todoModel()] };
  const rust = generate(spec);

  // The derive line is exact.
  assert.match(
    rust,
    /#\[derive\(Debug, Clone, Serialize, Deserialize, DeclarativeModel\)\]/
  );
  assert.match(rust, /struct Todo \{/);
  // Field attributes ported faithfully.
  assert.match(rust, /#\[db\(unique\)\]/);
  assert.match(rust, /#\[lifecycle\(immutable\)\]/);
  assert.match(rust, /#\[http\(expose, validate = "non_empty"\)\]/);
  // Registration uses the slug for both data path and route.
  assert.match(
    rust,
    /\.with_model::<Todo>\("\.\/data\/todos", "\/api\/todos"\)/
  );
});

test("generate wires RBAC config when auth is enabled", () => {
  const spec = defaultSpec();
  spec.features.auth.enabled = true;
  const rust = generate(spec);
  assert.match(rust, /use lithair_core::rbac::\{RbacUser, ServerRbacConfig\};/);
  assert.match(rust, /fn rbac_config\(\) -> ServerRbacConfig \{/);
  assert.match(rust, /\.with_rbac_config\(rbac_config\(\)\)/);
  assert.match(rust, /\.with_sessions\(session_manager\)/);
  assert.match(rust, /\.with_models_require_session\(true\)/);
});

test("rate limit alone still emits a FirewallConfig carrying QPS", () => {
  const spec = defaultSpec();
  spec.features.rateLimit.enabled = true;
  spec.features.rateLimit.globalQps = 200;
  spec.features.rateLimit.perIpQps = 20;
  const rust = generate(spec);
  assert.match(rust, /fn firewall_config\(\) -> FirewallConfig \{/);
  assert.match(rust, /global_qps: Some\(200\),/);
  assert.match(rust, /per_ip_qps: Some\(20\),/);
  assert.match(rust, /\.with_firewall_config\(firewall_config\(\)\)/);
});

test("generate is deterministic", () => {
  const spec: LithairSpec = { ...defaultSpec(), models: [todoModel()] };
  assert.equal(generate(spec), generate(spec));
});
