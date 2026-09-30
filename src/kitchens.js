// The Build screen's projects: four rooms, fitted out one object at a time — a
// Woodshop, a Kitchen, a Living Room and a Music Room. (They were all kitchens until
// 2026-09-26; the owner asked for each to be unique. The ids and part counts are
// unchanged so saves carry over; the file keeps its name for history's sake.)
//
// DATA ONLY. This file is read by the game (build.js, meta.js) AND by
// tools/gen_kitchen.py, which loads it through node to render every object's sprite
// in Blender at the position and turn given here. It must therefore import nothing.
//
// The Build screen is 2D (2026-09-21). It was a live 3D room drawn by a painter's-
// algorithm rasteriser, and after two sessions of fixing sort order, coplanar faces,
// inverted roofs and walls fading out as the camera orbited, the owner's verdict was
// still that the buildings and chests did not look good. The objects are now rendered
// OFFLINE in Blender with a real depth buffer and real light, from one fixed isometric
// camera, and composited here as sprites. See §2 "The Build screen is 2D".
//
// A part is one OBJECT placed in a room: a band of floorboards, a counter, the fridge.
// The objects are modelled in code by tools/blender/kitchen_models.py (2026-09-26).
// They were a CC0 OBJ pack until then; the owner judged it not good enough, and the
// pack's layouts overlapped (the starter cooker stood 0.2 inside the worktop).

// --- The kitchens ----------------------------------------------------------
//
// Coordinates: x runs left-right, z runs front(+)-back(-), y is up. Objects are
// centred on x/z and sit on y = 0, so a layout only ever states where the middle of a
// thing goes. Every object is modelled with its FRONT facing the viewer (+z), so only
// chairs are ever turned.
//
// Sizes (kitchen_models.py), which the positions below are worked out from:
//   counter 1.20 wide (or `w`), sink 0.60, oven 0.60, fridge 0.66 — all 0.56 deep
//   except the fridge (0.60); a base unit's worktop is at y = 0.70. Wall cabinet
//   0.80 x 0.50 x 0.30 deep. Window 1.16 wide, 0.80 tall. Back wall's inner face is
//   z = -1.00, so a base unit stands at z = -0.72 and a wall cabinet at z = -0.85.
//   A floor band is `w` x `d`, and a kitchen's bands exactly pave its room.

export const KITCHENS = [
  {
    // The first room is the player's own WOODSHOP — the place the boards they cut
    // actually go. Brick and concrete, so it reads as a shop before anything is in it.
    id: 'starter',
    name: 'The Woodshop',
    blurb: 'Every maker needs a bench to make things on.',
    palette: { bg0: '#3a3230', bg1: '#241d1b', bg2: '#120e0d', accent: '#ffb35c' },
    tint: { rgb: [235, 226, 208], amount: 0 },
    room: {
      x0: -1.60, x1: 1.20, z0: -1.00, z1: 1.05, h: 1.85,
      floor: [150, 146, 140], floorSide: [112, 108, 104],
      wallTop: [214, 206, 196], wallSide: [176, 84, 62],
      finish: { wall: 'brick', floor: 'concrete' },
    },
    items: [
      { obj: 'workbench', name: 'Workbench', cost: 60, x: -0.35, z: -0.70 },
      // Hung on the back wall, from its bottom edge.
      { obj: 'pegboard', name: 'Pegboard of tools', cost: 90, x: -0.35, y: 0.95, z: -0.99 },
      { obj: 'toolchest', name: 'Tool chest', cost: 130, x: -1.27, z: -0.78 },
      { obj: 'lumberrack', name: 'Lumber rack', cost: 180, x: 0.76, z: -0.81 },
      { obj: 'sawhorses', name: 'Sawhorses', cost: 240, x: 0.35, z: 0.40 },
      { obj: 'stool', name: 'Shop stool', cost: 310, x: -0.60, z: 0.02 },
      { obj: 'shopvac', name: 'Shop vac', cost: 390, x: -1.22, z: 0.40 },
      { obj: 'offcuts', name: 'Offcut crate', cost: 470, x: 0.88, z: 0.78 },
      { obj: 'radio', name: 'Radio', cost: 560, x: -0.80, y: 0.72, z: -0.80 },
    ],
  },
  {
    id: 'family',
    name: 'The Kitchen',
    blurb: 'Room for everyone, and a fridge worth opening.',
    palette: { bg0: '#33404a', bg1: '#1d2a33', bg2: '#0e161c', accent: '#8fe0ff' },
    tint: { rgb: [150, 200, 225], amount: 0.22 },
    // The bare floor is screed; the floorboards are the first things bought.
    room: {
      x0: -1.70, x1: 1.90, z0: -1.00, z1: 1.20, h: 1.95,
      floor: [150, 146, 140], floorSide: [112, 108, 104],
      wallTop: [218, 232, 240], wallSide: [190, 206, 218],
      // The window's hole: the window (1.16 wide at x = -0.20) plus 0.02 each side.
      opening: { x0: -0.80, x1: 0.40, y0: 1.02, y1: 1.86 },
    },
    items: [
      { obj: 'floor', name: 'Floorboards', cost: 700, w: 3.60, d: 0.733, x: 0.10, z: -0.633 },
      { obj: 'floor', name: 'Floorboards', cost: 780, w: 3.60, d: 0.733, x: 0.10, z: 0.100 },
      { obj: 'floor', name: 'Floorboards', cost: 870, w: 3.60, d: 0.733, x: 0.10, z: 0.833 },
      { obj: 'counter', name: 'Long worktop', cost: 980, x: -1.10, z: -0.72 },
      { obj: 'sink', name: 'Sink', cost: 1100, x: -0.20, z: -0.72 },
      { obj: 'oven', name: 'Cooker', cost: 1250, x: 0.40, z: -0.72 },
      { obj: 'fridge', name: 'Fridge', cost: 1420, x: 1.04, z: -0.70 },
      // Sits IN the wall's opening (room.opening), not against the wall.
      { obj: 'window', name: 'Window', cost: 1600, x: -0.20, y: 1.04, z: -1.06 },
      { obj: 'chair', name: 'Chair', cost: 1800, ry: 0.35, x: -0.55, z: 0.55 },
      { obj: 'chair', name: 'Another chair', cost: 2000, ry: -2.6, x: 0.45, z: 0.85 },
      { obj: 'flower', name: 'Flowers', cost: 2250, x: -1.35, z: -0.78, y: 0.70 },
    ],
  },
  {
    // Striped paper over oak boards: the one room whose floor comes with it, because
    // what is bought here is comfort, not construction.
    id: 'chef',
    name: 'The Living Room',
    blurb: 'A fire, a good chair, and nowhere to be.',
    palette: { bg0: '#3a3340', bg1: '#241d29', bg2: '#120e15', accent: '#ff9a4d' },
    tint: { rgb: [255, 170, 110], amount: 0 },
    room: {
      x0: -1.75, x1: 1.75, z0: -1.00, z1: 1.20, h: 1.95,
      floor: [200, 152, 100], floorSide: [120, 84, 52],
      wallTop: [236, 226, 206], wallSide: [206, 196, 150],
      finish: { wall: 'stripes', floor: 'boards' },
    },
    items: [
      { obj: 'rug', name: 'Rug', cost: 2600, w: 1.9, d: 1.3, x: 0.20, z: 0.25 },
      { obj: 'fireplace', name: 'Fireplace', cost: 2850, x: -0.55, z: -0.84 },
      { obj: 'sofa', name: 'Velvet sofa', cost: 3100, x: 0.85, z: -0.61 },
      { obj: 'armchair', name: 'Armchair', cost: 3400, ry: 0.6, x: -1.05, z: 0.25 },
      { obj: 'coffeetable', name: 'Coffee table', cost: 3750, x: 0.75, z: 0.20 },
      { obj: 'bookshelf', name: 'Bookcase', cost: 4100, x: -1.42, z: -0.85 },
      { obj: 'floorlamp', name: 'Standard lamp', cost: 4500, x: 1.55, z: -0.05 },
      // Hung on the back wall above the sofa, from its bottom edge.
      { obj: 'painting', name: 'Painting', cost: 4950, x: 0.85, y: 1.05, z: -0.99 },
      { obj: 'plant', name: 'Fiddle-leaf fig', cost: 5400, x: -1.45, z: 0.85 },
      { obj: 'sidetable', name: 'Side table', cost: 5900, x: -0.45, z: 0.80 },
      { obj: 'pouf', name: 'Pouf', cost: 6500, x: 0.25, z: 0.90 },
    ],
  },
  {
    // Navy walls over wood panelling, walnut boards bought in. The last room, so it
    // is the one with the most in it and the most colour.
    id: 'dream',
    name: 'The Music Room',
    blurb: 'The one you have been cutting boards for.',
    palette: { bg0: '#2c3348', bg1: '#1a1f30', bg2: '#0c0f18', accent: '#9bb8ff' },
    tint: { rgb: [170, 240, 190], amount: 0 },
    room: {
      x0: -2.20, x1: 2.05, z0: -1.00, z1: 1.55, h: 2.05,
      floor: [150, 146, 140], floorSide: [112, 108, 104],
      wallTop: [224, 226, 236], wallSide: [52, 70, 112],
      finish: { wall: 'paint', floor: 'paint', panel: 0.9 },
      opening: { x0: -1.50, x1: -0.30, y0: 1.02, y1: 1.86 },
    },
    items: [
      { obj: 'floor', name: 'Walnut boards', cost: 7200, w: 4.25, d: 1.275, tone: 'walnut', x: -0.075, z: -0.3625 },
      { obj: 'floor', name: 'More walnut boards', cost: 7700, w: 4.25, d: 1.275, tone: 'walnut', x: -0.075, z: 0.9125 },
      { obj: 'rug', name: 'Rug', cost: 8200, w: 2.0, d: 1.4, x: 0.35, z: 0.55 },
      { obj: 'piano', name: 'Upright piano', cost: 8700, x: 0.75, z: -0.73 },
      { obj: 'pianobench', name: 'Piano stool', cost: 9300, x: 0.75, z: -0.20 },
      { obj: 'records', name: 'Record player', cost: 9900, x: -0.90, z: -0.79 },
      { obj: 'speakers', name: 'Speakers', cost: 10600, x: -0.90, z: -0.85 },
      { obj: 'drums', name: 'Drum kit', cost: 11300, x: -1.30, z: 0.55 },
      { obj: 'guitar', name: 'Acoustic guitar', cost: 12100, x: -0.05, z: -0.45 },
      // Sits IN the wall's opening (room.opening), not against the wall.
      { obj: 'window', name: 'Picture window', cost: 12900, x: -0.90, y: 1.04, z: -1.06 },
      { obj: 'amp', name: 'Amplifier', cost: 13400, x: 1.75, z: -0.83 },
      { obj: 'eguitar', name: 'Electric guitar', cost: 13800, x: 1.45, z: -0.30 },
      // Hung on the back wall above the piano, from its bottom edge.
      { obj: 'panels', name: 'Acoustic panels', cost: 14700, x: 0.75, y: 1.20, z: -0.99 },
      { obj: 'armchair', name: 'Listening chair', cost: 15800, ry: -0.6, x: 1.35, z: 0.95 },
    ],
  },
];

// Turns are few on purpose: every distinct (object, size, turn) is its own rendered
// sprite, so chairs share a handful of turns.
export const KITCHEN_BY_ID = Object.fromEntries(KITCHENS.map((k) => [k.id, k]));

// The sprite for an item: one per (object, size, turn). Shared by build.js and
// gen_kitchen.py so the name the game asks for is the name the tool rendered.
export function spriteKey(item) {
  const deg = Math.round(((item.ry || 0) * 180) / Math.PI);
  const size = item.w ? `${Math.round(item.w * 100)}x${Math.round((item.d || 0) * 100)}_` : '';
  const tone = item.tone ? `${item.tone}_` : '';
  return `${item.obj}_${size}${tone}${deg < 0 ? 'm' + -deg : deg}`;
}

// Objects that hang on the back wall rather than standing on the floor. Their sprites
// are rendered with a wall behind them to catch the shadow, not a floor.
export const WALL_MOUNTED = new Set(['cabinet', 'window', 'pegboard', 'painting', 'panels']);
