// Difficulty curve, gimmicks, materials, and the workshop each material is cut in.
//
// PACING (see CRAZYGAMES_GUIDELINES.md §2). The campaign is exactly LEVEL_COUNT levels
// and then hands over to Endless, so the curve has a real end to aim at:
//   lv 1-3     plain boards, no gimmick — this is where the game is learned
//   lv 4-18    gentle gimmicks only (LONG HAUL, WIDE BOARD, SALVAGE RUN, QUICK FEED)
//   lv 19-40   the sharper ones unlock: NARROW STOCK, SHORT SPRINT, HARD ANGLES
//   lv 22+     gimmicks start pairing up
//   lv 24+     DOUBLE TIME is allowed
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:
//
// 1. Feed speed does NOT rise with level. The campaign runs at a fixed BASE_SPEED and a
//    board is only fast when a GIMMICK makes it fast — and it announces that before it
//    starts. The old curve ramped 200 -> 400px/s across the hundred levels, which made
//    "harder" and "faster" the same word and the late campaign a reaction test.
// 2. Board length does not climb hard with difficulty either; that was the same ramp
//    wearing a different hat, and it made every late board a long board.
//
// The difficulty index `d` runs 0 -> 34 and now drives only the shape of the LINE —
// amplitude, frequency, tolerance, zigzag and detail.

import { clamp, makeRng } from './rng.js';

// Workshops are paired to materials, not cycled independently — a copper sheet on a
// pine carpentry bench reads as a mistake. Each is a complete environment: bench
// colour and grain, light colour and temperature, ambient shadow, machine finish.
export const WORKSHOPS = {
  carpentry: {
    name: "Carpenter's Bench", bench: [122, 86, 53], grain: [92, 62, 38],
    light: [255, 226, 168], amb: [46, 58, 66], plate: [168, 176, 184], boards: 'wood',
  },
  furniture: {
    name: 'Furniture Shop', bench: [96, 62, 40], grain: [66, 42, 26],
    light: [255, 214, 156], amb: [44, 44, 52], plate: [176, 172, 164], boards: 'wood',
  },
  luthier: {
    name: "Luthier's Studio", bench: [64, 44, 34], grain: [42, 28, 21],
    light: [255, 204, 150], amb: [26, 24, 32], plate: [158, 152, 146], boards: 'wood',
  },
  barn: {
    name: 'Old Barn', bench: [128, 124, 110], grain: [92, 90, 80],
    light: [226, 240, 214], amb: [44, 54, 46], plate: [150, 152, 148], boards: 'wood',
  },
  fab: {
    name: 'Metal Fab Shop', bench: [96, 104, 116], grain: [66, 74, 86],
    light: [214, 238, 255], amb: [26, 38, 54], plate: [196, 204, 212], boards: 'steel',
  },
  foundry: {
    name: 'The Foundry', bench: [74, 56, 46], grain: [48, 34, 28],
    light: [255, 178, 96], amb: [42, 24, 18], plate: [186, 156, 120], boards: 'steel',
  },
  // Added 2026-09-26 with the bigger roster: driftwood on a carpentry bench, or
  // Damascus in a sheet-metal shop, reads as a mistake the same way copper on pine did.
  boathouse: {
    name: 'Boathouse', bench: [150, 142, 124], grain: [112, 104, 90],
    light: [236, 244, 255], amb: [40, 56, 70], plate: [170, 176, 180], boards: 'wood',
  },
  forge: {
    name: "Blacksmith's Forge", bench: [62, 50, 44], grain: [40, 32, 28],
    light: [255, 150, 80], amb: [40, 20, 14], plate: [150, 130, 110], boards: 'steel',
  },
  cold: {
    name: 'Cold Store', bench: [122, 146, 164], grain: [88, 112, 132],
    light: [226, 246, 255], amb: [30, 52, 72], plate: [196, 210, 222], boards: 'steel',
  },
};

// `line` is the guide-line colour, chosen to stay high-contrast on that material.
// `sound` selects the audio profile. `dust` drives the particle colour.
export const MATERIALS = {
  pine:      { tex: 'pine', kind: 'wood', shop: 'carpentry', dust: [232, 202, 152], line: '#8ff2ff', glow: 'rgba(80,230,255,0.85)', sound: 'softwood', name: 'Pine' },
  maple:     { tex: 'maple', kind: 'wood', shop: 'carpentry', dust: [240, 216, 180], line: '#5fe4ff', glow: 'rgba(50,210,255,0.85)', sound: 'softwood', name: 'Maple' },
  oak:       { tex: 'oak', kind: 'wood', shop: 'furniture', dust: [206, 166, 116], line: '#8ff2ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: 'Oak' },
  cherry:    { tex: 'cherry', kind: 'wood', shop: 'furniture', dust: [196, 138, 100], line: '#9ef7ff', glow: 'rgba(90,235,255,0.88)', sound: 'hardwood', name: 'Cherry' },
  walnut:    { tex: 'walnut', kind: 'wood', shop: 'luthier', dust: [128, 92, 62], line: '#a8f8ff', glow: 'rgba(110,240,255,0.9)', sound: 'hardwood', name: 'Walnut' },
  ebony:     { tex: 'ebony', kind: 'wood', shop: 'luthier', dust: [92, 78, 70], line: '#b6faff', glow: 'rgba(130,245,255,0.95)', sound: 'hardwood', name: 'Ebony' },
  weathered: { tex: 'weathered', kind: 'rotten', shop: 'barn', dust: [168, 164, 150], line: '#ffe14d', glow: 'rgba(255,220,70,0.9)', sound: 'rotten', name: 'Barn Board' },
  steel:     { tex: 'steel', kind: 'metal', shop: 'fab', dust: [220, 234, 246], line: '#ff7a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', name: 'Steel' },
  copper:    { tex: 'copper', kind: 'metal', shop: 'foundry', dust: [255, 168, 110], line: '#5fe4ff', glow: 'rgba(60,220,255,0.9)', sound: 'metal', name: 'Copper' },
  brass:     { tex: 'brass', kind: 'metal', shop: 'foundry', dust: [255, 214, 120], line: '#3ad6ff', glow: 'rgba(40,200,255,0.9)', sound: 'metal', name: 'Brass' },
  ice:       { tex: 'ice', kind: 'ice', shop: 'cold', dust: [214, 244, 255], line: '#ff6a3d', glow: 'rgba(255,120,60,0.9)', sound: 'ice', name: 'Ice' },
  // Added 2026-09-19. Six woods of which four were brown meant the material a level
  // was cut from stopped carrying information after the first hour. These three are
  // picked for colour and pattern, not for another brown: the palest board in the
  // game, the highest-contrast one, and the only one that is not on the yellow-brown
  // axis at all. Blued steel is the dark end of the metals, so a metal board is not
  // always a bright one.
  birch:     { tex: 'birch', kind: 'wood', shop: 'carpentry', dust: [238, 226, 178], line: '#2bb8ff', glow: 'rgba(40,180,255,0.85)', sound: 'softwood', name: 'Birch' },
  zebrano:   { tex: 'zebrano', kind: 'wood', shop: 'furniture', dust: [206, 170, 116], line: '#7df0ff', glow: 'rgba(80,230,255,0.9)', sound: 'hardwood', name: 'Zebrano' },
  purpleheart: { tex: 'purpleheart', kind: 'wood', shop: 'luthier', dust: [150, 96, 140], line: '#9dffc8', glow: 'rgba(120,255,190,0.9)', sound: 'hardwood', name: 'Purpleheart' },
  // `sheen` scales the specular pass: lit as hard as bright steel, blued steel comes
  // out white down the middle and stops being the dark metal in the set.
  blued:     { tex: 'blued', kind: 'metal', shop: 'fab', dust: [188, 206, 236], line: '#ff8a3d', glow: 'rgba(255,140,60,0.9)', sound: 'metal', sheen: 0.45, name: 'Blued Steel' },

  // --- 2026-09-26: 15 -> 48 boards. The owner: "there are dozens of vastly different
  // looking woods and at least a few different types of metal". Each was picked
  // because it LOOKS different, not because it has another name — see gen_wood.py.
  redwood: { tex: 'redwood', kind: 'wood', shop: 'furniture', dust: [214, 130, 96], line: '#8ff2ff', glow: 'rgba(80,230,255,0.85)', sound: 'softwood', name: "Redwood" },
  padauk: { tex: 'padauk', kind: 'wood', shop: 'furniture', dust: [236, 120, 70], line: '#7df0ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Padauk" },
  bloodwood: { tex: 'bloodwood', kind: 'wood', shop: 'luthier', dust: [170, 60, 52], line: '#a8f8ff', glow: 'rgba(110,240,255,0.9)', sound: 'hardwood', name: "Bloodwood" },
  yellowheart: { tex: 'yellowheart', kind: 'wood', shop: 'carpentry', dust: [244, 214, 110], line: '#2f7dff', glow: 'rgba(40,110,255,0.85)', sound: 'hardwood', name: "Yellowheart" },
  teak: { tex: 'teak', kind: 'wood', shop: 'furniture', dust: [204, 160, 100], line: '#8ff2ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Teak" },
  mahogany: { tex: 'mahogany', kind: 'wood', shop: 'furniture', dust: [176, 96, 66], line: '#9ef7ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Mahogany" },
  ash: { tex: 'ash', kind: 'wood', shop: 'carpentry', dust: [232, 218, 190], line: '#2bb8ff', glow: 'rgba(40,150,255,0.85)', sound: 'hardwood', name: "Ash" },
  holly: { tex: 'holly', kind: 'wood', shop: 'carpentry', dust: [244, 240, 228], line: '#1f8fff', glow: 'rgba(30,140,255,0.85)', sound: 'hardwood', name: "Holly" },
  cedar: { tex: 'cedar', kind: 'wood', shop: 'furniture', dust: [210, 140, 120], line: '#7df0ff', glow: 'rgba(80,230,255,0.85)', sound: 'softwood', name: "Red Cedar" },
  rosewood: { tex: 'rosewood', kind: 'wood', shop: 'luthier', dust: [120, 64, 50], line: '#a8f8ff', glow: 'rgba(110,240,255,0.9)', sound: 'hardwood', name: "Rosewood" },
  wenge: { tex: 'wenge', kind: 'wood', shop: 'luthier', dust: [96, 70, 50], line: '#b6faff', glow: 'rgba(130,245,255,0.95)', sound: 'hardwood', name: "Wenge" },
  bubinga: { tex: 'bubinga', kind: 'wood', shop: 'furniture', dust: [200, 120, 100], line: '#8ff2ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Bubinga" },
  bocote: { tex: 'bocote', kind: 'wood', shop: 'luthier', dust: [216, 170, 96], line: '#2bb8ff', glow: 'rgba(40,150,255,0.85)', sound: 'hardwood', name: "Bocote" },
  ziricote: { tex: 'ziricote', kind: 'wood', shop: 'luthier', dust: [96, 82, 66], line: '#b6faff', glow: 'rgba(130,245,255,0.95)', sound: 'hardwood', name: "Ziricote" },
  olive: { tex: 'olive', kind: 'wood', shop: 'barn', dust: [226, 206, 162], line: '#2bb8ff', glow: 'rgba(40,150,255,0.85)', sound: 'hardwood', name: "Olive Wood" },
  rainbow: { tex: 'rainbow', kind: 'wood', shop: 'barn', dust: [200, 196, 160], line: '#ff7a3d', glow: 'rgba(255,130,60,0.9)', sound: 'softwood', name: "Rainbow Poplar" },
  spalted: { tex: 'spalted', kind: 'wood', shop: 'barn', dust: [226, 210, 176], line: '#1f9dff', glow: 'rgba(40,150,255,0.85)', sound: 'softwood', name: "Spalted Maple" },
  birdseye: { tex: 'birdseye', kind: 'wood', shop: 'carpentry', dust: [236, 218, 180], line: '#2bb8ff', glow: 'rgba(40,150,255,0.85)', sound: 'hardwood', name: "Bird's-Eye Maple" },
  burl: { tex: 'burl', kind: 'wood', shop: 'luthier', dust: [176, 122, 76], line: '#9ef7ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Walnut Burl" },
  lacewood: { tex: 'lacewood', kind: 'wood', shop: 'luthier', dust: [222, 170, 134], line: '#2fd0ff', glow: 'rgba(80,230,255,0.85)', sound: 'hardwood', name: "Lacewood" },
  bamboo: { tex: 'bamboo', kind: 'wood', shop: 'carpentry', dust: [226, 200, 140], line: '#2bb8ff', glow: 'rgba(40,150,255,0.85)', sound: 'hardwood', name: "Bamboo" },
  // Charred is the only board with an orange line: embers on charcoal.
  charred: { tex: 'charred', kind: 'wood', shop: 'barn', dust: [70, 66, 62], line: '#ffb347', glow: 'rgba(255,170,70,0.9)', sound: 'softwood', name: "Charred Pine" },
  painted: { tex: 'painted', kind: 'wood', shop: 'barn', dust: [120, 170, 160], line: '#ff6a3d', glow: 'rgba(255,120,60,0.9)', sound: 'softwood', name: "Painted Board" },
  driftwood: { tex: 'driftwood', kind: 'wood', shop: 'boathouse', dust: [214, 208, 194], line: '#1f9dff', glow: 'rgba(40,150,255,0.85)', sound: 'softwood', name: "Driftwood" },
  aluminium: { tex: 'aluminium', kind: 'metal', shop: 'fab', dust: [220, 226, 232], line: '#ff6a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', sheen: 0.9, name: "Aluminium" },
  gold: { tex: 'gold', kind: 'metal', shop: 'foundry', dust: [255, 220, 120], line: '#3ad6ff', glow: 'rgba(40,200,255,0.9)', sound: 'metal', sheen: 1, name: "Gold" },
  damascus: { tex: 'damascus', kind: 'metal', shop: 'forge', dust: [210, 216, 226], line: '#ff8a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', sheen: 0.6, name: "Damascus Steel" },
  bolted: { tex: 'bolted', kind: 'metal', shop: 'fab', dust: [200, 210, 220], line: '#ff7a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', sheen: 0.8, name: "Bolted Plate" },
  diamond: { tex: 'diamond', kind: 'metal', shop: 'fab', dust: [214, 220, 228], line: '#ff6a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', sheen: 0.85, name: "Tread Plate" },
  rusted: { tex: 'rusted', kind: 'metal', shop: 'forge', dust: [196, 110, 60], line: '#5fe4ff', glow: 'rgba(60,220,255,0.9)', sound: 'metal', sheen: 0.25, name: "Rusted Steel" },
  titanium: { tex: 'titanium', kind: 'metal', shop: 'fab', dust: [190, 170, 200], line: '#39ff8a', glow: 'rgba(60,255,140,0.9)', sound: 'metal', sheen: 0.6, name: "Titanium" },
  galvanized: { tex: 'galvanized', kind: 'metal', shop: 'fab', dust: [210, 214, 220], line: '#ff6a3d', glow: 'rgba(255,130,60,0.9)', sound: 'metal', sheen: 0.8, name: "Galvanised Steel" },
  verdigris: { tex: 'verdigris', kind: 'metal', shop: 'foundry', dust: [120, 190, 160], line: '#ff5ad8', glow: 'rgba(255,90,216,0.9)', sound: 'metal', sheen: 0.3, name: "Verdigris Copper" },
};

// The order a player MEETS the boards in. Not pale-to-dark any more: neighbours on
// this list are picked to look as unlike each other as possible, so every new board
// is visibly new.
//
// 2026-09-28: the loud ones come FIRST. The old ladder opened pine, cherry, birch,
// walnut, oak, maple — and the owner, replaying from a reset, saw "mostly boring normal
// wood for the first 12 levels", which is exactly the window a new player decides
// whether to stay. Now the first dozen boards cover orange, dark brown, yellow, dark
// red, stripes, purple, spalting, near-black, burl and painted, and the plain pale
// woods are held back for later, where they read as a change of pace.
export const WOOD_LADDER = [
  'pine', 'padauk', 'walnut', 'yellowheart', 'bloodwood', 'zebrano', 'purpleheart',
  'spalted', 'wenge', 'burl', 'painted', 'redwood', 'bocote', 'birdseye', 'mahogany',
  'rainbow', 'lacewood', 'charred', 'cherry', 'bubinga', 'olive', 'ebony', 'bamboo',
  'teak', 'rosewood', 'driftwood', 'oak', 'cedar', 'maple', 'ziricote', 'birch', 'ash',
  'holly',
];
export const SPECIAL_CYCLE = [
  'steel', 'weathered', 'copper', 'bolted', 'ice', 'brass', 'damascus', 'rusted', 'blued',
  'diamond', 'aluminium', 'gold', 'titanium', 'verdigris', 'galvanized',
];

// Silly things embedded in the board. They sit ON the line, so collecting one means
// being genuinely accurate at that moment rather than just nearby.
// Salvage, not props. These are the hard little things that genuinely end up buried
// in reclaimed timber and would genuinely stop a blade — which is both why they are
// funny to hit and why they can be lit like real objects. See the odd-finds block in
// render.js for why the old cartoon set had to go.
export const OBJECT_TYPES = ['coin', 'watch', 'screw', 'nail', 'horseshoe', 'key'];

export const LEVEL_COUNT = 100;

// Which material a level is cut from.
//
// History: this banded six woods into six chapters (fourteen of the first sixteen
// levels were pine), then cycled a widening palette. With 33 woods and 15 specials
// (2026-09-26) plain cycling breaks down: a newly unlocked board can wait a whole
// cycle to turn up, and the cycle order becomes guessable. So:
//   * specials land on every level n % 5 === 3 (20%), never on a breather, and go
//     through SPECIAL_CYCLE in order — all fifteen are met in the campaign;
//   * the wood palette widens one board every ~2.3 levels, all 33 by level ~76;
//   * a wood that has been unlocked but never played is played NEXT, so every new
//     board is met the moment it arrives;
//   * otherwise a deterministic hash picks among the unlocked woods, skipping the last
//     six played, so neighbours always differ and nothing settles into an A-B-A-B.
const materialCache = [];

function materialFor(n) {
  if (materialCache[n]) return materialCache[n];
  // Resolved in order: each level's choice depends on the ones before it.
  for (let k = materialCache.length || 1; k <= n; k++) {
    if (!materialCache[k]) materialCache[k] = materialForRaw(k);
  }
  return materialCache[n];
}

// One new board EVERY level for the first 20 (so no repeat at all in that stretch —
// the "fresh first" rule below plays each one as it arrives), then one every ~5 levels
// so late levels still meet new boards; all 33 by level ~75.
function woodsUnlocked(n) {
  const early = n <= 20 ? 1 + n : 21 + Math.floor((n - 20) / 4.6);
  return clamp(early, 2, WOOD_LADDER.length);
}

function materialForRaw(n) {
  if (n % 5 === 3) return SPECIAL_CYCLE[Math.floor((n - 3) / 5) % SPECIAL_CYCLE.length];
  const pool = WOOD_LADDER.slice(0, woodsUnlocked(n));
  const played = [];
  for (let k = 1; k < n; k++) played.push(materialCache[k]);
  const fresh = pool.find((w) => !played.includes(w));
  if (fresh) return fresh;
  // Skip the last six played — or, while the pool is small, all but one of it.
  const recent = played.filter((m) => pool.includes(m)).slice(-Math.min(6, pool.length - 1));
  const options = pool.filter((w) => !recent.includes(w));
  let h = (n * 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;          // >>> 0: XOR returns a SIGNED int
  return options[h % options.length];
}

// The one place the campaign curve is defined. Every fifth level after the fourth is
// a deliberate breather: unbroken escalation causes churn spikes.
export function difficultyFor(n) {
  const breather = n % 5 === 0 && n > 4;
  const u = clamp((n - 1) / (LEVEL_COUNT - 1), 0, 1);
  // Owner, 2026-10-04: ramp up a little quicker. Same ceiling (34 at level 100), but
  // more of it arrives early: 30u + 4u^2 against the old 22u + 12u^2 puts level 10 at
  // d 2.8 (was 2.1), level 25 at 7.5 (was 6.0) and level 50 at 15.8 (was 13.8).
  const raw = 30 * u + 4 * u * u;
  return { breather, d: breather ? Math.max(0, raw - 1.6) : raw };
}

// The texture a campaign level's board is cut from — for prefetching, so no plank
// needs building to know it.
export function levelTex(n) {
  return MATERIALS[materialFor(clamp(n, 1, LEVEL_COUNT))].tex;
}

// Cheap read-only summary for the level-select grid: no plank is generated, so
// drawing a hundred cells costs nothing.
export function levelPreview(n) {
  const mat = MATERIALS[materialFor(n)];
  const c = mat.dust;
  return {
    material: mat.name,
    tex: mat.tex,
    colour: `rgb(${c[0]},${c[1]},${c[2]})`,
    special: mat.kind !== 'wood',
  };
}

// The shape every board shares, whether it came from the campaign or from Endless.
// `d` is the difficulty index; everything else is derived from it so there is exactly
// one place where "harder" is defined.
// The campaign's one feed speed. Difficulty does NOT touch it.
//
// It used to run 200 -> 400 px/s across the hundred levels, which meant "harder" and
// "faster" were the same word and the late campaign was mostly a reaction test. Speed
// is now a GIMMICK (see GIMMICKS below): a level is fast because it announced itself as
// a fast level, not because the player has been playing for twenty minutes. Endless
// keeps its own speed axis, because there the player picks it.
// 250 until 2026-10-04; the owner asked for the boards to feed a little faster.
export const BASE_SPEED = 285;

function paramsFor(d) {
  return {
    speed: BASE_SPEED,
    amplitude: clamp(20 + 3.6 * d, 20, 150),
    frequency: clamp(0.85 + 0.082 * d, 0.85, 4.2),
    tolerance: clamp(30 - 0.66 * d, 9.5, 30),
    zigzag: clamp((d - 11) / 20, 0, 0.95),
    // Detail is the late-game difficulty lever that is not simply "bigger curves":
    // a fast, small-amplitude wander laid over the main line, so the line stops
    // being predictable from its own shape. See buildPlank in plank.js.
    detail: clamp((d - 14) / 18, 0, 1),
  };
}

// --- Gimmicks ---------------------------------------------------------------
//
// Every level from 4 onward has one, and the player is told what it is before the
// board starts moving (see the count-in in main.js). The campaign is only a hundred
// boards long and it is the whole game, so a level whose only distinguishing feature
// is a slightly larger `d` than the last one is a wasted level.
//
// A gimmick is a set of MULTIPLIERS over the parameters `paramsFor` produced, plus a
// name and a line of copy. Two can stack — "2x speed AND hard angles" is a different
// board from either — and the stacking is what lets ten gimmicks cover a hundred
// levels without the player seeing the same board twice in a row.
//
// `from` is the earliest level a gimmick may appear on, and it is not decoration.
// Levels 1-18 are the stretch that protects conversion (§1: a player who does not
// understand the game before the first curve is a lost player), and a first bake of
// this table put DOUBLE TIME on level 6 and FINE TOLERANCE on a 185-wide board at
// level 7. Variety early has to come from the gentle end of the list; the punishing
// gimmicks wait until the player has a technique to have disrupted.
export const GIMMICKS = {
  quick:   { name: 'QUICK FEED', blurb: 'A faster board than usual', speed: 1.45, weight: 3, from: 4 },
  salvage: { name: 'SALVAGE RUN', blurb: 'This board is full of buried metal', finds: 3, weight: 2, from: 4 },
  long:    { name: 'LONG HAUL', blurb: 'A long board. Hold it together', length: 1.75, weight: 2, from: 4 },
  wide:    { name: 'WIDE BOARD', blurb: 'Broad stock, and the line roams', width: 1.45, amp: 1.5, weight: 2, from: 5 },
  wander:  { name: 'DRIFTWOOD', blurb: 'The line refuses to sit still', detail: 1, weight: 2, from: 8 },
  narrow:  { name: 'NARROW STOCK', blurb: 'A thin board — barely room to correct', width: 0.56, weight: 2, from: 12 },
  sprint:  { name: 'SHORT SPRINT', blurb: 'Over fast, if you can keep up', length: 0.5, speed: 1.55, weight: 2, from: 14 },
  angular: { name: 'HARD ANGLES', blurb: 'No curves. Sharp corners only', zigzag: 1, freq: 1.15, weight: 3, from: 16 },
  tight:   { name: 'FINE TOLERANCE', blurb: 'The line will not forgive much', tol: 0.62, weight: 2, from: 20 },
  fast:    { name: 'DOUBLE TIME', blurb: 'The board feeds twice as fast', speed: 2.0, weight: 3, from: 24 },
  // The only gimmick that adds a VERB rather than a multiplier: the board arrives in
  // pieces and the player has to time a tap to cross each hole (see plank.js). It is
  // held back to the late campaign because it is the one thing in the game that is
  // not "follow the line", and a player still learning to follow the line does not
  // need a second thing to learn. It also forces a longer board — a jump board that
  // is over before the first hole is a lie told on the count-in.
  jump:    { name: 'BOARD JUMP', blurb: 'The board comes in pieces. Tap to jump the gap', jumps: 1, length: 1.3, weight: 3, from: 26 },
  jumpx:   { name: 'THREE PIECES', blurb: 'Two gaps to cross. Time them both', jumps: 2, length: 1.7, weight: 2, from: 58 },
};

const GIMMICK_IDS = Object.keys(GIMMICKS);

// Weighted bag of everything unlocked by level `n`, so the ones that change a board
// most come up most often once they are allowed at all.
function bagFor(n) {
  const out = [];
  for (const id of GIMMICK_IDS) {
    if (n >= GIMMICKS[id].from) for (let i = 0; i < GIMMICKS[id].weight; i++) out.push(id);
  }
  return out;
}

// Deterministic per level — the same level always announces the same gimmick, which is
// the whole point of a level being a fixed thing the player can learn and retry.
function hash(n, salt) {
  let h = (n * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Levels 1-3 are plain on purpose: they are the tutorial, and a player who does not yet
// know what the normal board is cannot be told that this one is unusual.
export const FIRST_GIMMICK_LEVEL = 4;

// Resolved forward from the first gimmick level and memoised.
//
// The anti-repeat rule has to compare against what the previous level ACTUALLY ended
// up with, not against its raw first pick — comparing against the raw pick let a
// swapped level collide with the next one anyway, and the campaign came out with
// QUICK FEED on levels 10 and 11 back to back. Resolving forward is the only way to
// know the real answer, so it is done once and cached.
const headlineCache = [];

function headline(n) {
  if (n < FIRST_GIMMICK_LEVEL) return null;
  if (headlineCache[n]) return headlineCache[n];
  for (let i = FIRST_GIMMICK_LEVEL; i <= n; i++) {
    if (headlineCache[i]) continue;
    const bag = bagFor(i);
    let pick = bag[hash(i, 1) % bag.length];
    // Two levels of lookback, not one: alternating A-B-A-B reads as just as much of a
    // rut as A-A does.
    const recent = [headlineCache[i - 1], headlineCache[i - 2]];
    for (let t = 0; t < 6 && recent.includes(pick); t++) {
      pick = bag[hash(i, 7 + t) % bag.length];
    }
    headlineCache[i] = pick;
  }
  return headlineCache[n];
}

export function gimmicksFor(n) {
  if (n < FIRST_GIMMICK_LEVEL) return [];
  // Breathers keep a gimmick but never a compound one — they are a rest from
  // escalation, not a rest from character.
  const breather = n % 5 === 0 && n > 4;
  const out = [headline(n)];
  // Pairs start once the player has seen the vocabulary on its own, and never on a
  // breather. Two speed gimmicks may not stack — 1.45 x 2.0 is not a board, it is a
  // cutscene.
  if (!breather && n >= 22 && hash(n, 2) % 100 < 34) {
    const bag = bagFor(n);
    const b = bag[hash(n, 3) % bag.length];
    if (b !== out[0] && !(GIMMICKS[out[0]].speed && GIMMICKS[b].speed)) out.push(b);
  }
  return out;
}

// Applies the gimmicks to a parameter set, and returns the label the player is shown.
function applyGimmicks(ids, p, size) {
  let finds = 0;
  for (const id of ids) {
    const g = GIMMICKS[id];
    if (g.speed) p.speed *= g.speed;
    if (g.freq) p.frequency = clamp(p.frequency * g.freq, 0.85, 5.0);
    if (g.zigzag != null) p.zigzag = Math.max(p.zigzag, g.zigzag);
    if (g.detail != null) p.detail = Math.max(p.detail, g.detail);
    if (g.tol) p.tolerance = Math.max(7.5, p.tolerance * g.tol);
    if (g.amp) p.amplitude = clamp(p.amplitude * g.amp, 20, 210);
    if (g.width) size.width *= g.width;
    if (g.length) size.length *= g.length;
    if (g.finds) finds += g.finds;
    if (g.jumps) size.jumps = (size.jumps || 0) + g.jumps;
  }
  return finds;
}

export function getLevel(n) {
  const { breather, d } = difficultyFor(n);
  const p = paramsFor(d);

  // Boards vary in size, and they vary FAR more than they used to.
  //
  // The old range was 190-470 wide, which sounds broad and did not read as broad:
  // most levels landed near the middle because the wobble was a sum of two sines and
  // a sum of two sines spends most of its time near zero. Three incommensurate terms
  // and a wider span fix that, and the gimmicks stretch it further still.
  //
  // The hard limit is the phone layout. The play column is 720 logical units, and a
  // board can slide sideways by `maxOffsetFor(width) = width/2 - 38` in each
  // direction, so the widest thing that can ever be on screen is about 2*width - 76.
  // WIDTH_MAX is set so that stays inside a phone's visible extent with the board at
  // full deflection; `buildPlank` also scales the line's swing to the board it is
  // drawn on, so a narrow board never becomes accidentally unplayable.
  const wob = (Math.sin(n * 1.7) + Math.sin(n * 0.53 + 1.1) + Math.sin(n * 0.29 + 2.7)) / 3;
  const size = {
    jumps: 0,
    width: 330 + wob * 165 - d * 1.1,
    // Length climbs only gently — it used to climb hard with difficulty, which was
    // the speed ramp wearing a different hat. The gentle slope is still worth having
    // because a board's LENGTH is how long a mistake stays survivable, and a beginner
    // wants a short one: at the fixed 250px/s, 2200 is about 9 seconds and 4200 about
    // 17. The gimmicks stretch it much further than the slope does.
    length: (2200 + 2000 * clamp((n - 1) / (LEVEL_COUNT - 1), 0, 1))
      * (1 + ((Math.sin(n * 0.91 + 2.3) + Math.sin(n * 2.13)) / 2) * 0.34),
  };

  const gimmickIds = gimmicksFor(n);
  const extraFinds = applyGimmicks(gimmickIds, p, size);

  const WIDTH_MIN = 165, WIDTH_MAX = 520;
  const width = Math.round(clamp(size.width, WIDTH_MIN, WIDTH_MAX));
  // A jump board needs room for the lead-in, the hole, and enough board after it to
  // recover on. SHORT SPRINT can otherwise halve a board below that, and buildPlank
  // would quietly produce no holes at all on a level that announced BOARD JUMP.
  // Enough board for the lead-in, each hole, and a stretch after the last one to
  // recover on. Kept as low as it can be: a floor high enough to catch most boards
  // would make every jump level the same length with the hole in the same place.
  const minLen = size.jumps ? 1900 + 900 * size.jumps : 1500;
  const length = Math.round(clamp(size.length, minLen, 11000));

  const mat = MATERIALS[materialFor(n)];

  // More salvage as the campaign goes on; never on the first few levels, so the
  // opening stays as simple as possible to read.
  let objectCount = 0;
  if (n >= 4) objectCount = 1;
  if (n >= 12) objectCount = 2;
  if (n >= 30) objectCount = 3;
  if (n >= 55) objectCount = 4;
  if (n >= 80) objectCount = 5;
  objectCount += extraFinds;

  return {
    n,
    breather,
    ...p,
    length,
    width,
    objectCount,
    jumps: size.jumps,
    material: mat,
    special: mat.kind !== 'wood',
    workshop: WORKSHOPS[mat.shop],
    seed: n * 7919 + 13,
    // What the player is told before the board starts. Null for levels 1-3.
    gimmicks: gimmickIds,
    gimmickName: gimmickIds.map((id) => GIMMICKS[id].name).join(' + ') || null,
    gimmickBlurb: gimmickIds.length ? GIMMICKS[gimmickIds[0]].blurb : null,
    // Every gimmick on the board, for the briefing card. A paired level used to show
    // only the first one's copy, so half of what made the board different went unsaid.
    briefing: gimmickIds.map((id) => ({ name: GIMMICKS[id].name, blurb: GIMMICKS[id].blurb })),
  };
}

// --- Endless ---------------------------------------------------------------
//
// Unlocked by finishing all LEVEL_COUNT campaign levels. The player picks the two
// axes that actually decide how a board feels — how fast it feeds, and how hard the
// line is to read — rather than one opaque "difficulty" number. Both pay: a harder
// choice is worth more coins, which is what stops everyone parking on the easiest
// setting forever.

export const ENDLESS_SPEEDS = [
  { name: 'Gentle', blurb: 'Slow feed, time to think', speed: 210, pay: 0.8 },
  { name: 'Steady', blurb: 'A working pace', speed: 262, pay: 1.0 },
  { name: 'Brisk', blurb: 'Faster than the campaign', speed: 320, pay: 1.3 },
  { name: 'Fast', blurb: 'Reads have to be instant', speed: 382, pay: 1.7 },
  { name: 'Reckless', blurb: 'Faster than anything in the game', speed: 450, pay: 2.2 },
];

// `d` here feeds the same paramsFor() the campaign uses, so "Twisty" means exactly
// the line shape a mid-campaign level has, and there is no second difficulty model
// to drift out of step with the first.
export const ENDLESS_LINES = [
  { name: 'Lazy', blurb: 'Long, open curves', d: 4, pay: 0.8 },
  { name: 'Wavy', blurb: 'Rolling, like level 30', d: 11, pay: 1.0 },
  { name: 'Twisty', blurb: 'Corners with a kick', d: 19, pay: 1.35 },
  { name: 'Jagged', blurb: 'Hard zigzags, tight margin', d: 27, pay: 1.8 },
  { name: 'Vicious', blurb: 'Past the end of the campaign', d: 36, pay: 2.4 },
];

export function endlessPayMult(speedTier, lineTier) {
  return +(ENDLESS_SPEEDS[speedTier].pay * ENDLESS_LINES[lineTier].pay).toFixed(2);
}

// `board` is 0-based within the run. A run tightens as it goes — +12% feed, −10%
// tolerance and +35% board length by board 24 — so an endless run has an arc of its
// own instead of being the same board forever.
// Which board an Endless run deals next — like a shuffled deck of cards.
//
// It used to walk WOOD_LADDER and SPECIAL_CYCLE in a fixed order and ignore the run's
// seed, so EVERY run opened Pine, Padauk, Walnut, Steel... and the last boards on the
// list only turned up after 65 boards, which almost no run reaches (one ruined board
// ends it). Now each run shuffles both lists from its own seed and deals through them
// with no repeats until every board has come up, then reshuffles — so any board can
// open a run, and a run of N boards shows N different ones (up to the list length).
// Deterministic per (seed, board), so a board is the same if it is ever rebuilt.
const deckCache = new Map();
function shuffledDeck(list, seed, pass) {
  const key = `${list.length}|${seed}|${pass}`;
  let d = deckCache.get(key);
  if (d) return d;
  const rng = makeRng((seed * 31 + pass * 7919 + 17) >>> 0);
  d = list.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  // Never deal the same board twice in a row across a reshuffle.
  if (pass > 0 && d.length > 1 && d[0] === shuffledDeck(list, seed, pass - 1)[d.length - 1]) {
    [d[0], d[1]] = [d[1], d[0]];
  }
  if (deckCache.size > 64) deckCache.delete(deckCache.keys().next().value);
  deckCache.set(key, d);
  return d;
}

function dealt(list, seed, k) {
  const n = list.length;
  return shuffledDeck(list, seed, Math.floor(k / n))[k % n];
}

export function endlessMaterial(board, runSeed) {
  if (board % 4 === 3) return dealt(SPECIAL_CYCLE, runSeed * 3 + 1, Math.floor(board / 4));
  // Index among the WOOD boards only (every 4th board is a special).
  return dealt(WOOD_LADDER, runSeed * 3 + 2, board - Math.floor((board + 1) / 4));
}

export function getEndlessLevel(speedTier, lineTier, board, runSeed) {
  const sp = ENDLESS_SPEEDS[clamp(speedTier, 0, ENDLESS_SPEEDS.length - 1)];
  const ln = ENDLESS_LINES[clamp(lineTier, 0, ENDLESS_LINES.length - 1)];
  const ramp = clamp(board / 24, 0, 1);
  const p = paramsFor(ln.d + ramp * 4);

  // Endless sets speed from the axis the PLAYER picked, overriding the campaign's
  // fixed BASE_SPEED. That is the one place speed is still a difficulty dial, and it
  // is legitimate there because the player chose it and is paid extra for it.
  p.speed = sp.speed * (1 + 0.12 * ramp);
  p.tolerance *= 1 - 0.10 * ramp;

  // Every fourth board is a special material, so the run keeps changing colour.
  const matKey = endlessMaterial(board, runSeed);
  const mat = MATERIALS[matKey];

  const wob = Math.sin(board * 1.7 + runSeed * 0.013) * 0.5 + Math.sin(board * 0.53 + 1.1) * 0.5;
  const width = Math.round(clamp(330 + wob * 120 - ln.d * 1.6, 190, 470));
  // Sized in SECONDS rather than pixels, so picking Reckless does not also mean
  // picking a board that is over in four of them.
  const seconds = (13 + ln.d * 0.12) * (1 + 0.35 * ramp) * (1 + wob * 0.12);
  const length = Math.round(clamp(p.speed * seconds, 2000, 11000));

  return {
    n: board + 1,
    breather: false,
    ...p,
    length,
    width,
    objectCount: 2 + Math.min(3, Math.floor(board / 6)),
    // Endless has no gimmicks to announce, but a run that never changes verb is the
    // mode's own failure mode, so every third board from the fifth comes in pieces.
    jumps: board >= 4 && board % 3 === 1 ? 1 : 0,
    material: mat,
    special: mat.kind !== 'wood',
    workshop: WORKSHOPS[mat.shop],
    seed: (runSeed * 2654435761 + board * 7919 + 13) % 2147483647,
    gimmicks: [],
    gimmickName: null,
    gimmickBlurb: null,
    // Endless has no gimmicks, but a board in pieces changes the VERB, and a player who
    // meets a hole unannounced learns what it is by falling into it.
    briefing: board >= 4 && board % 3 === 1
      ? [{ name: GIMMICKS.jump.name, blurb: GIMMICKS.jump.blurb }] : [],
    isEndless: true,
    endlessBoard: board + 1,
    speedName: sp.name,
    lineName: ln.name,
    payMult: endlessPayMult(speedTier, lineTier),
  };
}
