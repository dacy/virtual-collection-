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

- Room: compressed geometry and textures, baked lighting (no expensive
  realtime shadows).
- Pieces: stored as GLB; a per-file size warning bounds the worst case.
  Automatic piece optimization (decimation/compression on import) is a
  candidate for v1.1, not v1.
- Target: smooth walking on a mid-range laptop and a recent phone with a
  fully populated room.

## Testing

- Unit (Vitest): importer normalization math (centering, bounding boxes,
  fit-to-slot scaling), bundle export/import round-trip, store logic.
- Integration: persistence round-trips against `fake-indexeddb`.
- Manual: a walkthrough checklist for feel — walk close-up without clipping,
  inspect transitions, import each supported format, export/import a bundle
  in a fresh browser profile.

## Future Roadmap (context, not commitments)

1. **Hosted sharing:** cloud persistence adapter + "Publish" → share URL.
2. **More spaces and themes;** space-picker becomes real.
3. **Social:** accounts, visiting, multi-presence in a space.
4. **Marketplace:** listing and selling pieces.
5. **AI photo-to-3D** import path as the technology matures.
