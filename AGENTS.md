# House Builder — notes for AI assistants

> **Before every session, pull the latest from `main` (git pull) before making changes, and push or open a PR when you finish, so different assistants don't overwrite each other's work. Never start work on a stale checkout.**

This applies to every assistant that touches the repo: Grok Build, Claude, Cursor, Grok Bot, and anyone else. Read this file before editing.

## What this is

A personal, static house planner for James Corwin and his wife Sophie. They are designing one hempcrete house in Jefferson County, Washington. It is not a general CAD product. Features get added as they experiment.

The long-term feeling is a simple building game: drag walls and rooms, and the app fills in real assemblies, routes wire and pipe, prices a materials list from cited sources, and warns against cited code rules. The output should eventually be drawings an engineer can stamp. Stage 1 is only the sample house, in plan and in 3D.

There is no server. The site is a static build deployed to GitHub Pages.

## Stage roadmap

| Stage | What | Status |
| --- | --- | --- |
| 1 | Project, sample house, 2D plan, 3D model, layers, phase toggle | **Done** |
| 2 | Drag-to-build walls and rooms, with wall assemblies filled in | Not started |
| 3 | Google sign-in and Drive saves | Not started |
| 4 | Live cost and a shoppable materials list | Not started |
| 5 | Electrical placement and routing | Not started |
| 6 | Plumbing | Not started |
| 7 | Code-rule warnings | Not started |
| 8 | The parcel as the level: terrain, buildable area, pad, grading | Not started |
| 9 | Permits and a build timeline | Not started |
| 10 | Sunlight and airflow | Not started |
| 11 | Blueprint set | Not started |

Do not build a later stage unless the task asks for it. Update this table when a stage lands.

## Architecture

Plain ES modules and [Vite](https://vitejs.dev/). Three.js draws the model. There is no React and no backend.

- `index.html` mounts `#app`.
- `src/main.js` builds the screen, owns view state, and talks to both renderers.
- `src/render/plan2d.js` draws the plan on a canvas. North is up.
- `src/render/view3d.js` draws the model. Plan +x (east) is Three.js +X. Plan +y (north) is Three.js −Z. Height is Three.js +Y.
- `src/render/roof.js` builds the placeholder roof shape.
- `src/layers.js` is the list of layer toggles.
- `src/state/viewState.js` reads and writes `localStorage` key `house-builder.view.v1`.
- `data/sample-house.json` is the house. Renderers do not hard-code room sizes.
- `schemas/house.schema.json` is the contract for that file.
- `scripts/check-model.mjs` checks the sample against the schema.

The phase toggle and the Future wings layer both gate later rooms. Phase 1 only hides future geometry even if the layer is on. Full house hides it when the layer is off. See `src/render/visibility.js`.

Electrical, plumbing, and site are real toggles with empty draw groups. Leave them empty until those stages.

## Data model

Coordinates are decimal feet. The origin is the southwest corner of the full footprint. +x is east, +y is north.

Wall `start` and `end` are centerlines. `thickness` is centered on that segment. Corners are butt joints: one wall runs through, the other stops at its face.

Assemblies:

- `rammed-earth` — south exterior walls, 1.5 ft (18 in). Drawn with the wall-infill layer.
- `hempcrete` — other exterior walls, 1.0 ft (12 in). Also the thick wall that continues the Phase 1 line into a later wing. Wall-infill layer.
- `framed` — interior partitions, 0.5 ft (6 in). Framing layer.

`phase` is `phase1` or `future`. Rooms are interior floor polygons. Areas in the UI are the shoelace area of those polygons. Do not type a room area by hand in the renderer.

Openings sit on a wall. `offset` is feet from the wall's start to the near jamb. A door or window must fit on its wall. The checker enforces that.

The roof is placeholder massing for a Chinese hip-and-gable. `roof.placeholder` stays `true` until someone designs a real roof. Do not present it as structure.

## How to run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173/). `npm run build` writes `dist/`. `npm run preview` serves that build.

## How to deploy

GitHub Actions (`.github/workflows/pages.yml`) builds on every push to `main` and deploys to GitHub Pages with `base: "./"`.

The live URL is https://corwinjames.github.io/house-builder/

The workflow token cannot turn Pages on. A person with admin on the repo has to set **Settings → Pages → Build and deployment → Source: GitHub Actions** once. After that, a push to `main` publishes the site.

## Conventions

- The JSON model is the source of truth. If a dimension is on screen, it comes from the model.
- Keep the sample flag and the on-screen "not a final design" label until James and Sophie decide a layout is theirs.
- **Every cost or code number must cite a source with a URL and the date it was checked. Never invent prices.** Do not add a dollar amount, a wage, a permit fee, or a code limit that you cannot point at. Stage 1 has no prices. The model checker rejects keys that look like prices.
- Code citations, when stage 7 starts, should name the rule and the adoption: 2021 IRC (WAC 51-51), 2021 WSEC-R (WAC 51-11R), 2023 NEC via L&I (WAC 296-46B), 2021 UPC (WAC 51-56). Quote the section. Do not paraphrase a number from memory.
- Prefer a small module over a new framework. Other assistants will edit this repo.
- Do not add accounts, a database, or a server for a feature that can stay static.
- Wall and room geometry belong in `data/`, not in the renderers.

## How to add a new layer

1. Add an entry to `LAYER_DEFS` in `src/layers.js`. Use `stub: true` only if the layer should appear but draw nothing yet.
2. `defaultViewState()` in `src/state/viewState.js` picks up the new id automatically. Non-stub layers default on.
3. In `src/render/view3d.js`, a group with that id already exists if the id is in `LAYER_DEFS` (groups are created from the registry). Put meshes in `buckets[id]`, or in `futureBuckets[id]` when the geometry is part of a later wing.
4. In `src/render/plan2d.js`, draw the geometry only when `state.layers[id]` is on, and only when `isPhaseVisible` allows it.
5. If the geometry is part of the house, add it to `data/sample-house.json` and to `schemas/house.schema.json`. Then extend `scripts/check-model.mjs` so a bad file fails `npm test`.
6. Do not invent quantities for electrical, plumbing, or site. Those layers stay empty until their stage, and even then every number needs a source.

## Sample house, short version

Footprint 76 ft × 47 ft (3,572 sq ft), long axis east-west. Phase 1 is the rectangle from (22, 0) to (58, 32): 36 ft × 32 ft, 1,152 sq ft gross, about 972 sq ft of rooms. Living and kitchen face the south rammed-earth wall. The bathroom is the northwest corner of the core. The bedroom reaches the east wall. Patio and garage are west. Office and bedroom 2 are the east wing. Laundry, hall bath, and the primary suite are north. Details and exact areas are in `data/sample-house.json` and the README.
