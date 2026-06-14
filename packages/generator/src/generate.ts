/**
 * Lithair spec -> Rust source generator.
 *
 * Ported faithfully from `generateCode(s)` in
 * `lithair-website/frontend/src/pages/playground.astro` (:807-1060). This is the
 * single source of truth for how a spec maps to a `LithairServer` builder chain
 * and `DeclarativeModel` structs. The VS Code extension and the test harness
 * both import `generate()` from here so they cannot drift from each other.
 *
 * Pure function: no I/O, no DOM, no globals. Given the same spec it always
 * returns the same string.
 *
 * Verified against lithair @ v0.13.0 (see CORRECTIONS at the bottom of this
 * file for the deltas found between the playground's hardcoded API and the
 * v0.13 source).
 */

import type { LithairSpec, FieldSpec } from "./spec";

/**
 * Slug used for a model's data path and route base, e.g. `Article` -> `articles`,
 * `Category` -> `categories`. Faithful port of `modelSlug` (playground :792-805).
 */
export function modelSlug(name: string): string {
  let base = (name || "model").trim();
  base = base.replace(/[^A-Za-z0-9_]/g, "") || "model";
  const lower = base.toLowerCase();
  if (lower.endsWith("y") && !/[aeiou]y$/.test(lower)) {
    return lower.slice(0, -1) + "ies";
  }
  if (
    lower.endsWith("s") ||
    lower.endsWith("x") ||
    lower.endsWith("z") ||
    lower.endsWith("ch") ||
    lower.endsWith("sh")
  ) {
    return lower + "es";
  }
  return lower + "s";
}

/**
 * Build the `#[db(...)]` / `#[lifecycle(...)]` / `#[http(...)]` /
 * `#[persistence(...)]` attribute lines for one field.
 *
 * Faithful port of `buildFieldAttributes(field)` (playground :1028-1060).
 * Every token emitted here is recognized by the v0.13 parser in
 * `declarative_simple.rs` EXCEPT `auto_timestamp`, which the parser ignores
 * silently (see note in spec.ts). It is kept for byte-parity with the website.
 */
export function buildFieldAttributes(field: FieldSpec): string[] {
  const attrs = field.attrs;
  const result: string[] = [];

  // #[db(...)]
  const dbParts: string[] = [];
  if (attrs.primaryKey) dbParts.push("primary_key");
  if (attrs.indexed) dbParts.push("indexed");
  if (attrs.unique) dbParts.push("unique");
  if (dbParts.length > 0) result.push(`#[db(${dbParts.join(", ")})]`);

  // #[lifecycle(...)]
  const lcParts: string[] = [];
  if (attrs.immutable) lcParts.push("immutable");
  if (attrs.audited) lcParts.push("audited");
  if (attrs.autoTimestamp) lcParts.push("auto_timestamp");
  if (attrs.versioned) lcParts.push(`versioned = ${attrs.versionedN}`);
  if (lcParts.length > 0) result.push(`#[lifecycle(${lcParts.join(", ")})]`);

  // #[http(...)]
  const httpParts: string[] = [];
  if (attrs.expose) httpParts.push("expose");
  if (attrs.validate) httpParts.push(`validate = "${attrs.validate}"`);
  if (httpParts.length > 0) result.push(`#[http(${httpParts.join(", ")})]`);

  // #[persistence(...)]
  const persParts: string[] = [];
  if (attrs.replicate) persParts.push("replicate");
  if (attrs.trackHistory) persParts.push("track_history");
  if (persParts.length > 0) result.push(`#[persistence(${persParts.join(", ")})]`);

  return result;
}

/**
 * Generate compilable Lithair Rust source from a spec.
 *
 * Faithful port of `generateCode(s)` (playground :807-1026).
 */
export function generate(s: LithairSpec): string {
  const lines: string[] = [];
  const f = s.features;

  // A FirewallConfig is emitted when EITHER the firewall toggle OR the
  // rate-limit toggle is on — rate limiting lives inside FirewallConfig
  // (global_qps / per_ip_qps); there is no standalone rate-limit builder.
  const wantFirewall = f.firewall.enabled || f.rateLimit.enabled;
  // Sessions are needed for RBAC, route guards, and the require-session gate.
  const wantSessions = f.auth.enabled || f.routeGuard.enabled;

  // Use statements — no prelude exists; import exactly what is used.
  // `lithair_core::DeclarativeModel` is valid: lithair-core re-exports the
  // derive macro (lithair-core/src/lib.rs:125).
  lines.push("use lithair_core::app::LithairServer;");
  lines.push("use lithair_core::DeclarativeModel;");
  lines.push("use serde::{Deserialize, Serialize};");
  if (f.auth.enabled)
    lines.push("use lithair_core::rbac::{RbacUser, ServerRbacConfig};");
  if (f.mfa.enabled) lines.push("use lithair_core::mfa::MfaConfig;");
  if (f.routeGuard.enabled) lines.push("use lithair_core::http::RouteGuard;");
  if (wantFirewall) lines.push("use lithair_core::http::FirewallConfig;");
  if (wantSessions) {
    lines.push(
      "use lithair_core::session::{PersistentSessionStore, SessionManager};"
    );
    lines.push("use std::path::PathBuf;");
    lines.push("use std::sync::Arc;");
  }
  if (wantFirewall) lines.push("use std::collections::HashSet;");
  lines.push("");

  // Env vars comment block (if any env-based config).
  const envVars: string[] = [];
  if (f.staticFiles.enabled) {
    if (f.staticFiles.maxMemoryMb !== 100)
      envVars.push(`// CACHE_MAX_MEMORY_MB=${f.staticFiles.maxMemoryMb}`);
    if (f.staticFiles.maxFileSizeMb !== 10)
      envVars.push(`// CACHE_MAX_FILE_SIZE_MB=${f.staticFiles.maxFileSizeMb}`);
    if (f.staticFiles.hotReload) envVars.push("// CACHE_ENABLE_HOT_RELOAD=1");
    if (f.staticFiles.compression) {
      envVars.push("// CACHE_ENABLE_COMPRESSION=1");
      if (f.staticFiles.compressionThresholdKb !== 50)
        envVars.push(
          `// CACHE_COMPRESSION_THRESHOLD_KB=${f.staticFiles.compressionThresholdKb}`
        );
    }
  }
  if (f.mfa.enabled && f.mfa.devBypass)
    envVars.push("// LITHAIR_DEV=1  (bypasses MFA enforcement)");
  if (envVars.length > 0) {
    lines.push("// Environment variables:");
    envVars.forEach((v) => lines.push(v));
    lines.push("");
  }

  // Models.
  s.models.forEach((model) => {
    lines.push("#[derive(Debug, Clone, Serialize, Deserialize, DeclarativeModel)]");
    lines.push(`struct ${model.name} {`);
    model.fields.forEach((field) => {
      const attrLines = buildFieldAttributes(field);
      attrLines.forEach((a) => lines.push(`    ${a}`));
      lines.push(`    ${field.name}: ${field.type},`);
    });
    lines.push("}");
    lines.push("");
  });

  // RBAC config function — returns the real ServerRbacConfig.
  if (f.auth.enabled && f.auth.roles.length > 0) {
    lines.push("fn rbac_config() -> ServerRbacConfig {");
    lines.push("    ServerRbacConfig::new()");
    lines.push("        .with_roles(vec![");
    f.auth.roles.forEach((role) => {
      const permsStr = role.perms.map((p) => `"${p}".to_string()`).join(", ");
      lines.push(`            ("${role.name}".to_string(), vec![${permsStr}]),`);
    });
    lines.push("        ])");
    lines.push("        // Define your users here (username, password, role).");
    lines.push("        // Replace these demo credentials before deploying.");
    lines.push("        .with_users(vec![");
    const firstRole = f.auth.roles[0].name;
    lines.push(`            RbacUser::new("admin", "changeme", "${firstRole}"),`);
    lines.push("        ])");
    lines.push(`        .with_session_store("${f.auth.sessionStorePath}")`);
    lines.push(`        .with_session_duration(${f.auth.sessionMaxAgeSecs})`);
    lines.push("}");
    lines.push("");
  }

  // Firewall config function — also carries rate-limit QPS.
  if (wantFirewall) {
    lines.push("fn firewall_config() -> FirewallConfig {");
    lines.push("    FirewallConfig {");
    lines.push("        enabled: true,");
    const allowIps =
      f.firewall.enabled && f.firewall.allowIps
        ? f.firewall.allowIps.split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    if (allowIps.length > 0) {
      const ips = allowIps.map((x) => `"${x}".to_string()`).join(", ");
      lines.push(`        allow: HashSet::from([${ips}]),`);
    } else {
      lines.push("        allow: HashSet::new(),");
    }
    const denyIps =
      f.firewall.enabled && f.firewall.denyIps
        ? f.firewall.denyIps.split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    if (denyIps.length > 0) {
      const ips = denyIps.map((x) => `"${x}".to_string()`).join(", ");
      lines.push(`        deny: HashSet::from([${ips}]),`);
    } else {
      lines.push("        deny: HashSet::new(),");
    }
    if (f.rateLimit.enabled) {
      lines.push(`        global_qps: Some(${f.rateLimit.globalQps}),`);
      lines.push(`        per_ip_qps: Some(${f.rateLimit.perIpQps}),`);
    } else {
      lines.push("        global_qps: None,");
      lines.push("        per_ip_qps: None,");
    }
    if (f.firewall.enabled && f.firewall.protectedPrefixes) {
      const prefixes = f.firewall.protectedPrefixes
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => `"${x}".to_string()`)
        .join(", ");
      lines.push(`        protected_prefixes: vec![${prefixes}],`);
    } else {
      lines.push("        protected_prefixes: vec![],");
    }
    lines.push("        exempt_prefixes: vec![],");
    lines.push("    }");
    lines.push("}");
    lines.push("");
  }

  // Main — async, returns anyhow::Result<()>, ends in .serve().await
  lines.push("#[tokio::main]");
  lines.push("async fn main() -> anyhow::Result<()> {");

  // Session store (needed for RBAC / route guards / require-session gate).
  if (wantSessions) {
    lines.push(
      `    let session_store = Arc::new(PersistentSessionStore::new(PathBuf::from("${f.auth.sessionStorePath}"))?);`
    );
    lines.push(
      "    let session_manager = SessionManager::from_arc(session_store.clone());"
    );
    lines.push("");
  }

  lines.push("    LithairServer::new()");
  lines.push(`        .with_port(${s.port})`);

  // Sessions.
  if (wantSessions) {
    lines.push("        .with_sessions(session_manager)");
    if (f.auth.enabled) {
      lines.push("        .with_models_require_session(true)");
    }
  }

  // Static files.
  if (f.staticFiles.enabled) {
    lines.push(
      `        .with_frontend_at("${f.staticFiles.mountPath}", "${f.staticFiles.dir}")`
    );
  }

  // Models — with_model::<T>(data_path, route_base), both derived from name.
  s.models.forEach((model) => {
    const slug = modelSlug(model.name);
    lines.push(
      `        .with_model::<${model.name}>("${s.dataDir}/${slug}", "/api/${slug}")`
    );
  });

  // Auth (RBAC).
  if (f.auth.enabled && f.auth.roles.length > 0) {
    lines.push("        .with_rbac_config(rbac_config())");
  }

  // MFA.
  if (f.mfa.enabled) {
    const reqStr = f.mfa.required.map((r) => `"${r}".to_string()`).join(", ");
    const optStr = f.mfa.optional.map((r) => `"${r}".to_string()`).join(", ");
    lines.push("        .with_mfa_totp(MfaConfig {");
    lines.push(`            issuer: "${f.mfa.issuer}".to_string(),`);
    lines.push(`            enforce_for_roles: vec![${reqStr}],`);
    lines.push(`            optional_for_roles: vec![${optStr}],`);
    lines.push("            ..Default::default()");
    lines.push("        })");
  }

  // Firewall + rate limiting (single FirewallConfig carries both).
  if (wantFirewall) {
    lines.push("        .with_firewall_config(firewall_config())");
  }

  // Route guard — RouteGuard::RequireAuth gates a path prefix.
  if (f.routeGuard.enabled) {
    const excludeList = f.routeGuard.exclude
      ? f.routeGuard.exclude
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => `"${x}".to_string()`)
          .join(", ")
      : "";
    lines.push(
      `        .with_route_guard("${f.routeGuard.prefix}/*", RouteGuard::RequireAuth {`
    );
    lines.push(`            redirect_to: Some("${f.routeGuard.redirect}".to_string()),`);
    lines.push(`            exclude: vec![${excludeList}],`);
    lines.push("        })");
  }

  // Admin panel.
  if (f.adminPanel.enabled) {
    lines.push("        .with_admin_panel(true)");
    lines.push("        .with_data_admin()");
    lines.push(`        .with_data_admin_ui("${f.adminPanel.uiPath}")`);

    if (
      !f.adminPanel.enableStatus ||
      !f.adminPanel.enableHealth ||
      !f.adminPanel.enableInfo ||
      f.adminPanel.firewallEnabled
    ) {
      lines.push(
        "        // Note: ops endpoints (/status, /health, /info) are always enabled"
      );
      lines.push(
        "        //       and not individually toggleable. For admin IP"
      );
      lines.push("        //       allow-listing, enable the Firewall feature with a");
      lines.push(`        //       protected prefix of "${f.adminPanel.adminPath}".`);
    }
  }

  lines.push("        .serve()");
  lines.push("        .await");
  lines.push("}");

  return lines.join("\n");
}

/*
 * CORRECTIONS vs the playground / the vscode-extension proposal, found by
 * re-reading lithair @ v0.13.0 source (verify-before-encoding pass):
 *
 * 1. `auto_timestamp` (emitted by buildFieldAttributes for
 *    `#[lifecycle(auto_timestamp)]`) is NOT parsed by the v0.13
 *    `parse_lifecycle_attributes` (declarative_simple.rs:430-453, which only
 *    handles immutable/audited/snapshot_only/versioned/retention). It is inert,
 *    not a compile error. Kept for byte-parity with the website; flagged here.
 *
 * 2. `#[retention(...)]` is a STRUCT-LEVEL attribute, not a field attribute —
 *    `parse_model_retention` (declarative_simple.rs:284-318) iterates
 *    `input.attrs`. The proposal's snippet list grouped it with field
 *    attributes; the snippet in the extension places it correctly at struct
 *    level. The generator does not emit it (the playground never did).
 *
 * 3. All builder methods the generator emits (`with_port`, `with_model`,
 *    `with_sessions`, `with_models_require_session`, `with_frontend_at`,
 *    `with_rbac_config`, `with_mfa_totp`, `with_firewall_config`,
 *    `with_route_guard`, `with_admin_panel`, `with_data_admin`,
 *    `with_data_admin_ui`, `serve`) were confirmed present in
 *    lithair-core/src/app/builder.rs @ v0.13.0. The playground's "v0.12"
 *    comments are stale labels; the emitted surface still compiles against
 *    v0.13. No method-name drift was found in the generated builder chain.
 */
