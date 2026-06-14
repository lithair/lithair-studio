/**
 * @lithair-studio/harness (Layer 2)
 *
 * Re-exports the oracle surface. The `check` stage (spec → generate() → temp
 * Cargo project → `cargo check`) is implemented; boot + HTTP CRUD + invariants
 * are still sketched. See oracle.ts and README.md.
 */

export * from "./oracle";
