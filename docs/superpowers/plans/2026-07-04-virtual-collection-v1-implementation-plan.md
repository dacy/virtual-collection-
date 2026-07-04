# Virtual Collection Display — v1 Implementation Plan

**Date:** 2026-07-04
**Spec:** [2026-06-11-virtual-collection-display-design.md](../specs/2026-06-11-virtual-collection-display-design.md)
**Status:** Draft for review

Phases are sequential; each has an exit criterion that must hold before the
next begins. Phase 1 (Milestone 0) is the hard gate: if the performance proof
fails even with mitigations, we stop and rethink scope before writing feature
code.

## Phase 0 — Scaffold

Project skeleton and the guarantees that must exist from the first commit.

- Vite + React + TypeScript app; React Three Fiber, drei, Zustand, three;
  Vitest + fake-indexeddb for tests; ESLint + Prettier.
- Directory skeleton per spec: `src/engine/`, `src/importer/`, `src/store/`,
  `src/persistence/`, `src/ui/`. Add an ESLint `no-restricted-imports` rule
  set enforcing the module boundaries (engine may not import persistence,
  etc.) so the architecture is checked mechanically, not by convention.
- CSP `<meta http-equiv="Content-Security-Policy" content="... connect-src
  'self' ...">` in `index.html` from day one.
- Decoder binaries (Draco, KTX2/Basis transcoder, meshopt) vendored into
  `public/decoders/` and loaders configured to use them; a unit test asserts
  no loader is configured with a remote decoder path.
- GitHub Actions CI: typecheck, lint, test, build.

**Exit:** `npm run dev` shows an empty R3F scene; CI green; boundary lint
rule demonstrably fails on a forbidden import.

## Phase 1 — Milestone 0: populated-room performance proof (GATE)

Throwaway-quality but real-rendering spike, per spec.

- **Placeholder room:** a simple box-room GLB with baked-look lighting
  (an HDR environment + lightmap-style textures is enough for the spike) and
  20 hardcoded slot transforms.
- **Stress assets:** ~20 heavy CC0 photogrammetry scans (100k–500k tris, 2–4k
  textures). Assets are NOT committed — `scripts/fetch-spike-assets.ts`
  downloads them (Smithsonian 3D, Sketchfab CC0, Three.js example assets)
  into a gitignored `spike-assets/` dir, with a checked-in manifest of URLs
  and licenses.
- **Walk controller:** pointer-lock mouse-look + WASD, capsule vs. room AABB
  collision, tuned near clip (~0.05m) to preview the close-viewing feel.
- **Piece lighting as v1 will do it:** environment-map IBL on pieces + fake
  contact shadow quad under each; no realtime shadow maps.
- **Instrumentation:** overlay showing FPS (avg + 1% low), draw calls,
  triangles, and estimated texture VRAM from `renderer.info`; a `?debug`
  query flag keeps this available forever after.
- **Measurement:** run on the two reference devices (to be nominated — the
  user's own laptop and phone are the natural choices) via LAN dev server.
- **If it misses budget,** apply mitigations in spec order — meshoptimizer
  decimation, texture downscale/KTX2, per-piece budgets — re-measuring after
  each, and record which ones v1 must therefore include.

**Exit:** sustained 60 fps desktop / 30 fps phone walking the full room;
findings written to `docs/superpowers/specs/milestone-0-findings.md`
(measured numbers, calibrated scene budgets, mandatory mitigations). Spec's
budget numbers updated to the calibrated ones.

## Phase 2 — Domain model, store, persistence

- `src/store/types.ts`: `Piece`, `SpaceTemplate`, `Slot`, `Space`,
  `Placement` exactly per spec data model.
- Zustand store with actions (create/rename/delete space, add/update/delete
  piece, place/clear slot, update placement transform). Piece deletion
  returns affected spaces for the confirm-dialog; confirmed delete clears
  those placements atomically.
- `src/persistence/` interface (`loadAll`, `savePiece`, `saveSpace`, delete
  ops, blob get/put) + IndexedDB adapter (via `idb`); store subscribes and
  persists incrementally, debounced.
- Durable-storage layer: request `navigator.storage.persist()` on first
  write; expose `storage.estimate()` usage for the UI; track
  last-backup timestamp for backup prompts.
- Tests: store logic units; persistence round-trips against fake-indexeddb;
  blob round-trip with real `Blob`s.

**Exit:** headless tests prove a space + pieces survive a store reload
through the adapter; no UI yet.

## Phase 3 — Import pipeline

- `src/importer/`: format detection by extension + magic bytes; loaders
  (GLTFLoader, FBXLoader, OBJLoader+MTLLoader, STLLoader) run in a worker
  where possible to keep the UI responsive.
- Normalization: merge geometry, center on origin at floor level (min-Y = 0),
  compute bounding box; capture tri/texture stats for budget warnings.
- STL material picker (bronze / resin gray / ceramic white presets).
- GLTFExporter → GLB blob; offscreen thumbnail render (fixed camera framing
  the bbox, transparent background, ~512px PNG).
- Error taxonomy per spec, including the ASCII/pre-7.0 FBX message; import is
  transactional — nothing is written to the library until every step
  succeeds.
- Tests: normalization math (centering, bbox, fit-to-slot scale factor) with
  synthetic geometries; GLB round-trip (import → export → re-import) sanity;
  each error path.

**Exit:** dropping each of the four formats onto a bare test page yields a
stored, thumbnailed library piece; corrupt/oversized files produce the
specified errors and leave the library untouched.

## Phase 4 — The Gallery template + slot system

- Author (Blender) or adapt a licensed gallery room: baked lightmaps, KTX2
  textures, Draco/meshopt compression; 12–20 named empties
  (`slot_<type>_<nn>` with fit-box dimensions in custom properties).
- Slot parser: walk the GLB scene graph, extract slot id/type/transform/
  fit-box; template registry maps `templateId → room URL` (bundled asset).
- Placement rendering: piece GLB instantiated at slot transform, fit-to-slot
  scale from stored bbox vs. fit-box, plus per-placement rotationY /
  scaleAdjust / offsetY; contact shadow from Phase 1.
- Tests: slot parsing from a fixture GLB; fit-to-slot math edge cases (flat
  wall pieces, tall thin pieces).

**Exit:** the real Gallery room renders inside the Phase 1 walk controller at
Milestone 0 framerates (re-run the meter), with pieces placeable via a debug
console call.

## Phase 5 — Edit mode UI

- Home screen: space list (thumbnail, name), create-from-template (single
  template), rename/delete; storage usage meter + backup-reminder banner.
- Edit mode: empty slots glow; click slot → side panel with library grid +
  drop zone; placed piece gets rotate/scale/offset controls and metadata
  form; library management (delete piece with affected-spaces warning).
- Import UX: drag-anywhere drop target, progress state while the worker
  parses, STL material picker modal, error toasts.

**Exit:** the full creating loop from the spec's Experience section works
end-to-end by hand, persisted across a browser restart.

## Phase 6 — View mode polish

- Walk mode: Phase 1 controller hardened — collision vs. room + display
  furniture, eye-height tuning, walk speed, touch virtual joystick +
  look-drag.
- Inspect mode: click piece → camera glide to framing position → orbit/zoom
  (clamped), info card (title/description/credit), Esc/back-out glide.
- Edit ↔ view toggle; view-only flag (for imported bundles) hides edit UI.

**Exit:** manual walkthrough checklist from the spec's Testing section passes
on desktop and phone.

## Phase 7 — Bundle export/import

- `.gallery` = zip via zip.js **streams**: `manifest.json` (schemaVersion 1,
  space + placements + piece metadata) + `pieces/<id>.glb` +
  `thumbs/<id>.png`.
- Export streams from IndexedDB blobs to a `WritableStream` download;
  import streams entries → validates manifest version → stages pieces →
  commits atomically; opens in view-only mode with "save a local copy".
- Tests: manifest round-trip; forward-compat (unknown fields preserved,
  newer major version → clear error); large-bundle smoke test (~1 GB
  synthetic) on desktop and phone without OOM.

**Exit:** export from one browser profile, import in a fresh profile,
identical walkable space; memory stays flat during both.

## Phase 8 — Offline, release, hardening

- PWA: manifest + service worker precaching the app shell, decoders, and
  Gallery assets; update flow (new SW → toast → reload).
- Release zip artifact (CI job) runnable via any static server; README
  section documenting both offline modes.
- Final gates, all on reference devices: Milestone 0 perf re-run in the real
  Gallery fully populated; privacy check (DevTools zero-network after load,
  then fully offline session); storage-eviction UX check (quota display,
  backup prompt, persist() granted); full manual checklist.

**Exit:** v1 done per spec; findings/budgets docs updated to final numbers.

## Cross-cutting rules

- TDD where the logic is testable (importer math, store, persistence,
  bundle); manual checklists where it's feel (walking, inspect, close-up).
- Every phase lands as small commits on this branch; CI stays green
  throughout.
- The `?debug` perf overlay is checked whenever a phase touches the scene;
  any budget regression blocks the phase's exit.
- No new runtime dependency without checking its size and that it works
  offline (no CDN callbacks).

## Risks & contingencies

- **Milestone 0 fails outright** even with all mitigations → stop; options
  are lowering slot count, capping per-piece budgets harder, or dropping the
  phone target to "view-only lite mode". Decision returns to the user.
- **FBX loader gaps** worse than expected → keep the promise via clearer
  guided errors (re-export instructions), not by adding a server-side
  converter.
- **Gallery room art** is the longest-lead non-code item → start sourcing/
  authoring in parallel from Phase 2; the Phase 1 placeholder room keeps
  development unblocked.
- **Safari quirks** (IndexedDB blobs, storage eviction, pointer lock) →
  Safari is a first-class manual-test target from Phase 2 onward, not a
  release-week discovery.
