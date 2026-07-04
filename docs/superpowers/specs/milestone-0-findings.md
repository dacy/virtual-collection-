# Milestone 0 Findings — populated-room performance proof

**Status:** Awaiting measurement on reference devices
**How to run:** see README → "Milestone 0"

## Reference devices

| Device | GPU / class | Browser | Screen |
|---|---|---|---|
| (laptop — fill in) | | | |
| (phone — fill in) | | | |

## Measurements

Walk the full room, including close-up inspection of the heaviest pieces
(the dense spheres), for at least 60 seconds after all 20 pieces load.

| Device | Config | FPS avg | FPS 1% low | Draw calls | Triangles | Est. tex VRAM | Pass? |
|---|---|---|---|---|---|---|---|
| laptop | default (20 pieces, 2k tex) | | | | | | |
| phone | default (20 pieces, 2k tex) | | | | | | |
| phone | `?tex=1024` (if default fails) | | | | | | |
| phone | `?pieces=10` (if still failing) | | | | | | |

## Verdict

- [ ] **PASS** — 60 fps laptop / 30 fps phone at full population.
- [ ] **PASS with mitigations** — list which (`tex=1024` ⇒ import-time
      texture downscaling becomes mandatory in v1, etc.):
- [ ] **FAIL** — decision returns to the design (fewer slots, harder
      per-piece caps, or view-only lite mode on phones).

## Calibrated budgets (fill in from measurements)

- Total triangles: 
- Draw calls: 
- Texture VRAM (desktop / mobile): 
- Mandatory v1 import-time optimizations: 

## Notes / observations

(loading time, thermal throttling after a few minutes, close-up near-clip
feel, anything surprising)
