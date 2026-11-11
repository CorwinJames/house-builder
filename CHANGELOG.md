# Changelog

## Game-feel panels

Object cards now lead with a title and an up-to-code chip, then a few large stats, then each warning as its own card. Citations, assumptions, and line costs sit under Technical details. The cost window opens on the total, a phase toggle, and category jumps. The build bar uses icon tools, one-line hints, and an Advanced toggle for the proportion tools. Suggest placements previews a count per room. Electrical, plumbing, and site dim the other systems while you work in one of them.

## Stage 8 — land

The Site layer is on. The sample is a labeled 5 acre rectangle, not a real Jefferson County parcel. The plan shows the lot, road and side setbacks, a buildable area, contour lines, a well, a septic tank, a drainfield, and a reserve area. A card on the plan gives the acreage, the soil line, the gravity check, and the pad cut and fill.

Build mode has a Site tool for the well, tank, field, and reserve. The well panel offers a drilled well, a shared well, or public water, and it ties to the water entry and the well-pump circuit. The septic panel offers gravity, pressure, or a mound, and it checks the building-drain drop against the ground slope. Costs for the well, tank, field, and grading say price needed. A helper script can import a real parcel, an elevation, and a soil name. Driveway and power lines are dashed placeholders.

A house outside the setback, or a well too close to the field, shows up in the code check list.

## Stage 7 — code rules and warnings

The header has a count of the code checks still open. Open it for a short list grouped into blockers, warnings, and tips. Click a row to zoom the plan to that spot and read the one-sentence reason and the code section. A fix button changes the drawing when the edit is safe. Otherwise the row says Show me. Colored dots on the plan mark the same spots.

Clearing the blockers and warnings means the design matches the rules this model actually checks. A section that was not confirmed in the code text is marked confirm section. Geometry problems stay in the same list. No prices were added.

## Stage 6 — plumbing

Build mode has a Plumbing tool. Click to place a kitchen sink, dishwasher, toilet, lavatory, shower, tub, clothes washer, laundry sink, hose bibb, water heater, or the water entry. Suggest placements draws ghost fixtures for a bathroom or a kitchen on an interior wet wall.

Cold and hot supply and the drains draw on the plan. Lengths stay hidden until you point at a run or select a fixture. Drains are sized from UPC drainage fixture units. The building drain shows its slope and the invert drop at a septic stub. A trap arm that is too long, a toilet that is too close to a side wall, a shallow slope, or a pipe in hempcrete or rammed earth shows a short warning with the citation.

Pipe, fittings, traps, the toilet, and plumber hours join the materials list. Published prices are used where a product page was found. The rest say "price needed." The plumber rate is the Jefferson County journey-level rate from L&I. Hours per fixture and per foot are assumptions you can edit.

The sample's phase 1 core has a starter layout. The water heater and the well entry look for the stage 5 circuits. A fixture that sits on the stack still counts a vertical drop, so its drain length is not zero. Older house files still open. The app saves them as schema version 5.

## Stage 5 — electrical

Build mode has an Electrical tool. Click to place a receptacle, a GFCI, a weather-resistant outlet, a 240V appliance, a switch, a light, a fan, a smoke alarm, or the main panel. The device snaps to a wall at a standard height, which you can edit. Suggest placements draws ghost outlets from the spacing rules, and you can accept or dismiss them.

The app groups those devices into circuits, picks a breaker and a wire gauge, and draws a color-coded route from the panel. The route is the shortest Manhattan path plus a vertical drop. Each circuit shows its length and voltage drop. The cost panel shows a simple dwelling load calculation and the recommended service size, with the section notes an electrician can check.

Hempcrete and rammed-earth walls default to conduit so the cable is not buried in the mass. Other walls default to the stud bay. You can change that per wall. Conduit and fittings are listed. That routing choice is an assumption and needs an electrician and the inspector.

Wire, devices, boxes, breakers, the panel, staples, conduit, a ground rod, and the electrical permit are lines on the stage 4 materials list. Published prices are used where a product page was found. The rest say "price needed" and stay out of the total. Electrician hours use the Jefferson County inside-wireman rate from L&I, and the hours themselves are assumptions you can edit.

The sample's phase 1 core has a starter layout. Its circuits are split so each one stays within 3 percent under the voltage-drop assumption. NEC 210.19(A) Informational Note is the citation, and a circuit you build past 3 percent shows that warning. Circuit labels appear when you point at a run or select a device, off the room names. Older house files still open. The app saves them as schema version 4.

## Stage 4 — live cost and materials list

The header shows a priced total for the phase you are looking at, and how many lines still need a price. The Costs button opens the materials list: quantity, unit price, line total, and a source link. James's paint, flooring, and tile labor stay at $0 until you turn on hired finish labor.

Quantities come from the walls and rooms. Hempcrete bags use Hemp and Block's published yield (one binder bag and one hurd bag make up to 4.5 cubic feet). Labor hours use labeled assumptions times Jefferson County prevailing wages from L&I's own lookup (effective September 2, 2026). Anything without a published price stays on the list as "price needed" and is not in the total. Foundation, slab, and roof are allowances and are not in the total. Plumbing is still empty. Electrical was added in stage 5.

A stage 2 house file still opens. The app saves it as schema version 3 with an optional cost block. Export CSV or the materials JSON (`house-builder.materials`, version 1) from the cost panel or the File menu.

## Stage 3 — Google sign-in and Drive saves

Sign in with Google from the static site and keep a house in a Drive folder named House Builder. The public client ID is in `config/google.json`. There is no client secret and no server. The Google app is in Testing: only invited testers can sign in, and consent may need re-approval about every 7 days. An `access_denied` sign-in says that.

- The browser uses Google Identity Services' token client. The only scope is `drive.file`, so the app sees files it created or that someone opened with it.
- File menu: Save to Drive, Save as, Open from Drive, and Share with an email. Export, Import, and Reset stay for this device.
- Files are `<design name>.house.json`. Drive stores `appProperties` `app=house-builder` and the schema version.
- This browser still autosaves locally. When a Drive file is open, the app also saves about 10 seconds after the last edit. The header shows Saved, Saving, or Offline. A newer Drive copy is not overwritten without asking. An expired token is requested again quietly; if that fails, the header says Reconnect Google.
- `?file=<driveFileId>` opens that file after sign-in when `drive.file` allows it.

## Stage 2.1 — build UI cleanup

The header is thin. View and Build are their own switch. Phase, plan/3D, layers, and File (export, import, reset) stay with the view. Build tools sit on the plan, with a short options strip just above them that can collapse. The wall-type note is behind an info icon. Wall types show only for Wall and Room. Door and Window show only their own sizes, with width, height, sill, and a live preview. Undo and redo are small plan buttons, plus Ctrl/Cmd+Z and Shift+Z. Drag empty space, Space, or the middle or right button to pan. Ratio tick labels are a few pills that do not overlap. Room proportion lines are a single spaced line (φ, δ, √, ρ) and hide until the plan is zoomed in.

## Stage 2 — drag to build

You can change the sample. Build mode has Select, Wall, Room, Door, Window, Delete, Pan, Undo, and Redo.

- Walls snap to a 6 inch grid, to ends and midpoints, and to 45 degree angles. Joining a wall splits a tee or a crossing. Overlapping walls are refused.
- Wall thickness and framing come from `data/assemblies.json`. The user does not type a thickness. Only a south-facing exterior wall suggests rammed earth. Other exterior walls suggest hempcrete. Every assembly is marked `placeholder: needs engineer/code verification` and has no code citation.
- Doors and windows drag along a wall, snap, and stay 6 inches off corners. That clearance is a placeholder. A header from `data/headers.json` is stored on the opening and drawn with king studs and jacks on the framing layer. The header table is a placeholder too.
- Rooms are detected from closed walls. Names and phases stick when the shape still matches. Areas and the Phase 1 total update as you edit.
- Geometry warnings (overlap, an opening that does not fit) are red outlines. They live in `src/rules/` so later code rules can be added without inventing citations.
- Edits autosave in this browser. Reset, Export JSON, and Import JSON are on the build bar. The house file is schema version 2.
- A short hint plays the first time you open Build. Long-press or the Pan tool slides the plan on a tablet.
- Proportion tools: a ratio library, wall-length constraints with cycle detection, ratio snap with tick labels, room proportion readout, and a golden footprint constraint on the sample. Construction sizes show the nearest 1/16 inch beside the exact length when those differ.

## Stage 1 — sample house, plan, and 3D

The app is a static site. It shows one editable sample of the Jefferson County house. It does not edit walls yet, and it does not show prices.

- House model in `data/sample-house.json`, checked against `schemas/house.schema.json`.
- Plan view with real wall thickness, room labels and areas, a grid, dimensions, pan, and zoom.
- Three.js model with wall heights, door and window openings, a floor slab, orbit controls, and a placeholder Chinese hip-and-gable roof.
- Layer toggles: Framing, Hempcrete / wall infill, Finishes, Future wings, Dimensions, Labels. Electrical, Plumbing, and Site are present and empty.
- Phase toggle: Phase 1 only, or the full sample.
- View choice: Plan, 3D, or split on a wide screen.
- A first-run hint, and view state saved in `localStorage`.
- GitHub Actions workflow deploys `main` to GitHub Pages.

## Later

Stages 2 through 11 are listed in `AGENTS.md`. They are not started.
