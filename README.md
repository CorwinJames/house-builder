# House Builder

A personal planner for James and Sophie's hempcrete house in Jefferson County, Washington. This first version shows one **sample layout** in plan and in 3D. It is a starting point you can look around, not the final house and not a permit drawing.

Live site: https://corwinjames.github.io/house-builder/

The page goes live after the GitHub Pages source is set to GitHub Actions and the workflow on `main` has finished. Until then, run it locally.

## Run it locally

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173/.

`npm run build` writes the static site into `dist/`. `npm run preview` serves that folder.

## For Sophie

The chip at the top says **Sample layout**. Solid rooms are Phase 1, the small house that would be built first: a living room, a kitchen, a bathroom, and a bedroom. Dashed, lighter rooms are later wings. Nothing here is locked in.

- **Plan** is the flat drawing. North is up. Drag to slide around. Scroll, or pinch on a phone, to zoom. Double-click the plan, or press **Fit**, to see the whole house again.
- **3D** lets you walk around the model. Drag to turn it. Scroll or pinch to move closer. **Reset view** puts the camera back. The roof is a placeholder shape so you can see the idea of a Chinese hip-and-gable. It is not a real roof design.
- **Split** shows both on a laptop. On a phone, use **Plan** and **3D** one at a time.
- **Phase 1** hides the later wings. **Full house** shows them when the Future wings layer is on.
- **Layers** turn pieces on and off: framing, hempcrete and rammed earth, floor finishes, later wings, dimensions, and room labels. Electrical, plumbing, and site are listed for later. They have nothing to show yet.
- The app remembers your pan, zoom, camera, layers, and phase on this browser. There is no account yet.

South walls are rammed earth (the banded reddish walls). The other outside walls are hempcrete. Inside walls are wood framing.

## The sample, in numbers

The whole footprint is **76 ft east-west by 47 ft north-south** (3,572 sq ft), close to a golden-ratio rectangle, long axis east-west. Phase 1 sits inside it, from the south wall northward: **36 ft by 32 ft, 1,152 sq ft gross**.

Room areas are computed from the floor polygons in [`data/sample-house.json`](data/sample-house.json). Rounded:

| Room | When | Area |
| --- | --- | --- |
| Living room | Phase 1, south | 306 sq ft |
| Kitchen | Phase 1, south | 288 sq ft |
| Bathroom | Phase 1 | 98 sq ft |
| Bedroom | Phase 1, east side of the core | 278 sq ft |
| Shaded patio | Later, west, outdoors | 506 sq ft |
| Garage | Later, northwest | 462 sq ft |
| Office | Later, south | 276 sq ft |
| Bedroom 2 | Later, east | 217 sq ft |
| Laundry | Later, north (includes mudroom space) | 179 sq ft |
| Hall bath | Later, north | 105 sq ft |
| Primary bedroom | Later, northeast | 332 sq ft |
| Primary bath | Later, ensuite | 89 sq ft |

Phase 1's four rooms add up to about 972 sq ft inside the 1,152 sq ft shell. Wall thickness is the difference. You cannot edit rooms yet. That is the next stage.

```
North
┌──────────┬──────────┬─────────┬──────────────────┐
│ Garage   │ Laundry  │ Hall    │ Primary bedroom  │
│          │          │ bath    │ and primary bath │
├──────────┼────┬─────┴─────────┼──────────────────┤
│          │Bath│ Bedroom       │ Bedroom 2        │
│ Patio    ├────┴───────┬───────┼──────────────────┤
│          │ Living room│Kitchen│ Office           │
└──────────┴────────────┴───────┴──────────────────┘
West                                              East
South — rammed earth along the house, patio open
```

The drawing is a sketch of the arrangement. The JSON is exact.

## Project layout

- [`data/sample-house.json`](data/sample-house.json) — the house
- [`schemas/house.schema.json`](schemas/house.schema.json) — the shape of that file
- [`AGENTS.md`](AGENTS.md) — how to work in this repo
- [`CHANGELOG.md`](CHANGELOG.md) — what each stage added

There are no prices in this version. None will be added unless the number comes from a cited source.
