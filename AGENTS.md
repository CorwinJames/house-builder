# House Builder — notes for AI assistants

> **Before every session, pull the latest from `main` (git pull) before making changes, and push or open a PR when you finish, so different assistants don't overwrite each other's work. Never start work on a stale checkout.**

This applies to every assistant that touches the repo: Grok Build, Claude, Cursor, Grok Bot, and anyone else. Read this file before editing.

## What this is

A personal, static house planner for James Corwin and his wife Sophie. They are designing one hempcrete house in Jefferson County, Washington. It is not a general CAD product. Features get added as they experiment.

The long-term feeling is a simple building game: drag walls and rooms, and the app fills in real assemblies, routes wire and pipe, prices a materials list from cited sources, and warns against cited code rules. The output should eventually be drawings an engineer can stamp. Stage 2 is drag-to-build. Stage 4 prices the list from cited sources. Stage 5 places electrical devices and routes circuits. Stage 6 places fixtures and routes supply and drain piping. Assembly thicknesses are still placeholders with no invented code citations.

There is no server. The site is a static build deployed to GitHub Pages.

**Never invent a price.** A cost line needs a published price, a published wage, a bid, or a user entry. If you cannot find one, leave the amount empty, mark the line "price needed", and keep it out of the total. Every price record in `data/prices.json` needs a source name, a URL when it has a dollar amount, the date it was checked, a unit, and whether it is labor or material. To add or refresh a price, edit that file and re-read the page. Do not copy a number from memory. Production rates in `data/cost-assumptions.json` that are not from a published source must say they are assumptions. A bid or user entry on the house `cost.overrides` replaces the published amount.

## Stage roadmap

| Stage | What | Status |
| --- | --- | --- |
| 1 | Project, sample house, 2D plan, 3D model, layers, phase toggle | **Done** |
| 2 | Drag-to-build walls and rooms, with wall assemblies filled in | **Done** |
| 3 | Google sign-in and Drive saves | **Done** |
| 4 | Live cost and a shoppable materials list | **Done** |
| 5 | Electrical placement and routing | **Done** |
| 6 | Plumbing | **Done** |
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
- `src/state/viewState.js` reads and writes `localStorage` key `house-builder.view.v1` (camera, layers, phase).
- `src/ui/editor.js` is Build mode. The tool bar and the options for the active tool sit on the plan. Undo and redo are there too. Export, import, and reset are in the File menu. The house document is `localStorage` key `house-builder.document.v2`. There is no Pan tool: drag empty space, hold Space, or use the middle or right button.
- `config/google.json` holds the public Google OAuth client ID for project `house-builder-514402`. There is no client secret. The Cloud app is in Testing, so only invited testers can sign in, and consent can expire after about 7 days.
- `src/auth/google.js` uses Google Identity Services `initTokenClient` in the browser. The only scope is `https://www.googleapis.com/auth/drive.file`. The access token stays in memory.
- `src/drive/client.js` talks to Drive API v3 with `fetch`. `scripts/test-drive.mjs` mocks `fetch`, so CI does not need Google credentials.
- `src/ui/account.js` is the header account control and the Drive actions in the File menu. A signed-in open file autosaves about 10 seconds after the last edit.
- `src/build/` is snapping, wall joins, room detection, and opening placement. No DOM.
- `src/rules/` is the warning list. Geometry checks live there now. Stage 7 adds code rules through `registerRule`.
- `data/sample-house.json` is the house. Renderers do not hard-code room sizes.
- `data/assemblies.json` defines wall types. `data/headers.json` is the placeholder header table. `data/opening-catalog.json` is the door and window palette.
- `schemas/house.schema.json` is the contract for the house file. Schema versions 2, 3, and 4 still open. The app writes version 5, which adds an optional `plumbing` block. Version 4 added optional electrical devices. Version 3 added an optional `cost` block. `schemas/materials-list.schema.json` is the export a later Materials Scout can read.
- `src/cost/` turns geometry into quantities and applies `data/prices.json`. `src/ui/costs.js` is the header total and the materials panel. Electrical quantities come from `src/electrical/`. Plumbing quantities come from `src/plumbing/`.
- `src/electrical/design.js` places devices, suggests receptacles, groups circuits, routes them, and builds the electrical rows. The plan draws those routes when the Electrical layer is on.
- `src/plumbing/design.js` places fixtures, suggests a bathroom or kitchen layout, routes supply and DWV, and builds the plumbing rows. The plan draws those routes when the Plumbing layer is on. Labels wait for hover or selection.
- `scripts/check-model.mjs` checks the sample against the schema. `scripts/test-geometry.mjs` checks snapping, joins, rooms, and openings.

The phase toggle and the Future wings layer both gate later rooms. Phase 1 only hides future geometry even if the layer is on. Full house hides it when the layer is off. See `src/render/visibility.js`.

Site is a real toggle with an empty draw group. Leave it empty until that stage. The Electrical layer draws devices and circuit routes. The Plumbing layer draws fixtures, supply, and drains.

## Data model

Coordinates are decimal feet. The origin is the southwest corner of the full footprint. +x is east, +y is north.

Wall `start` and `end` are centerlines. `thickness` is centered on that segment. Corners are butt joints: one wall runs through, the other stops at its face.

Each wall has an `assemblyId`. The app copies `thickness`, `assembly` (the render bucket), and `role` from `data/assemblies.json`. Do not ask the user to type a thickness. The render buckets are still:

- `rammed-earth` — south exterior walls, 1.5 ft (18 in). Wall-infill layer. No studs in the current assembly.
- `hempcrete` — other exterior walls, 1.0 ft (12 in), with a placeholder 2x6 at 24 in o.c. Wall-infill layer, studs on the framing layer.
- `framed` — interior partitions, 0.5 ft (6 in), placeholder 2x4 at 16 in o.c. Framing layer.

Every assembly `note` must contain `placeholder: needs engineer/code verification` until a real source is cited. `source` stays `null` until then. Do not invent a code citation to fill it.

`phase` is `phase1` or `future`. Rooms are floor polygons. Areas in the UI are the shoelace area. After a wall edit, `syncRooms` in `src/build/rooms.js` rebuilds enclosed faces and keeps the old name and phase when the centroid still matches. Open areas such as the patio stay until someone deletes them, because they are not a closed loop.

Openings sit on a wall. `offset` is feet from the wall's start to the near jamb. A door or window must clear the corner by the placeholder distance in `data/headers.json` (6 inches) and must not overlap another opening. Each opening stores a `header` from that same table. `header.placeholder` is `true`, and the note repeats the placeholder marker. The framing layer draws studs, king studs, jack studs, and that header. Those sizes are not engineered.

New walls snap to the grid (default 6 inches), to endpoints and midpoints, and to 0/45/90 degrees. A new wall that tees into or crosses another wall splits it. Collinear overlaps are refused. Geometry warnings go through `src/rules/` and draw a red dashed outline. They are not code checks.

The roof is placeholder massing for a Chinese hip-and-gable. `roof.placeholder` stays `true` until someone designs a real roof. Do not present it as structure.

## Proportions

`data/ratios.json` is the ratio library (golden, silver, roots, bronze, plastic, and the musical ratios). Exact forms are evaluated in `src/build/ratios.js`. Custom ratios live on the house as `customRatios`.

`constraints` on the house record `target`, `reference`, `ratioId`, and `operation` (`multiply` or `divide`). `src/build/constraints.js` solves them. A cycle or two constraints on one target produces a warning and does not move those lengths. Wall constraints run after each edit. The sample footprint constraint (`width = φ × depth`) is stored so it is visible on first open. It is not applied automatically, because 76 / 47 is about 0.06% short of φ and the drawn walls stay put. **Snap footprint to φ** applies it. The plan shows the deviation instead of hiding it.

Construction dimensions display to the nearest 1/16 inch. When that rounding is not the stored length, the label also shows the exact decimal. Stored coordinates stay the full float. **Stage 11 blueprint export must use these constrained float lengths, not the 1/16 inch construction rounding.** The rounding is only a label.

Ratio snap (the Grid / Ratio toggle) uses `proportion.module` and `proportion.ratioId`: lengths `module × ratioⁿ`, sums of those lengths, and lengths taken from existing walls. Tick labels show while a wall is dragged.

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
- **Every cost or code number must cite a source with a URL and the date it was checked. Never invent prices.** Do not add a dollar amount, a wage, a permit fee, or a code limit that you cannot point at. The model checker rejects keys that look like prices. Assembly thicknesses and header sizes are placeholders, marked in the data files, until that citation exists.
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
6. Do not invent quantities for site. Plumbing quantities come from the placed fixtures and the rules in `src/plumbing/design.js`. A new price still needs a source, a URL when it has an amount, and a date.

## How to add an electrical device or rule

1. Add the kind to `DEVICE_DEFAULTS` or `APPLIANCES` in `src/electrical/design.js`, and to `PLACE_OPTIONS` so Build mode can place it. An appliance sets volts and amps. `gaugeForAmps` then picks the wire.
2. If it needs its own circuit, teach `buildElectrical` where that kind belongs. Dedicated 240V loads are already one circuit each. Kitchen, bathroom, and laundry receptacles are grouped before the general circuits.
3. Add a price id in `electricalBom` and a matching record in `data/prices.json`. If you cannot find a published price, set `amount` to `null` and `sourceName` to `Price needed`. Do not invent a dollar amount.
4. A code rule needs the NEC section, the WAC 296-46B adoption URL, and a short note when the section number or the application is an assumption. Put the citation on the rule object. Do not paraphrase a number you have not checked. `deviceWarnings` is the small inline warning for a rule this stage already implements, such as a plain receptacle in a bathroom.

## How to add a plumbing fixture or rule

1. Add the kind to `FIXTURES` and `PLACE_OPTIONS` in `src/plumbing/design.js`. Set the private DFU and minimum trap from UPC Table 702.1, and the supply fixture units from Table 610.3. If a cell is not confirmed, say so on the rule instead of inventing a number.
2. `buildPlumbing` routes supply from the water entry (hot from the water heater) and drains to a wet-wall stack, then to the septic stub. A new fixture is picked up if it is in `FIXTURES`.
3. Add a price id in `plumbingBom` and a matching record in `data/prices.json`. If you cannot find a published price, set `amount` to `null` and `sourceName` to `Price needed`.
4. A plumbing rule needs the UPC section and the WAC 51-56 adoption URL. `fixtureWarnings` is the inline warning for a rule this stage implements, such as a trap arm that is too long.

## Sample house, short version

Footprint 76 ft × 47 ft (3,572 sq ft), long axis east-west. Phase 1 is the rectangle from (22, 0) to (58, 32): 36 ft × 32 ft, 1,152 sq ft gross, about 972 sq ft of rooms. Living and kitchen face the south rammed-earth wall. The bathroom is the northwest corner of the core. The bedroom reaches the east wall. Patio and garage are west. Office and bedroom 2 are the east wing. Laundry, hall bath, and the primary suite are north. Details and exact areas are in `data/sample-house.json` and the README.
