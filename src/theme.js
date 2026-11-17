/** Shared colors so the plan and the model describe the same materials. */

export const INK = "#2A241B";
export const MUTED = "#6F6458";

export const ASSEMBLY_2D = {
  hempcrete: { fill: "#C6B489", stroke: "#7C6A3E" },
  "rammed-earth": { fill: "#A85B3C", stroke: "#6E3A28" },
  framed: { fill: "#E4C09A", stroke: "#8A6240" },
  "timber-infill": { fill: "#D9CBB0", stroke: "#5B3A24" },
  brick: { fill: "#8E8A84", stroke: "#4E4A45" },
  screen: { fill: "#F1EADB", stroke: "#6E5A40" },
};

export const ASSEMBLY_3D = {
  hempcrete: 0xc6b489,
  "rammed-earth": 0xa85b3c,
  framed: 0xd7a56a,
  "timber-infill": 0xe2d6bf,
  brick: 0x8a8781,
  screen: 0xf3ecdc,
};

export const FINISH_2D = {
  wood: "#E7D0A8",
  tile: "#D5CFC3",
  stone: "#D2C4B0",
  concrete: "#C5C6C1",
};

export const FINISH_3D = {
  wood: 0xe0c49a,
  tile: 0xd0cac0,
  stone: 0xcbbda8,
  concrete: 0xc2c3be,
};

export const FINISH_LABEL = {
  wood: "Wood floor",
  tile: "Tile",
  stone: "Stone",
  concrete: "Concrete",
};
