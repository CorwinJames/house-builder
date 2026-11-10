# Changelog

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
