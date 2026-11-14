/**
 * Scale figures: things everyone knows the size of, to judge a room against.
 * Sizes are common published sizes, not a product or a price.
 * A queen mattress is 60 × 80 in. The others are typical sizes.
 * They are stored as plan furniture, so they move, copy, and delete like it.
 */

export const SCALE_FIGURES = [
  { kind: "person", name: "Person", label: "Person 5′9″", icon: "🧍", width: 1.75, depth: 1, height: 5.75 },
  { kind: "bed", name: "Queen bed", label: "Queen bed", icon: "🛏", width: 5, depth: 80 / 12, height: 2 },
  { kind: "sofa", name: "Sofa", label: "Sofa", icon: "🛋", width: 7, depth: 3, height: 2.75 },
  { kind: "table", name: "Dining table for 6", label: "Table for 6", icon: "🍽", width: 6, depth: 3, height: 2.5 },
  { kind: "car", name: "Car", label: "Car", icon: "🚗", width: 6, depth: 15.5, height: 4.75 },
];

export function scaleFigure(kind) {
  return SCALE_FIGURES.find((item) => item.kind === kind) || SCALE_FIGURES[0];
}

/** Height in feet for drawing furniture in 3D. Unknown kinds keep the old 2 ft block. */
export function furnitureHeight(kind) {
  if (kind === "counter") return 3;
  const figure = SCALE_FIGURES.find((item) => item.kind === kind);
  return figure ? figure.height : 2;
}

/** A new figure as a furniture record, standing at `point`. */
export function makeFigure(kind, point, id) {
  const figure = scaleFigure(kind);
  return {
    id,
    kind: figure.kind,
    name: figure.name,
    x: point.x,
    y: point.y,
    rotation: 0,
    width: figure.width,
    depth: figure.depth,
    note: "Scale figure for judging size. Not part of the house.",
  };
}
