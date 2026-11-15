/**
 * Skylights that can't be built as drawn: not over a roofed room, no roof
 * over them, a roof too flat or steep for a deck-mounted unit, crossing a
 * ridge or hip, or a ceiling opening that runs into a wall.
 */
import { skylightBuild } from "../build/skylights.js";

const VELUX_FS = "https://locator.veluxusa.com/ng/instruction_manuals/docs/452197-0109-FS.pdf";

export function skylightWarnings(house) {
  const out = [];
  for (const item of house.skylights || []) {
    for (const problem of skylightBuild(house, item).problems) {
      out.push({
        id: `skylight-${problem.code}-${item.id}`,
        code: problem.code === "pitch" ? "skylight.pitch" : `geometry.skylight-${problem.code}`,
        severity: "warning",
        title: `Skylight ${item.model || ""}: ${problem.text}`.replace("  ", " "),
        why: problem.code === "pitch"
          ? "VELUX deck-mounted FS skylights are made for roof pitches from 14° to 85°. Flatter roofs need a curb-mounted unit."
          : "A skylight needs a roof face above it and a room below it, with its shaft clear of walls, ridges, and hips.",
        citation: problem.code === "pitch" ? { code: "VELUX FS installation instructions", section: "pitch range", url: VELUX_FS, confirmSection: false } : undefined,
        target: { type: "skylight", id: item.id },
        point: { x: item.x, y: item.y },
        phase: item.phase || null,
      });
    }
  }
  return out;
}
