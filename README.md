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

## Google sign-in and Drive

The page can save a house to the signed-in person's Google Drive. There is still no server. The browser asks Google for an access token and calls the Drive API itself.

The public client ID lives in [`config/google.json`](config/google.json). There is no client secret. The Google Cloud project is `house-builder-514402`, and the app is in **Testing**. Only invited testers can sign in. While it stays in Testing, Google may ask for consent again about every 7 days, and the token can need that same re-approval.

Authorized JavaScript origins already set on that client:

- `https://corwinjames.github.io`
- `http://localhost:5173`

The token client does not redirect the page, so Authorized redirect URIs stay empty. The origin is the site's scheme, host, and port only. The `/house-builder/` path is not part of it. If the client ID is ever replaced with the placeholder, the header button says **Google sign-in not configured yet** instead of starting a sign-in.

Sign in from the header. **File** then has Save to Drive, Save as, Open from Drive, and Share with. Designs land in a Drive folder named **House Builder**, as `<name>.house.json`. This browser still keeps a local copy. With a Drive file open, edits also save to Drive about 10 seconds after you stop. The header shows Saved, Saving, or Offline in small type.

Share with types an email and gives that person edit access on the current file. A link looks like `https://corwinjames.github.io/house-builder/?file=<driveFileId>`. `drive.file` can open that file for the person who created it. It cannot see a file created under someone else's sign-in, even after it is shared, until that person opens it through Google Picker (which needs a separate API key) or you hand them the JSON with Export and Import.

## For Sophie

The chip at the top says **Sample layout**. Next to the cost is a count of code checks still open. Open it for a short list. Click a row to zoom to that spot. Clearing the blockers and warnings means the drawing matches the rules this model checks, not that a permit is ready. Edits save on this device without another notice. **Sign in with Google**, then **File → Save to Drive**, also keeps a copy in your Drive. Only an invited tester account can sign in while the Google app is in Testing. Solid rooms are Phase 1, the small house that would be built first: a living room, a kitchen, a bathroom, and a bedroom. Dashed, lighter rooms are later wings. Nothing here is locked in.

**View** is for looking. **Build** is for changing the house. The first time you open Build, a short hint walks through the tools.

- **Wall.** Drag on the plan. The wall snaps to a grid (6 inches, unless you change Grid), to the ends and middles of other walls, and to straight or 45 degree lines. The length shows while you drag. You never type a thickness. Pick Hempcrete, Rammed earth, or Partition. A wall whose outside face points south suggests rammed earth. North, east, and west exterior walls suggest hempcrete. The note under the palette says these sizes still need an engineer to check them.
- **Room.** Drag a rectangle. The app adds the four walls. If hempcrete is selected, the south side of that rectangle is rammed earth.
- **Door** and **Window** each show only their own sizes. Set width and height, and the sill for a window, then drag along a wall. It will not sit on a corner or on top of another opening. A selected opening keeps those fields in the panel. The header above it is a placeholder, not a final size.
- **Select.** Click a wall, a room, or an opening. Drag the round handles on a wall to stretch it. Connected walls follow. Drag the middle of a wall to move it. Drag empty space to slide the plan. You can also hold Space, or use the middle or right mouse button. Two fingers pinch to zoom.
- **Delete.** Click the thing you want gone. You can also select it and press Delete.
- **Undo** and **Redo** sit on the plan. Ctrl or Cmd Z undoes. Shift Z redoes. **File** holds Drive save and open, plus Export, Import, and Reset. Reset asks before it puts the sample back.

The plan and the 3D view update together. Click a wall in 3D to select it. Drawing happens on the plan.

### Costs

The chip in the header is the priced total for Phase 1 or the full house, whichever you are viewing, plus a count of lines that still need a price. Open **Costs** from that chip.

The list is grouped: hempcrete, rammed earth, framing, doors and windows, finishes, electrical, plumbing, and labor. A line with a price links to the page it came from. A line that says **Price needed** is counted and left out of the total, so the number is not pretending to be a whole bid. Foundation, slab, and roof are listed the same way and are not added in.

Paint, flooring, and tile labor are **DIY (James)** at $0. Turn on **Show hired finish labor** to see those hours at the published wage. Lengthen a wall, change its type, or add a window and both the chip and the list move.

**File** can export the list as CSV or as JSON for a later materials search.

### Outlets

Open **Build** and choose **Electrical**. The Place menu is receptacles, 240V appliances, switches, lights, and the main panel. Click a wall and the device snaps to it at a normal height. Click the device afterward to change the kind, the height, or, for a well pump, 120V or 240V. The colored line is that circuit's route back to the panel. The header total moves when the new wire and the electrician's time have a price.

**Suggest placements** draws dashed outlets: no point on a wall more than 6 ft from one, kitchen counters closer, and one GFCI in a bathroom. **Accept** keeps them. **Dismiss** clears the dashed ones. You can still put a device anywhere.

The sample already has a phase 1 layout. Turn the **Electrical** layer off if you want the plan quiet. Hempcrete and rammed-earth walls default to conduit instead of burying the cable in the wall. That choice is on the wall's panel, and an electrician still has to confirm it.

**Costs** includes an Electrical group and a service-load section. The steps are there so an electrician can check them. Anything without a published price says **Price needed**.

### Fixtures

Open **Build** and choose **Plumbing**. The Place menu is the kitchen, the bathroom, the laundry, a hose bibb, the water heater, and the water entry. Click a wall. A toilet sits 12 inches off the wall. **Suggest placements** draws dashed fixtures for a bathroom or a kitchen, grouped on an interior wall. **Accept** keeps them.

Cold pipe is blue. Hot pipe is red. Drains are dashed. The length shows when you point at a run or select a fixture. The fixture's panel offers a PEX manifold or a trunk-and-branch, and for the water heater an electric tank or a heat pump, with the priced difference. Hempcrete and rammed-earth walls can take a furred chase instead of a pipe inside the mass.

The sample already has a kitchen sink, a dishwasher, a toilet, a lavatory, a shower, a water heater, the water entry, and a drain to a septic stub. Turn the **Plumbing** layer off if you want the plan quiet.

### Proportions

The sample footprint is 76 ft by 47 ft, very close to a golden rectangle. The plan marks it **φ × depth** and shows that it is about 0.06% short of exact. Nothing is quietly rounded away: a length that is not a whole number of sixteenths shows both the construction size (nearest 1/16 inch) and the exact decimal.

- **Grid / Ratio** switches how a new wall's length snaps. Ratio uses the project ratio and a module length. While you drag, tick marks are labeled, for example **φ² · 8 ft**.
- **Guides** draws a square-and-remainder on the footprint, and on a room you have selected.
- Select a wall to set **this wall = ratio × another wall**, or to unlink it. If you change the reference, the linked wall follows. A loop is left alone and called out.
- A room's panel shows its length-to-width ratio and the nearest named one, such as **1.618 · φ** or **1.59 · φ −1.7%**. On the plan that line uses a font that can draw φ, δ, √, and ρ, and it stays hidden until you zoom in. **Make proportional** moves the far wall so the room matches the ratio you pick.
- **Snap footprint to φ** makes the stored width exactly φ times the depth. The walls you already drew do not jump.

- **Plan** is the flat drawing. North is up. Drag to slide around. Scroll, or pinch on a phone, to zoom. Double-click the plan, or press **Fit**, to see the whole house again.
- **3D** lets you walk around the model. Drag to turn it. Scroll or pinch to move closer. **Reset view** puts the camera back. The roof is a placeholder shape so you can see the idea of a Chinese hip-and-gable. It is not a real roof design.
- **Split** shows both on a laptop. On a phone, use **Plan** and **3D** one at a time.
- **Phase 1** hides the later wings. **Full house** shows them when the Future wings layer is on.
- **Layers** turn pieces on and off: framing, hempcrete and rammed earth, floor finishes, later wings, dimensions, room labels, electrical, plumbing, and site. Site shows the sample lot, setbacks, contours, the well, and the septic field. The lot is labeled as a sample, not a real parcel. File → Import parcel JSON can bring in a file from `scripts/fetch-parcel.mjs`.
- The app remembers your pan, zoom, camera, layers, and phase on this browser. Google sign-in is optional and only stores the house file you save to Drive.

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

Phase 1's four rooms add up to about 972 sq ft inside the 1,152 sq ft shell. Wall thickness is the difference. Build mode can change all of this. The areas above are the starting sample.

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
