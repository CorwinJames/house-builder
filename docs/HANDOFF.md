# House Builder: handoff brief (for Claude, and back to Grok Bot)

Last updated by Grok Bot: 2026-11-13. Main is at 2ab1131 (PR #22).

## The project
James Corwin and his wife Sophie are planning a small house built from natural materials, with hempcrete preferred. It sits on about 5 acres in Jefferson County, WA. They'll start small and add on later. Sophie does the design. James does the finish work himself: paint, flooring and tile.

This repo is a Sims-style house builder that runs in the browser:
- Repo: https://github.com/CorwinJames/house-builder
- Live (GitHub Pages, updates from `main`): https://corwinjames.github.io/house-builder/
- Main users: Sophie on a newer MacBook Pro with a trackpad, and James, sometimes on his phone.

Read the code before you change anything. Don't trust this brief on implementation details.

## Hard rules
1. Never make up a price. Only use published prices you can cite, with a source link. Anything without one stays marked "price needed".
2. Don't contact vendors or sign anything without James's approval.
3. Sophie's real plan files (`*.house.json`) never go in the repo. They live on James's Mac in `Documents/House Builder/App plans/`.
4. Do every change on a branch with a PR. James approves each merge himself.
5. Inside the builder, use plain words that teach building as you go, like a game. Trade jargon belongs only in exports and blueprints.
6. Keep the app guided. It always shows what the active tool does and what to click next, confirms each action with a short toast, and keeps a list of recent actions.

## What's built (stages 1–8 and the follow-ups)
- **Build:** walls, rooms, doors and windows, in both 2D and 3D. There's one HUD that sits over the 2D view, the 3D view and Split view, plus a floating placeholder that shows the item about to be placed. 3D has Edit, Orbit and Cutaway.
- **Walls:** a wall end lands exactly where you drop it. Snapping is opt-in, using the "Snap to grid" toggle or by holding Shift. "Tidy up shape" rounds walls to 3-inch steps and squares near-square corners. While dragging, a live label shows the length and angle (for example "12 ft 4 in at 37°"). 0° points east, angles go counterclockwise, and the label also shows the angle to the joined wall. Press Tab, or use the wall card, to type an exact length and angle.
- **Room sizes:** taken from the actual walls, with one number per side, showing both inside and outside sizes when they differ.
- **Select:** Shift-click and box select in 2D and 3D Edit. Delete or Backspace bulk-deletes, and Undo works. The camera doesn't jump when you delete. Furniture, site marks and labels can be selected, moved and deleted.
- **Navigation:** pinch zooms toward the cursor, two-finger scroll pans, and the mouse wheel zooms. Redraws are limited to once per frame, and moving the camera doesn't rebuild the cost or code checks. The 3D camera is damped.
- **Saving:** Google sign-in with Drive saves (Cloud project "House Builder", house-builder-514402, under jamesjamesjac@gmail.com). It autosaves a few seconds after edits, and every 30 seconds while there are unsaved changes. On page load it reloads from Drive, and if Google needs a click it shows a "Load from Drive" banner. You can also import and export files.
- **Costs:** a live materials list and costs. Phase 1 was $63,509.72 at stage 6, with many items still "price needed".
- **Electrical:** stage 5. Many parts and the L&I electrical permit are still "price needed".
- **Plumbing:** stage 6. Pipes stay out of the hempcrete and rammed-earth exterior walls, and the drain runs to a septic stub.
- **Code rules:** stage 7, with warnings. "Show me" jumps to the item, selects it and explains the problem in a toast. 9 in of hempcrete models at about R-18, below the WSEC-R prescriptive targets, which is an open question for the designer.
- **Land:** stage 8, with a sample 5-acre lot. It covers the well, septic, grading and the legal building area. The well needs about a 100 ft setback from the drain field, and the app tries opposite corners before warning. If the lot is too tight, it suggests public water, a shared well, or a mound or pressure septic system. Well, septic and grading costs are still "price needed".
- **Plan schema 7:** furniture icons, labels, site features, and outdoor and study areas.

## Known leftovers and open questions
- After a new wall is added in Build, the view refits to fit it, so the view can shift after you let go. The wall itself stays where it was dropped.
- Sophie needs to give one real measurement so the scale can be locked.
- Hempcrete R-value against code is a question for the designer.
- Many "price needed" items are still open.

## What's next (only when James says go)
- Stage 9: permits and timeline (Jefferson County).
- Later: solar and battery planning, with cited prices.

## How we hand work back and forth
1. **This file is shared memory.** Keep it at `docs/HANDOFF.md` in the repo. Whoever finishes a session updates "Last updated", the feature list and the leftovers.
2. **Add a log entry for every change** to `docs/CHANGELOG-AGENTS.md`, newest first:
   `YYYY-MM-DD | Claude or Grok Bot | PR link or commit | what changed, in plain words | anything left open`
3. **Branches and PRs.** Put each piece of work on its own branch (`claude/...` or `cursor/...`) with its own PR, and merge it to `main` only after James says yes. Don't leave half-finished work on `main`.
4. **Taking over.** Pull `main`, read this file, read the latest log entries, then run `git log --oneline -20`.
5. **Plan files.** If a change alters the `.house.json` format, bump the schema version, keep older files loading, and note it in the log.
6. **Before handing back,** make sure the live site loads with no console errors, the 2D plan isn't blank, the top-bar buttons work, and Drive save and reload still work. A blank plan and dead buttons have broken things before (fixed in PR #20).
