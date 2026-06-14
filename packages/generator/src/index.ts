/**
 * @lithair-studio/generator
 *
 * Pure core shared by the VS Code extension and the test harness. Turns a
 * {@link LithairSpec} into compilable Lithair Rust source via {@link generate}.
 */

export * from "./spec";
export { generate, buildFieldAttributes, modelSlug } from "./generate";
