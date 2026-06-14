# @lithair-studio/generator

Pure TypeScript core shared by the VS Code extension and the test harness.
Turns a Lithair site spec into compilable Lithair Rust.

```ts
import { generate, defaultSpec } from "@lithair-studio/generator";

const spec = defaultSpec();
spec.models.push({
  name: "Article",
  fields: [
    { name: "id", type: "String", attrs: { /* ...primaryKey, unique, immutable, expose... */ } },
    { name: "title", type: "String", attrs: { /* ...expose, validate: "non_empty"... */ } },
  ],
});

const rust = generate(spec); // -> compilable LithairServer source
```

- `generate(spec): string` — spec → Rust source. Pure, deterministic, no I/O.
- `buildFieldAttributes(field): string[]` — the `#[db]/#[lifecycle]/#[http]/#[persistence]` lines for one field.
- `modelSlug(name): string` — pluralized data-path/route slug.
- `defaultSpec()`, `defaultFieldAttributes()` — starting points.
- Spec types: `LithairSpec`, `ModelSpec`, `FieldSpec`, `FieldAttributes`, `Features`, etc.

Ported faithfully from the website playground's `generateCode`, then verified
against lithair @ v0.13.0 source. Corrections found during that pass are
documented inline in `src/generate.ts` and in `../../docs/architecture.md`.

## Build & test

```bash
npm run build   # tsc -> dist/
npm test        # tsc + node:test unit tests
```
