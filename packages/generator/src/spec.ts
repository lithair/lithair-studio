/**
 * Lithair site specification model.
 *
 * This is a faithful port of the `state` object held by the website playground
 * (`lithair-website/frontend/src/pages/playground.astro`, lines 387-402). The
 * field names here are kept close to the playground's so the two stay easy to
 * diff. The generator in `generate.ts` consumes a {@link LithairSpec} and emits
 * Rust source; it is the single place that knows how the spec maps to the
 * `LithairServer` builder chain and the `DeclarativeModel` derive attributes.
 *
 * Verified against lithair @ v0.13.0:
 * - Field attribute tokens come from `lithair-macros/src/declarative_simple.rs`.
 * - Builder methods come from `lithair-core/src/app/builder.rs`.
 */

/** Field types the playground offers in its type dropdown (`FIELD_TYPES`, :402). */
export const FIELD_TYPES = [
  "String",
  "bool",
  "u32",
  "u64",
  "f64",
  "Uuid",
  "DateTime",
  "Vec<String>",
  "Option<String>",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number] | string;

/**
 * Per-field attribute toggles.
 *
 * Each toggle maps to a `DeclarativeModel` derive helper attribute. The mapping
 * (and which derive group each belongs to) is encoded in
 * `buildFieldAttributes` and is faithful to the playground's `attrDefs` list
 * (playground.astro :660-670) and `buildFieldAttributes` (:1028-1060).
 *
 * NOTE on `autoTimestamp`: the playground emits `#[lifecycle(auto_timestamp)]`
 * but the v0.13 parser (`parse_lifecycle_attributes`, declarative_simple.rs
 * :430-453) does NOT recognize `auto_timestamp` — it parses only `immutable`,
 * `audited`, `snapshot_only`, `versioned`, and `retention`. The token is
 * therefore inert (silently ignored), not a compile error. We keep emitting it
 * to stay byte-for-byte faithful to the website, and flag the discrepancy here.
 */
export interface FieldAttributes {
  /** `#[db(primary_key)]` — parser: declarative_simple.rs:397 */
  primaryKey: boolean;
  /** `#[db(indexed)]` — parser: declarative_simple.rs:399 */
  indexed: boolean;
  /** `#[db(unique)]` — parser: declarative_simple.rs:398 */
  unique: boolean;
  /** `#[lifecycle(immutable)]` — parser: declarative_simple.rs:436 */
  immutable: boolean;
  /** `#[lifecycle(audited)]` — parser: declarative_simple.rs:437 */
  audited: boolean;
  /** `#[lifecycle(auto_timestamp)]` — inert in v0.13 (see note above). */
  autoTimestamp: boolean;
  /** `#[lifecycle(versioned = N)]` — parser: declarative_simple.rs:439 */
  versioned: boolean;
  /** N value for `versioned = N` */
  versionedN: number;
  /** `#[http(expose)]` — parser: declarative_simple.rs:491 */
  expose: boolean;
  /** `#[http(validate = "...")]` rule string — parser: declarative_simple.rs:495 */
  validate: string;
  /** `#[persistence(replicate)]` — parser: declarative_simple.rs:547 */
  replicate: boolean;
  /** `#[persistence(track_history)]` — parser: declarative_simple.rs:548 */
  trackHistory: boolean;
}

export function defaultFieldAttributes(): FieldAttributes {
  return {
    primaryKey: false,
    indexed: false,
    unique: false,
    immutable: false,
    audited: false,
    autoTimestamp: false,
    versioned: false,
    versionedN: 3,
    expose: false,
    validate: "",
    replicate: false,
    trackHistory: false,
  };
}

export interface FieldSpec {
  name: string;
  type: FieldType;
  attrs: FieldAttributes;
}

export interface ModelSpec {
  name: string;
  fields: FieldSpec[];
}

export interface RoleSpec {
  name: string;
  perms: string[];
}

export interface StaticFilesFeature {
  enabled: boolean;
  mountPath: string;
  dir: string;
  maxMemoryMb: number;
  maxFileSizeMb: number;
  hotReload: boolean;
  compression: boolean;
  compressionThresholdKb: number;
}

export interface AuthFeature {
  enabled: boolean;
  roles: RoleSpec[];
  sessionStorePath: string;
  sessionMaxAgeSecs: number;
}

export interface MfaFeature {
  enabled: boolean;
  issuer: string;
  required: string[];
  optional: string[];
  devBypass: boolean;
}

export interface RateLimitFeature {
  enabled: boolean;
  globalQps: number;
  perIpQps: number;
}

export interface FirewallFeature {
  enabled: boolean;
  allowIps: string;
  denyIps: string;
  protectedPrefixes: string;
}

export interface RouteGuardFeature {
  enabled: boolean;
  prefix: string;
  redirect: string;
  sessionCookie: string;
  exclude: string;
}

export interface AdminPanelFeature {
  enabled: boolean;
  adminPath: string;
  uiPath: string;
  enableStatus: boolean;
  enableHealth: boolean;
  enableInfo: boolean;
  firewallEnabled: boolean;
  firewallAllowIps: string;
}

export interface Features {
  staticFiles: StaticFilesFeature;
  auth: AuthFeature;
  mfa: MfaFeature;
  rateLimit: RateLimitFeature;
  firewall: FirewallFeature;
  routeGuard: RouteGuardFeature;
  adminPanel: AdminPanelFeature;
}

export interface LithairSpec {
  features: Features;
  models: ModelSpec[];
  port: number;
  dataDir: string;
}

/**
 * A blank spec matching the playground's initial `state` (playground.astro
 * :387-400). Useful as a starting point for callers (the webview, the harness).
 */
export function defaultSpec(): LithairSpec {
  return {
    features: {
      staticFiles: {
        enabled: false,
        mountPath: "/",
        dir: "./public",
        maxMemoryMb: 100,
        maxFileSizeMb: 10,
        hotReload: false,
        compression: false,
        compressionThresholdKb: 50,
      },
      auth: {
        enabled: false,
        roles: [
          { name: "Admin", perms: ["*"] },
          { name: "Editor", perms: ["ArticleRead", "ArticleWrite"] },
          { name: "Viewer", perms: ["ArticleRead"] },
        ],
        sessionStorePath: "./data/sessions",
        sessionMaxAgeSecs: 28800,
      },
      mfa: {
        enabled: false,
        issuer: "My App",
        required: ["Admin"],
        optional: [],
        devBypass: false,
      },
      rateLimit: { enabled: false, globalQps: 1000, perIpQps: 50 },
      firewall: {
        enabled: false,
        allowIps: "",
        denyIps: "",
        protectedPrefixes: "/admin",
      },
      routeGuard: {
        enabled: false,
        prefix: "/admin",
        redirect: "/admin/login",
        sessionCookie: "lithair_session",
        exclude: "",
      },
      adminPanel: {
        enabled: false,
        adminPath: "/admin",
        uiPath: "/_data",
        enableStatus: true,
        enableHealth: true,
        enableInfo: true,
        firewallEnabled: false,
        firewallAllowIps: "loopback,internal,private_v4",
      },
    },
    models: [],
    port: 3007,
    dataDir: "./data",
  };
}
