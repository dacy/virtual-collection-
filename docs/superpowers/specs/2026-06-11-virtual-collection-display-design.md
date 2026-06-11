# Virtual Collection Display — v1 Design

**Date:** 2026-06-11
**Status:** Approved pending final review

## Vision

A web app for displaying 3D models in realistic, walkable virtual spaces. The
first audience is collectors (figures and toys) showing off their collections,
but the design is deliberately general-purpose (通用): a "piece" is any 3D
model with a story, so 3D artists can use the same app to present their work.
Future phases add hosted sharing, social visits, and selling; v1 is the core
display experience.

## v1 Scope

A single-user, fully client-side web app:

- One polished space template, **The Gallery**: a modern museum room with
  12-20 display slots (shelves, glass cabinets, pedestals, wall positions).
- Drag-and-drop import of FBX, OBJ (+MTL), STL, and GLB/glTF files directly in
  the browser. No external conversion step, ever.
- Slot-based placement: click a slot, choose or drop a piece, it snaps in
  auto-centered and auto-scaled, with manual rotate / scale / offset tweaks
  and editable title, description, and credit.
- First-person walk-through viewing. Walking close is the primary way to
  examine a piece; click-to-inspect (orbit camera + info card) complements it.
- Everything persists locally in the browser (IndexedDB). Sharing is a
  self-contained exported bundle file that anyone can open in the same app.
- **Local-first guarantee:** model files never leave the device. There is no
  upload, no backend, and no network traffic after the app loads (see
  *Local-First & Privacy*).
- **Performance proof first:** the very first milestone is a stress-test of a
  fully populated room against explicit framerate budgets, so the core risk
  is retired before feature work begins (see *Performance*).

**Explicitly out of v1:** accounts, hosting/publish-to-URL, social features,
selling/marketplace, AI photo-to-3D, VR/WebXR, additional space templates,
native mobile apps.

## Experience

**Creating.** The home screen lists your spaces and a template picker (one
template in v1). In edit mode, empty slots glow softly. Clicking a slot opens
a panel to pick a piece from the library or drop a new file. The piece snaps
into the slot fitted to its fit-box; the user can rotate it, nudge scale,
adjust vertical offset, and edit its metadata. Imported pieces live in a
library and can be reused across slots and spaces.

**Visiting.** View mode is a first-person walk: WASD + mouse-look on desktop,
virtual joystick on touch devices. The user can walk right up to any piece and
examine it from inches away — near clip plane and collision are tuned so close
viewing never clips or blocks awkwardly, and display heights favor natural
eye-level viewing. Clicking a piece glides the camera into inspect mode:
orbit, zoom, and an info card showing title, description, and credit.

**Sharing.** "Export" downloads a single `.gallery` bundle file. A recipient
opens the app URL, drops the file in, and walks the space in view-only mode,
with the option to save a local copy.

## Local-First & Privacy

"Web app" here means only that the browser is the runtime — it does **not**
mean files are uploaded anywhere. The app is a bundle of static HTML/JS/CSS;
once loaded, everything runs on the user's machine:

- **Import is local.** A dropped file is read with the browser File API
  straight into the page's memory, parsed and rendered there. There is no
  upload endpoint and no server to receive anything — large files cost zero
  bandwidth and private models are never exposed in transit or at rest on a
  third party.
- **Storage is local.** Pieces are stored as blobs in IndexedDB, which lives
  on the user's own disk, sandboxed per browser profile.
- **Sharing is explicit only.** The `.gallery` export is a plain file
  download; nothing is shared unless the user hands that file to someone.
- **Enforced, not just promised.** The app ships a Content-Security-Policy of
  `connect-src 'self'`, so the browser itself blocks any request to another
  origin. Anyone can verify in DevTools' Network tab that zero requests are
  made after page load. No telemetry or analytics in v1.
- **Runs fully offline.** Two supported modes: (a) open the hosted URL once
  and the app installs as a PWA with all assets cached, after which it works
  with the network cable unplugged; (b) download a release zip and serve it
  locally (`npx serve` or any static file server) — no internet required at
  all. Either way the app is equally functional, because there is no backend
  to talk to.

When hosted sharing arrives in v2+, it is opt-in per space via the separate
cloud persistence adapter; the local-only path remains the default.

## Architecture

React + TypeScript + Vite. 3D via React Three Fiber (Three.js) with drei
helpers. State via Zustand. Deployed as a static site (no backend).

| Module | Purpose |
|---|---|
| `engine/` | Scene rendering: space, slots, pieces, lighting, walk controller, inspect camera |
| `importer/` | Dropped file → normalized geometry → stored GLB + thumbnail |
| `store/` | Domain state: spaces, pieces, placements (Zustand) |
| `persistence/` | IndexedDB adapter and bundle export/import, behind an interface |
| `ui/` | React panels: library, slot editor, info cards, HUD, home screen |

Module boundaries are strict: `engine/` never touches storage; `ui/` and
`engine/` reach data only through `store/`; `store/` persists only through the
`persistence/` interface. In v2+, a cloud adapter implements the same
persistence interface to enable hosted sharing without changes to the engine
or UI.

## Data Model

- **Piece** — `id, title, description, credit, sourceFormat, model (GLB
  blob), thumbnail (image blob)`. Generic by design; nothing
  collector-specific.
- **SpaceTemplate** — `id, room GLB, slots[]`. Slots are authored inside the
  room model as named empties (e.g. `slot_pedestal_01`) and parsed at load
  time, so new templates are pure content with no code changes.
- **Slot** — `id, type (shelf | cabinet | pedestal | wall), transform,
  fit-box dimensions`.
- **Space** — `id, name, templateId, placements: slotId → { pieceId,
  rotationY, scaleAdjust, offsetY }`. Placement transforms are
  non-destructive; the stored model is never modified.
- **Bundle file** — a zip containing a versioned `manifest.json` (space +
  piece metadata), model blobs, and thumbnails. The schema version field
  enables forward-compatible import.

## Import Pipeline

1. Parse the dropped file with the matching Three.js loader (GLTFLoader,
   FBXLoader, OBJLoader+MTLLoader, STLLoader).
2. Merge and center geometry; compute the bounding box.
3. STL only: prompt for a preset material (e.g. bronze, resin gray, ceramic
   white), since STL carries no color.
4. Export once to GLB (GLTFExporter) and store the blob in IndexedDB; render
   a thumbnail offscreen.
5. Fit-to-slot scaling happens at placement time from the stored bounding
   box and the slot's fit-box.

**Error handling:** unsupported format → clear message listing supported
types; corrupt file → error toast with detail; missing textures (OBJ/FBX) →
load untextured with a warning; very large file (> ~50 MB) → warn before
import. Failures never corrupt the library.

## The Gallery (v1 content)

Built in Blender or adapted from a licensed asset: one room with baked
lighting and an environment map for realistic look at web framerates. Slot
mix targets both collectors and artists: shelves and cabinets for figures,
pedestals for sculpture, several wall positions for flat work. The room ships
Draco/meshopt-compressed with KTX2 textures.

## Performance

### Milestone 0: populated-room proof (gates everything else)

The riskiest assumption in this project is that a browser can smoothly render
a realistic room filled with 20 user-supplied models. v1 work therefore
**starts** with a throwaway-quality but real-rendering spike, before any
import UI, persistence, or editing exists:

- A placeholder gallery room (baked lighting, compressed textures) with all
  20 slots filled with deliberately heavy free models (photogrammetry scans,
  ~100k–500k triangles each, 2k–4k textures) loaded from disk.
- First-person walk controller and an on-screen FPS/draw-call/VRAM meter.
- Measured on the two reference devices below.

**Pass criteria:** sustained 60 fps on a mid-range laptop with integrated
graphics, and 30 fps on a 2–3 year old mid-range phone, while walking the
fully populated room.

If the naive approach misses budget, mitigations are pulled from v1.1 into v1
in this order until it passes: import-time mesh decimation (meshoptimizer),
import-time texture downscaling/KTX2 compression, per-piece triangle/texture
budgets enforced at import. The spike's findings set the concrete numbers
below.

### Budgets and techniques

- **Scene budget (initial, to be calibrated by Milestone 0):** ≤ 3M total
  triangles, ≤ 250 draw calls, ≤ 500 MB GPU texture memory with all slots
  filled.
- Room: Draco/meshopt-compressed geometry, KTX2 textures, baked lighting (no
  expensive realtime shadows).
- Pieces: stored as GLB; import shows the piece's triangle/texture stats and
  warns when a file pushes the scene over budget, with worst cases bounded by
  the per-file size warning.
- The FPS meter from the spike survives as a hidden debug overlay so
  regressions are visible throughout development.

## Testing

- Unit (Vitest): importer normalization math (centering, bounding boxes,
  fit-to-slot scaling), bundle export/import round-trip, store logic.
- Integration: persistence round-trips against `fake-indexeddb`.
- Manual: a walkthrough checklist for feel — walk close-up without clipping,
  inspect transitions, import each supported format, export/import a bundle
  in a fresh browser profile.
- Performance: re-run the Milestone 0 populated-room walk on both reference
  devices before release; the debug FPS overlay must show budgets are met.
- Privacy: with DevTools open, import several models and confirm zero network
  requests after initial page load; repeat with the network disabled to
  confirm full offline operation.

## Future Roadmap (context, not commitments)

1. **Hosted sharing:** cloud persistence adapter + "Publish" → share URL.
2. **More spaces and themes;** space-picker becomes real.
3. **Social:** accounts, visiting, multi-presence in a space.
4. **Marketplace:** listing and selling pieces.
5. **AI photo-to-3D** import path as the technology matures.
