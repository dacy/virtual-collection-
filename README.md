# Virtual Collection

Display your 3D collection (figures, toys, sculpts — any model with a story)
in a realistic, walkable virtual gallery. Fully local: your files never leave
your device. No accounts, no uploads, no backend.

- **Design spec:** [docs/superpowers/specs/2026-06-11-virtual-collection-display-design.md](docs/superpowers/specs/2026-06-11-virtual-collection-display-design.md)
- **Implementation plan:** [docs/superpowers/plans/2026-07-04-virtual-collection-v1-implementation-plan.md](docs/superpowers/plans/2026-07-04-virtual-collection-v1-implementation-plan.md)

## Development

```sh
npm install
npm run dev        # start dev server
npm test           # unit tests
npm run lint       # includes module-boundary enforcement
npm run build      # production build (injects the privacy CSP)
```

## Milestone 0: the populated-room performance proof

The first milestone measures whether a browser can walk a gallery filled
with 20 heavy pieces (~3.3M triangles, unique 2k textures each) at the spec
budgets: **60 fps on a mid-range laptop, 30 fps on a mid-range phone**.

To run it on your devices:

```sh
npm install
npm run dev -- --host   # --host exposes the server on your LAN for phone testing
```

Then open `http://localhost:5173/#/spike` on the laptop, and
`http://<your-laptop-ip>:5173/#/spike` on the phone (same Wi-Fi). Wait for
all 20 pieces to finish loading (the counter top-left), walk the room —
including right up close to pieces — and read the overlay:

- **FPS / 1% low** — green means the budget is met.
- **Draw calls, triangles, estimated texture VRAM** — the scene budgets
  from the spec, measured live.

Useful variations while measuring:

- `?tex=1024` — halves texture memory (the first mitigation on the list).
- `?pieces=10` — half population, to find where the budget breaks.

The stress pieces are procedurally generated stand-ins for photogrammetry
scans — deterministic, so runs are comparable across devices. Record the
numbers in `docs/superpowers/specs/milestone-0-findings.md` (template
there); those findings calibrate the real scene budgets and decide which
import-time optimizations v1 must include.

### Display your own models

In the spike, drag GLB/GLTF, FBX, OBJ, or STL files anywhere onto the page
(or tap **Display your own models…** bottom-left, which also works on
phones). Each file replaces a stand-in pedestal piece, auto-fitted to the
slot, and the budget overlay updates to your real collection's numbers.
Everything stays in the page's memory — files are parsed locally and
nothing is uploaded.

**Polypaint / vertex colors** are supported: GLB and FBX vertex colors show
automatically, and ZBrush OBJ exports with `#MRGB` polypaint blocks are
parsed and displayed (sRGB-correct). Export from ZBrush with polypaint on
and colorize enabled — no texture maps needed.

**Adjusting pieces:** click **Edit pieces** (top right). Click any piece to
select it, then use the sliders to rotate it, scale it, or lift it off the
pedestal. With one of your own pieces selected, click a different pedestal
to move it there (occupied pedestals swap), or remove it to bring the
stand-in back. **Done editing** returns to walking.

Spike limitations (the real import pipeline in Phase 3 removes them):
OBJ/FBX with external texture-map files load untextured; STL gets a neutral
gray material; pieces and placements aren't saved — reload starts fresh.
