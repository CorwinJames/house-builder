# Changelog

## Stage 3 — Google sign-in and Drive saves

Sign in with Google from the static site and keep a house in a Drive folder named House Builder. The OAuth client ID is a placeholder in `config/google.json` until it is created in Google Cloud. There is no client secret and no server.

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
