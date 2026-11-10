/** Dimension strings shared by the plan and the 3D view. Distances are feet. */

export function planDimensions(house, futureShown) {
  const core = house.phases.phase1.bounds;
  const dims = [
    {
      id: "p1-width",
      x0: core.x0,
      y0: core.y0,
      x1: core.x1,
      y1: core.y0,
      dist: 3.6,
      future: false,
    },
    {
      id: "p1-depth",
      x0: core.x0,
      y0: core.y0,
      x1: core.x0,
      y1: core.y1,
      dist: -3.6,
      future: false,
    },
  ];
  if (futureShown) {
    dims.push(
      {
        id: "all-width",
        x0: 0,
        y0: 0,
        x1: house.footprint.width,
        y1: 0,
        dist: 7.4,
        future: true,
      },
      {
        id: "all-depth",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: house.footprint.depth,
        dist: -7.4,
        future: true,
      },
    );
  }
  return dims;
}

/** Positive dist is to the right of start → end. */
export function offsetSegment(dim) {
  const len = Math.hypot(dim.x1 - dim.x0, dim.y1 - dim.y0) || 1;
  const tx = (dim.x1 - dim.x0) / len;
  const ty = (dim.y1 - dim.y0) / len;
  const rx = ty;
  const ry = -tx;
  return {
    x0: dim.x0 + rx * dim.dist,
    y0: dim.y0 + ry * dim.dist,
    x1: dim.x1 + rx * dim.dist,
    y1: dim.y1 + ry * dim.dist,
    len,
    tx,
    ty,
    rx,
    ry,
  };
}
