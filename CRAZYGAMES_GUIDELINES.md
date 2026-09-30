# Wood Cutting Game — Project Guidelines

> **Read this file before doing anything else in this project.**
> It is the source of truth for design, monetization, and CrazyGames compliance.
> When you change the game, update this file in the same session. Append to the Changelog at the bottom.

---

## 1. Prime directives

This game exists to make money through ad revenue on CrazyGames. Ad revenue is a function of **how long people play** and **how many come back**. CrazyGames publishes the exact numbers they measure during Basic Launch review:

| Metric | CrazyGames "strong game" | Hypercasual genre average | **Our target** |
|---|---|---|---|
| Average playtime | 10+ min | 8.6 min | **10+ min** |
| Day 1 retention | 10–15% | 6% | **12%+** |
| Conversion (played ≥1 min) | 80%+ | — | **80%+** |

**Every feature must defend one of these three numbers. If it defends none, do not build it.**

How each is won:

- **Conversion** is won in the first four seconds — load speed and instant comprehension. A player who doesn't understand the game before the first curve is a lost player.
- **Playtime** is won by the difficulty curve. Too hard early kills conversion; too flat late kills playtime.
- **D1 retention** is won by the meta layer — the Workshop and the daily challenge give a reason to come back tomorrow that the core loop alone cannot.

### The counter-intuitive money rule

CrazyGames states directly: *"The best monetizing games focus on player experience, not ad volume."* More ads suppress playtime, and playtime is the multiplier on every impression. **Never add an ad placement that costs session length.** Rewarded ads (opt-in) carry the highest eCPM and *improve* retention — they are the revenue centre, not midgame ads.

---

## 2. Game design spec

### Core loop

A plank of wood feeds downward into a fixed jigsaw blade. A bright guide line runs along the plank, curving and zigzagging. The player drags left/right to steer the plank so the blade tracks the line. Accuracy is scored; the cut plank becomes a board.

**The plank moves, not the blade.** This reads correctly as "feeding wood into a saw" and is why the input is horizontal.

### Controls

- **Touch:** drag anywhere in the lower screen area. Relative drag, not absolute positioning — the plank moves by the delta, so the player's thumb never has to be over the plank.
- **Keyboard:** arrow keys primary; `A`/`D` and `Q`/`D` both mapped so AZERTY layouts work without configuration (a CrazyGames quality requirement).
- **Mouse:** click-drag, same relative model as touch.
- **Default steering direction was flipped in save v10 (2026-09-28)**: by default a drag moves the saw across the board (drag left → board moves right). Old saves have `invert` flipped on load so they steer exactly as before. The pause menu's sub-label states the current behaviour.
- **Inverted steering** is a persisted option (Workshop → Settings). Players split on whether they are pushing the plank or moving the world under it; the flip is a single sign change applied where `input.take()` is consumed in `main.js`, and it is stored in `meta.settings.invert`.

Blade sits at **~62% screen height**, leaving the lower third clear for the thumb.

**Boards vary in length and width per level** (`levels.js`, deterministic from the
level number so a given level is always the same board). Width is not cosmetic: a
narrow board leaves less room to correct, so `buildPlank` scales the guide line's
amplitude to the board it is drawn on — otherwise a narrow plank becomes accidentally
unplayable. Nothing in `render.js` may assume a fixed `PLANK_WIDTH`; it reads
`cut.plank.width`, and the texture tile height is derived from it so grain never
stretches.

**The guide line must never terminate on screen.** It is drawn from `cut.s + L.h + 140` ahead of the blade down to `cut.s - ((L.h - L.bladeY) + 220)` behind it — i.e. it runs off the bottom edge. The stretch behind the blade is what lets the player compare their kerf against the line they were supposed to follow; a line that stops in mid-air removes that read-back exactly where it is most useful.

### Scoring

- `error = |bladeX − splineX(bladeY)|` in plank-local space, sampled every fixed logic tick.
- Graded bands: `perfect` → `good` → `ok` → `off`.
- **Going off the line accrues a damage meter — it does not fail you instantly.** This is what makes early levels forgiving and protects conversion.
- Failure only when the damage meter fills.
- Level score = accuracy integrated over plank length, **plus a craft bonus**, → **1, 2, or 3 stars**.

**Stars are scored on more than the line.** `cutScore = accuracy + craftBonus`, where the
craft bonus is worth at most `CRAFT_BONUS_MAX` (6 points of accuracy) and comes from what
the board offered BESIDES the line: the combo held through it, the salvage in it, and the
crossings on it. Without it, everything optional on a board is worth only coins, and a
player chasing three stars is right to ignore all of it.

Three rules hold it honest:
- **It is normalised over the components the board actually HAS** — combo always, finds
  only if the board carries any, jumps only if it has holes — so every board's maximum
  bonus is the same 6 points. Crediting the absent ones in full would turn the bonus into
  a flat discount on the star thresholds.
- **The combo component is normalised against the highest tier THAT board can reach**,
  not the top of the table. Tier 4 needs 18 unbroken seconds and most campaign boards run
  9-17, so scoring against the absolute maximum would quietly make short boards worth less
  craft than long ones for an equally clean run.
- **The craft bonus can never manufacture a FLAWLESS.** That tier is scored on raw
  accuracy and nothing optional on the board may buy it; `cutScore` is capped just under
  `FLAWLESS_AT` for exactly that reason, and the purple gate on the results meter is the
  one gate tested against accuracy rather than score.

**The results meter shows both parts as separate segments** — the cut itself in the
accuracy gradient, the bonus as a STRIPED extension in the same gradient — with the
header reading "Accuracy 85%  +5% craft". A bar that quietly folded the bonus into the
accuracy fill would be back to showing a number the player cannot act on.

Two rules from the owner's screenshot of a 99% + 6% cut (2026-09-21), where the bar
ran straight past an UNLIT fourth star and then turned orange for its last few pixels:
- **Every value is plotted through the gates' own positions** (`xOf` in
  `drawComplete`), never as `width * value`. The end gates are pulled in off the bar's
  rounded caps, so a linear bar put 99.5% nine units beyond its own gate. And a cut
  that has not cleared the purple gate stops visibly SHORT of it.
- **The bar never changes colour at the craft seam.** The bonus was solid gold on the
  end of a gradient that is purple at the top, which read as a rendering fault. It is
  told apart by texture instead: the same gradient, dimmed, under diagonal stripes.

**The SPLIT meter shows one quantity in two zones.** Up to `SPLIT_STRAIN_SPAN` (45% of
the track) it is live *strain* — how far off the line the blade is right now, which costs
nothing and can always be walked back. Past that line it is real damage, and the end of
the track is failure. A tick marks where one becomes the other.

It used to show damage alone, and damage only moves in the `off` band — so a player who
is tracking the line at all never saw the bar move and the owner reported it as
"doesn't fill up or do anything". **A meter that reads as broken is worse than no meter**,
and this one is the only warning the player gets before a run ends. Strain is computed in
`stepCut` with a fast attack and a slow release so a wobble is felt at once but the bar
does not flicker while the blade hunts.

### The flawless cut

Three gold stars is the ceiling of the normal scale, so a **100% cut** (`isFlawless`,
`acc >= 0.995` — anything the panel rounds to "100%" must actually pay out, or the
player is right to call it a bug) awards a **fourth star, in purple**, under the title
FLAWLESS. It is a different colour rather than a fourth gold one precisely so it reads
at a glance as something the normal scale cannot express. It lands with a real
celebration — `A.bigFanfare()` (boom, noise crack, doubled arpeggio, sustained pad),
a heavy shake, three expanding rings, 190 confetti, sparks, and a second wave a beat
later so the moment has a shape instead of being one frame of everything at once.

**The results panel carries an accuracy METER, not just a number.** It fills to the
accuracy actually cut and carries a marked gate for every star — 76%, 93%, 100% — lit
if cleared and outlined if not, with a line reading "N% short of 3 stars" underneath.
A bare "Accuracy 88%" tells the player the number but not what it was worth; "4% short
of 3 stars" is a reason to tap Retry. `STAR_AT` is exported from `plank.js` so the
thresholds and the meter cannot drift apart.

### Difficulty curve

Levels are generated procedurally from a per-level parameter set, all of it derived from
one difficulty index `d` in `paramsFor()`, so "harder" is defined in exactly one place
and the campaign and Endless cannot drift apart.

**The campaign is exactly `LEVEL_COUNT` = 100 levels, and then hands over to Endless.**
A finite campaign is a better shape than an infinite one: it can be *finished*, which is
a goal worth returning for.

**Feed speed is NOT a difficulty lever.** The campaign runs at a fixed `BASE_SPEED` of
250px/s from level 1 to level 100. It used to ramp 200 → 400 across the campaign, which
made "harder" and "faster" the same word and turned the late campaign into a reaction
test. A board is fast now only because it is a *fast level* and said so before it
started. Endless keeps a speed axis because there the player picks it and is paid extra
for it.

What `d` still drives: curve amplitude, line frequency, tolerance width, zigzag blend
and `detail`. `d = 22u + 12u²` over `u = (n-1)/99`, running 0 → 34, deliberately not
linear — the linear term protects the opening levels where conversion is won, the
quadratic steepens the last quarter.

**Every 5th level after the 4th is a deliberate easy breather.** Unbroken difficulty
escalation causes churn spikes. A breather still gets a gimmick, but never a compound
one: it is a rest from escalation, not a rest from character.

### Every level has a gimmick, and the player is told before it starts

From level 4 on, every level carries one or two **gimmicks** from the table in
`levels.js` — DOUBLE TIME (2x feed), QUICK FEED, HARD ANGLES (no curves, corners only),
NARROW STOCK, WIDE BOARD, FINE TOLERANCE, LONG HAUL, SHORT SPRINT, DRIFTWOOD (the line
will not sit still), SALVAGE RUN, and BOARD JUMP / THREE PIECES (the board arrives in
pieces — see "The jump" below). All but the last two are multipliers over the parameters
`d` produced, plus a name and a line of copy.

The campaign is only a hundred boards and it is the whole game, so a level whose only
distinguishing feature is a slightly larger `d` than the last one is a wasted level.
Pairing is what lets ten gimmicks cover a hundred levels: "2x speed AND hard angles" is
a different board from either.

Four rules, each of which a first version got wrong:

- **Levels 1-3 are plain.** A player who does not yet know what a normal board is cannot
  be told that this one is unusual.
- **Every gimmick has a `from` level.** The first bake put DOUBLE TIME on level 6 and
  FINE TOLERANCE on a 185-wide board at level 7. Levels 1-18 are the stretch that
  protects conversion; early variety comes from the gentle end of the list (LONG HAUL,
  WIDE BOARD, SALVAGE RUN) and the punishing ones wait until there is a technique to
  disrupt. DOUBLE TIME does not appear before level 24.
- **The player is told what it is BEFORE the board moves, and has to acknowledge it.**
  A level that is different without saying so teaches itself by failing the player,
  which reads as unfairness rather than variety. It used to be a banner shown during
  the 3-2-1 — three seconds in which the player is watching the numbers, so the owner
  found it easy to miss. It is now a **briefing card** (`drawBriefing`): big, centred,
  every gimmick on the board listed with its line of copy, and the count-in does not
  start until the player taps GOT IT (or Space/Enter). The board is held exactly as
  it is during a count-in. A 0.45s floor stops the release of the tap that started
  the board from also dismissing the card, and an immediate retry of the same board
  skips it (they have just read it). Endless jump boards get the card too — a board in
  pieces changes the verb, whatever mode it is in.
- **Anti-repeat resolves FORWARD and looks back two levels.** Comparing a level's pick
  against the previous level's *raw* pick is not enough — a level that was itself
  swapped can still collide — and one level of lookback lets A-B-A-B through, which is
  as much of a rut as A-A. `headline()` resolves the whole run once and memoises it.
- **Two speed gimmicks never stack.** 1.45 × 2.0 is not a board, it is a cutscene.

### The jump

BOARD JUMP (one hole, from level 26) and THREE PIECES (two holes, from level 58) are the
only gimmicks that add a **verb** instead of a multiplier. The board arrives in pieces
with a hole between them, and each piece's line sits on a different side of the board, so
the player has to cross.

- **Over a hole, steering is dead.** There is no board under the blade to push. This is
  the whole mechanic: without it the player simply drags across during the gap and the
  tap is decoration. It is also self-explaining — the controls going quiet is felt.
- **A tap crosses.** Anywhere on the board, or Space. It fires on pointer-DOWN, not on
  release: it is a timing input and waiting for the finger to lift costs a tenth of a
  second nobody was told about. **Lifting the finger also crosses**, because steering is
  a drag and a player can easily be mid-drag when a hole arrives — "tap" would then mean
  lift-and-press, two actions inside a one-second window. Either edge counts; the first
  one wins.
- **The ideal instant is `JUMP_IDEAL = 0.72` through the hole** — just before the next
  piece reaches the blade, which is the moment a jump reads as landing ON something —
  with a ±0.17 window. A perfect tap lands the blade exactly on the new line and pays
  `JUMP_BONUS`. Outside the window the landing error grows with the timing error and is
  signed: tapping early lands short of the new line, tapping late overshoots it.
- **Missing the jump entirely is not an instant loss.** The blade lands wherever it was,
  which is off the line, and the player has to correct hard and loses the combo. A
  gimmick that ends a run on one missed tap is a gimmick players quit over.
- **Nothing comes off a blade that is over a hole** — no spray, no cutting note, no heat,
  no damage, no accuracy accrued or lost, and the contact reticle goes neutral grey
  rather than showing the worst band. A blade throwing sawdust into a hole is the
  loudest possible tell that the hole is not really there.
- **The line's swing is halved on a jump board** and each piece is shifted sideways by
  `JUMP_SHIFT` of the usable half-width, with the swing clamped against the room LEFT
  OVER after the shift. Otherwise the crossing has to be paid for by clamping the line
  flat against the board's edge, which is the difficulty inversion §2 already warns about.
- **A rewarded continue re-arms every hole the blade has been pushed back in front of**
  (`rearmJumps`), and never leaves the blade hanging over one. A board handed back with
  a spent crossing in it is unwinnable through no fault of the player.
- Endless has no gimmicks to announce, so it takes a jump board **every third board from
  the fifth** — a run that never changes verb is that mode's own failure mode.

### Board size

**Boards vary a lot, in both dimensions,** deterministically from the level number so a
given level is always the same board. Width runs 165-520 and length 1500-8000+.

The old range was nominally 190-470 and did not read as varied, because the wobble was a
sum of two sines and a sum of two sines spends most of its time near its middle. It is
three incommensurate terms now, and NARROW STOCK / WIDE BOARD / LONG HAUL / SHORT SPRINT
stretch it much further than the base curve does.

**The limit is the phone layout.** The play column is 720 logical units and a board can
slide sideways by `maxOffsetFor(width) = width/2 - 38` either way, so the widest thing
that can be on screen is about `2*width - 76`. Width is not cosmetic: a narrow board
leaves less room to correct, and `buildPlank` scales the guide line's amplitude to the
board it is drawn on — otherwise a narrow plank becomes accidentally unplayable. Nothing
in `render.js` may assume a fixed `PLANK_WIDTH`.

**Length climbs only gently** (2200 → 4200 base across the campaign). It used to climb
hard with `d`, which was the speed ramp wearing a different hat and made every late
board a long board. A board's length is how long a mistake stays survivable, so a
beginner wants a short one.

### Endless

**Unlocked by finishing all 100 levels** (checked against the star record for level 100, not `maxLevel`, which only means the level was started). It is shown locked on the main menu and at the foot of the level select from the first session, because a mode the player cannot see is a mode that does not pull them through the campaign.

The player picks **two axes, not one difficulty number**: board speed (Gentle → Reckless, 210 → 450 px/s) and line complexity (Lazy → Vicious, which feed the same `paramsFor()` the campaign uses, so "Twisty" is literally a mid-campaign line). Two axes because they are the two things that actually decide how a board plays, and a player who can read fast boards but not zigzags — or the reverse — can say so.

- **Both raise the coin multiplier** (0.64x → 5.28x), shown as its own line on the results panel. Without that, the easiest setting is the only rational choice.
- **A run tightens as it goes**: +12% feed, −10% tolerance and +35% board length by board 24, so a long run has an arc instead of being the same board forever.
- **One ruined board ends the run**, and the rewarded continue is **once per RUN**, not once per board — otherwise the run has no end and the record means nothing.
- **Records are kept per difficulty pair.** Twenty boards on Gentle/Lazy is not the same feat as twenty on Reckless/Vicious, and one shared record would make the easy settings the only place a record can be set.
- Endless boards do **not** write into the campaign's star record, but they do bank lifetime stars, coins, quests and keys — the meta layer stays connected.

### Four-second comprehension

The player lands on the **main menu**, with a single dominant PLAY button that resumes the level they were on — one tap to gameplay, which is the platform's stated limit. The menu is not allowed to cost the four seconds:

- **The game is running behind it.** A board of the player's current level feeds through the saw and is cut perfectly, under a graded veil. The first thing on screen is the game, not a title card over a flat colour. (An earlier flat 0.78 veil over the bare bench made the backdrop read as a black screen with a stripe on it.)
- **PLAY is the only tall button**, at the top, in the primary colour. Everything else is a smaller row or a 2×2 grid beneath it.
- The menu answers "where am I up to" without a tap: coins, stars, `LEVEL n OF 100` and a progress rule.

Once in the cut, a pulsing directional hint plus the visible saw/line relationship carries the explanation. One diegetic "follow the line" cue fades after the first curve. Fully skippable.

**Why a menu exists at all**, given the section above used to say the opposite: with no home screen, level select, the Workshop, the Build project and the saw upgrades only existed behind a gear on the play HUD, and the owner went looking for them and could not find them — twice, on two different passes. The two-tap rule in "Discoverability" below was the first attempt at fixing that and it was not enough. **A player who has just launched the game should be able to see everything the game contains without tapping anything.** The cost is one tap; the thing it buys is that no feature can go missing again.

### Materials and environments

Every level pairs a **material** with the **workshop it would actually be cut in** — a copper sheet on a pine carpentry bench reads as a mistake. Defined in `src/levels.js`:

| Materials | Workshop | Feel |
|---|---|---|
| Pine, Birch, Maple, Ash, Holly, Bamboo, Yellowheart, Bird's-Eye Maple | Carpenter's Bench | light woods, amber light |
| Oak, Zebrano, Cherry, Teak, Mahogany, Redwood, Red Cedar, Bubinga, Padauk | Furniture Shop | the reds and golds, one bold stripe |
| Walnut, Purpleheart, Ebony, Rosewood, Wenge, Bloodwood, Bocote, Ziricote, Walnut Burl, Lacewood | Luthier's Studio | dark, figured, moody |
| Barn Board, Charred Pine, Spalted Maple, Painted Board, Olive Wood, Rainbow Poplar | Old Barn | worn, marked, surprising |
| Driftwood | Boathouse | sea-bleached, cool daylight |
| Steel, Blued Steel, Aluminium, Bolted Plate, Tread Plate, Galvanised Steel, Titanium | Metal Fab Shop | cool blue-white, harsh |
| Copper, Brass, Gold, Verdigris Copper | The Foundry | hot orange light |
| Damascus Steel, Rusted Steel | Blacksmith's Forge | dark, fire-lit |
| Ice | Cold Store | pale blue, cold |

**Forty-eight boards (2026-09-26), each chosen because it LOOKS different.** The owner's
note was that there are "dozens of vastly different looking woods and at least a few
different types of metal" — and the game had nine woods, most of them brown. The rule
for adding one is that it must be recognisable at a glance by something no other board
has: a colour (padauk's orange, yellowheart, bloodwood, holly's white, rainbow poplar's
green and purple), a figure (bird's-eye, burl, spalting's black zone lines, olive and
ziricote's wild contours, lacewood's flecks), a surface (driftwood, charred shou-sugi-ban,
chipped paint, bamboo strips) or, for metals, a structure (Damascus layers, bolt heads,
tread-plate lugs, galvanised spangle, verdigris patina, titanium's heat-tint rainbow).
Another brown with another name does not qualify.

**Textures must tile vertically, and nothing in one may be a straight full-width line.**
A board is one repeating pattern fill (see "The board is one pattern fill" in §6), so
the top row of a texture meets its bottom row every 1024px; a Voronoi grid that does not
divide 512x1024 exactly (charred used 24) or a `sin(y)` term (galvanised) leaves a seam
exactly where the owner already reported one. `gen_wood.py`'s additions are checked by
comparing row 0 against row 1023 relative to the texture's own 99th-percentile row
difference. `python3 tools/gen_wood.py --more` regenerates only the 2026-09-26 boards.

**Board textures load on demand.** Boot awaits only the boards for the player's current
level and the next two; the rest stream in two at a time after the first frame
(`R.ensureTexture` / `R.streamTextures`), and `beginBoard` asks for its own board and
the next level's. With 48 boards (~2.6 MB) awaiting the whole set would have put the
entire roster in front of the first frame, which is where §1 says conversion is won.
The background list is still derived from `MATERIALS`, never written out.

A material may carry **`sheen`**, a scale on the whole specular pass — both the moving
highlight and the shading gradient that supplies most of a metal board's light. Blued
steel lit as hard as bright steel comes out white down the middle and stops being the
dark metal in the set, which is the only reason it exists.

**The loud boards come first (2026-09-28).** The owner replayed from a reset and saw
"mostly boring normal wood for the first 12 levels" — the old `WOOD_LADDER` opened pine,
cherry, birch, walnut, oak, maple, and the slow pool repeated them. That is exactly the
window a new player decides whether to stay, so the ladder now opens on the most
visually different boards (padauk orange, walnut dark brown, yellowheart, bloodwood dark
red, zebrano stripes, purpleheart, spalted, wenge, burl, painted…) and holds the plain
pale woods back for later. The pool also grows by one board EVERY level for the first
20, then one every ~4.6 levels. Measured: 12 distinct boards in levels 1-12, 20 in
1-20, all 48 in the campaign, the last new one at level 76, no adjacent repeats. Level 1
stays pine on purpose — the tutorial board wants the calmest grain.

**Which board a level gets** (rewritten 2026-09-26 for the bigger roster): specials on
every level where n % 5 === 3, walking `SPECIAL_CYCLE` so all fifteen are met in the
campaign; the wood pool widens (see above); a wood that is
unlocked but not yet played is played NEXT, so each new board is met as it arrives;
otherwise a hash picks from the pool skipping the last six played. Measured: all 48
boards appear in the 100 levels, 15 distinct in the first 20, no adjacent repeats, no
A-B-A-B runs, nothing above 6%.

**(Superseded) Three woods are available from level 1 and all nine by level 43.** It used to be two,
widening slowly, which with six woods gave a player pine for most of a first session and
with nine gave them pine and birch ALTERNATING — two materials cannot help but alternate.
Measured over the campaign: 9 distinct materials in the first 20 levels, no adjacent
repeats, no A-B-A-B runs, and no material above 12%.

**The texture load list is derived from `MATERIALS`, never written out.** It was written
out, and three real board types were missing from it for weeks and rendered as a flat
colour fill. A list that cannot disagree with the table it mirrors cannot go stale.

Each material also carries its own **guide-line colour** (cyan vanishes on pale ice, so ice uses hot orange), **particle type** (sawdust / ice shards / sparks) and **audio profile** (`softwood`, `hardwood`, `rotten`, `metal`, `ice` — different whine pitch, filter Q and motor note).

**Metal must not be shrill.** It was a 1560 Hz sawtooth over a Q 5.5 noise band swept up to 7.4 kHz, and the owner reported it hurt to listen to. A sawtooth's harmonics land where the ear is most sensitive, and a narrow resonant band up there rings. It is now an 880 Hz triangle over a 1.7-3 kHz Q 2.2 band: still above the woods, grindy rather than piercing. Any new profile stays under ~1 kHz fundamental and avoids narrow high bands.

**The saw is silent while a gimmick briefing card is up.** It used to spin up behind the card, which sounded like the cut had started before the player had read what was different.

**Ice is drawn translucent, and that is the whole of what makes it read as ice.** It was a
blue-white texture with a specular pass over it, and the owner's note was that it "does
not read as ice". The thing that was missing was not more highlight: a sheet of ice is
SEE-THROUGH, and it has something inside it. So the sheet is drawn at `ICE_ALPHA` over
the bench, with fractures and trapped bubbles generated once per board from the level's
own seed and drawn in plank-local coordinates so they travel with it. Its drop shadow is
lighter and thrown further clear, because a solid black shadow showing through a
translucent sheet is what makes translucency look like a mistake instead of a material.

### Reward layers — what makes a run feel good

Four things can pay out on a single board, so no two runs feel identical:

1. **Cut quality** — accuracy → 1–3 stars → base coins.
2. **Combo multiplier** — staying off the `off` band builds 1x → 2x → 3x → 4x → 5x at 3/7/12/18 seconds, each tier announced ("NICE!", "GREAT!", "ON FIRE!", "FLAWLESS!"). Pays continuously while held. This is the "I'm on a roll" hook.
3. **Odd finds** — salvage (coin, pocket watch, screw, nail, horseshoe, key) embedded **on the line**. Collecting one requires genuine accuracy at that moment, not just proximity. +35 each. **A find the blade goes through is SAWN IN HALF and stays in the board**: the two halves are clipped at the kerf and part by its own width, with the kerf drawn beneath showing through the gap and the sawn faces lit. It used to vanish on the frame the blade reached it, which threw away the one moment the mechanic is about — the player watches a find precisely because the blade is going to go through it. The halves part on board DISTANCE, not wall time, like everything else on the fixed timestep.
4. **Perfect turns → keys → treasure chest** — nailing a genuinely sharp corner within `tol * 0.35` awards a key; three keys pay a 200-coin chest. Keys are a currency **separate from stars**.
5. **Perfect jumps** — on a jump board, crossing a hole inside the timing window pays `JUMP_BONUS` (45) and keeps the combo alive. See "The jump" above.

The results panel itemises all four, because a single total teaches the player nothing about what to do more of.

**Corner tuning is delicate.** `CORNER_CURVATURE = 0.12`, min spacing 420px, max 4 per board. An earlier threshold of `0.010` fired on level 1's gentle sine ~17 times per board and paid out 1000+ coins on the first level.

### The currency strip is pinned, not scrolled

Coins, stars and keys are drawn by `drawCurrencyStrip` at a **fixed position at the top
of the screen** on the scrolling menus (Workshop, The Saw), and the scrolling column is
inset below it. They used to be drawn into the column itself, which meant that on a
scrolled Workshop the payout from a claimed job flew to a counter that was no longer on
screen — the reward animation ended at the top edge, pointing at nothing.

`STRIP_COIN_X` and `stripCoinY(safeTop)` are exported from `render.js` and used as the
source and target of every coin flight. Two hard-coded pairs of numbers in `main.js` are
what let the counter and the animation drift apart in the first place.

### The coin is a rendered sprite

`assets/ui/coin.png`, made by `tools/gen_coin.py`: a gold coin with a milled rim, struck
with the game's own saw blade. It appears against every total in the game — HUD, menus,
workshop, chest, every button price — so it was simultaneously the most repeated object
on screen and the least made (a radial-gradient circle). It is rendered offline with the
same height-field-and-real-normals shader as the odd finds, imported from `gen_finds.py`
so there is one copy of it.

Two things it does differently from a find, both because a UI coin is not lying on a
board: it is rendered with **no cast shadow**, and its exposure is lifted afterwards —
the shader's environment is a dim workshop, which is right for an object on a lit board
and too dark for one sitting on a near-black panel next to a bright gold star.
`drawCoin` keeps the old code-drawn circle as a fallback, because every coin total in the
game still needs a coin beside it if the sprite fails to load.

### Discoverability — the gear is not optional

Every non-gameplay screen is reachable from a **gear button on the play HUD** at any
moment, mid-cut included: settings (including inverted steering), level select, the
Build screen and the Workshop. This is a correction, not a flourish. An earlier pass
put all of it behind "finish a level → tap WORKSHOP → scroll to the bottom", and the
owner reviewed the build and reasonably concluded the features had not been built.

**Rule: a feature that needs more than two taps to reach from gameplay does not
exist.** When you add a screen, add its route to the pause menu AND to the main menu
in the same change.

Every screen's BACK has to return to whichever screen opened it — `game.wsReturn`,
`upReturn`, `buildReturn`, `levelsReturn`. The Workshop used to always return to the
results panel, which is a screen that does not exist when the Workshop was opened
from the main menu, and its button said "BACK TO CUTTING" when it was about to do
nothing of the kind.

### Meta systems

Built in `src/meta.js` (state) and `src/workshop.js` (screen). Reached from a button on the results panel. Two loops, deliberately:

- **SHORT — the saw upgrades** (below). There used to be **consumable supplies** here —
  Slow-Mo, Steady Hand, Wood Filler — bought in the Workshop and fired mid-cut from a
  bar. **They are deleted.** The owner never used one, and the reason generalises: firing
  a consumable means taking your thumb off the board, and the board does not stop. *A
  consumable the player has to stop playing in order to spend is a consumable nobody
  spends.* Do not reintroduce this shape. The short-term coin sink is the upgrades,
  which change the cut without asking the player to let go of it.
- **LONG — the Build screen.** Coins fit out a KITCHEN, one object at a time: Starter
  Kitchen → Family Kitchen → Chef's Kitchen → Dream Kitchen. **This is a full-screen
  isometric room**, not a card illustration (2D since 2026-09-21 — see "The Build screen
  is 2D" below). Buying a part makes that object physically drop in and land in its
  place; the unbought remainder is a pale ghost of the finished room, and the next
  part's ghost pulses, so the goal and the next step are always on screen. **A finished
  kitchen is held on screen, complete, until the player taps NEXT KITCHEN.** The meta
  advances the moment the last part is bought, and the screen used to follow it at
  once — so the payoff for finishing a kitchen played over the next, empty one. **This is the
  primary D1 return hook**, and it only works if the thing being built is worth looking
  at — which is exactly why the buildings that used to be here are gone.

  **A part is one OBJECT, not a stage of construction.** The five hand-modelled
  buildings (birdhouse → workshop) had parts like "framing" and "felt roof", which are
  stages that only exist if you model them yourself. They were replaced because the
  owner's verdict was that hand-written geometry still did not look good enough — the
  same lesson as §8.4. Imported art gives you whole objects instead, so a part is now a
  tile, a worktop, the fridge. Two consequences, both deliberate:
  - **There are more parts and each is cheaper.** 44 parts across four kitchens, 60 →
    15,800 coins, against 27 parts at 90 → 14,000. A part has to be affordable often
    enough that the room visibly fills up, or the progression stops reading as progress.
  - **Each kitchen carries its own palette**, which drives the Build screen's backdrop
    and tints the objects. Finishing one and starting the next has to be a visible
    change of room, or four kitchens are one kitchen with more furniture in it.

- **THE SAW — upgrades.** Its own screen (`drawUpgrades` in `src/workshop.js`), reached in two taps from gameplay (gear → UPGRADE THE SAW) and also from a card in the Workshop column. Eight parts, four tiers each, in two groups, and **every tier changes a number the cut mechanic actually reads** — this is the direct answer to §8.5, cosmetic-only progression:

  | Group | Part | Tiers | What it changes | Read in |
  |---|---|---|---|---|
  | Machine | Tungsten Teeth | +8 / 16 / 25 / 35% tolerance | Every accuracy band widens, and the guide line's glow visibly widens with it | `cut.tol` |
  | Machine | Geared Motor | −4 / 8 / 12 / 16% feed speed | The board feeds slower, so there is more time to read a corner | `cut.speedMult` |
  | Machine | Guide Laser | spot → arrow → corner warning → second marker | See below | `cut.laser*` |
  | Machine | Dust Extraction | SPLIT meter fills 12 / 22 / 32 / 42% slower, heals faster | The board survives more of a wobble | `cut.damageMult`, `cut.repairMult` |
  | Payout | Flywheel Drum | combo tiers arrive 14 / 26 / 37 / 48% sooner | The multiplier climbs faster | `cut.comboScale` |
  | Payout | Timber Ledger | +8 / 17 / 28 / 42% coins per board | Its own line on the results panel | `cut.coinMult` |
  | Payout | Salvage Crate | odd finds pay 1.5 / 2 / 2.6 / 3.4x | | `cut.findMult` |
  | Payout | Micrometer Gauge | up to +60 / 130 / 230 / 380 | Paid against accuracy CUBED, so only a genuinely clean board earns it | `cut.precisionPool` |

  The values are baked onto the **cut** at `createCut()` from `META.sawMods(meta)`, never read from `meta` inside the step loop — so buying a part can never change the board being cut, and every renderer that needs the effective tolerance reads `cut.tol` rather than the raw level value.

- **Every fitted part has an ON/OFF switch.** `meta.upgradeOff` holds it and `activeTier()` is what the game reads, so a switched-off part behaves exactly as if it were never bought without losing the tier the player paid for. This is not a nicety: the laser in particular is a matter of taste, and **an aid the player cannot turn off is something they paid to be stuck with.** Buying the next tier switches the part back on, or the purchase would appear to do nothing.

- **Look-ahead is not a number to escalate.** The guide line already runs the full height of the screen, so "more look-ahead" cannot mean more line — and pushing the marker further up the board makes it describe a corner the player cannot steer for yet, which is worse than no marker. The laser's distance therefore barely moves (130 → 190px); its **tiers add capability**: the spot marker, then the arrow for the correction still owed, then an amber warning before a sharp corner, then a smaller second pip further up. Drawn last of everything on the board, because an odd find sitting at exactly the look-ahead distance was covering the one marker that must never be hidden.

- **The SPLIT meter.** Board damage used to be shown only as a red vignette, which meant neither Wood Filler ("clears all damage") nor Dust Extraction had anything on screen to point at. There is now a labelled SPLIT bar under the level progress bar, always drawn so it is learned before it matters, and both the helper and the upgrade are described in terms of it. **A stat the player cannot see is a stat they cannot be sold an upgrade to.**

Around those:Around those:

- **Level select** — reachable from the pause menu, from a card in the Workshop
  column, and from a LEVELS button sharing the results panel's bottom row with
  WORKSHOP. It used to exist only behind the gear, and the owner went looking for it
  and could not find it. **Two taps is the budget, but one route is not enough** — a
  player looks where they happen to be, and the results panel is where they decide
  what to do next. `game.levelsReturn` sends BACK to whichever screen opened it.
- **Daily chest** — one free chest per local day, and the only card in the game that
  expires. It sits at the TOP of both the pause menu and the Workshop column while it is
  unclaimed and disappears once taken, so the gear is worth opening every session rather
  than only when something is wrong. See §3 for why it cannot be gated behind an ad.
- **Star chest** — stars bank toward 30; opening pays 350 coins plus 2 keys. (It used to
  pay a random consumable; with those gone the second reward is keys, which is a better
  prize anyway — keys open the in-run treasure chest, so the reward points back at
  playing rather than at a shop.)
- **Chests are opened BY THE PLAYER.** Every chest source — the star chest, the three-keys chest earned during a cut, the daily chest and the seventh-day streak chest — routes through the same ceremony in `src/chest.js`: a chest the player taps three times, knocking a latch off each time, until the padlock drops and the lid bursts open on a heap of gold. It is drawn from frames rendered in Blender (the lid at seven angles, cross-faded; each latch and the padlock as its own sprite with its own shadow). A chest that pops itself and prints a number is a notification; three deliberate whacks is a moment. `rollStarChest()` decides the loot and `awardStarChest()` applies it, split precisely so the loot can be shown before it lands in the balance.
- **Old Mac's Jobs** — three quests drawn from a template pool (cut N boards, N perfect turns, N odd finds, N 3-star cuts, reach an Nx combo). Claim for coins; the board re-rolls once all three are claimed.
- **Daily Cut** — one date-seeded board per day, difficulty set above the player's current level, **one attempt** (a failed daily spends the day, and its failed panel offers BACK TO LEVEL n rather than a retry — it used to say RETRY LEVEL and quietly drop the player into the campaign), and a **seven-day streak LADDER** that resets on a missed day. The streak is measured from `meta.daily.last`, the last day a daily board was actually CUT; it was measured from a date stamped on every boot, so opening the game was enough to keep it. The streak pays: `dailyStreakMult` is `1 + 0.12 * min(streak, 7)`, applied to the daily board's whole payout and shown as its own results row, and **every seventh day also pays a chest** the player opens by hand. It used to be a number printed on a card that paid nothing, which is a statistic rather than a retention hook — and D1 retention is one of the three prime metrics. The Workshop card draws the ladder (rungs cut, today's rung pulsing, the seventh carrying a star) because a chain the player can SEE is a chain they do not want to break. The multiplier is deliberately modest: the daily is one board a day and must never become the only sensible way to earn.

**Currency rule: coins must always have somewhere to go.** An earlier title in this studio shipped a currency that could not be spent on anything, and four review rounds never caught it because nothing crashes when a mechanic is merely pointless.

---

## 3. Monetization rules

### Midgame (interstitial) ads — deliberately rarer than the platform allows

**A forced ad is only ever permitted at a player-initiated transition** — tapping Next
Level, or Retry after a failed board. Never mid-cut, never on load, never automatically.
That rule is absolute and does not depend on anything below it.

**The 10-minute opening grace is spent only where it buys something.** It is the single
largest voluntary cut we make to midgame revenue, so it is given to the two sessions
that are actually fragile, and to no others:

| Session | Grace | Why |
|---|---|---|
| First ever (no save at all) | **yes** | Nothing matters more than this session — it is conversion and D1 in one. |
| Returning after **7+ days** away | **yes** | A lapsed player who came back is the most fragile player there is; an ad inside their first minute is the cheapest possible way to lose them a second time. |
| Anyone else | no | They already know the game. The clock starts elapsed, so the first Next Level tap may carry an ad. |

Implemented as `meta.lastPlayedAt` (save v9) → `META.adGraceFor()` → `SDK.applyAdGrace()`,
decided once at load BEFORE this session's timestamp is written — stamp first and nobody
ever qualifies. A save with no `lastPlayedAt` is a pre-v9 save, not a first session: it
is stamped as played now, because the existence of a save means the player is not new.
A timestamp in the future (clock skew, timezone change) grants the grace, which is the
side of that mistake that cannot cost a player.

**Any ad resets the 10-minute clock, including a rewarded one the player chose.** So voluntarily watching a rewarded ad actively pushes forced ads further away. That lines the player's incentive up with ours and is the core of the monetization design here — see `FORCED_AD_GRACE_MS` in `src/sdk.js`.

The SDK also self-caps at 1 per 3 minutes; our policy is far stricter and sits on top of it.

- Pause the game and mute audio on `adStarted`. Resume on `adFinished` **or** `adError`. Block all UI until one fires.
- Never place on navigational buttons (main menu, settings, shop).

### The ad state must always be escapable

Two separate defects in the ad path caused a hard soft lock, and both are easy to reintroduce:

1. **`runAd()` must restore `game.state` on the SUCCESS path, not only on error.** It originally restored it only in the failure handler. Midgame ads and continue-after-fail got away with that because their own handlers set a state; **DOUBLE COINS did not** — the ad completed, the coins were paid, and the game sat on the ad cover forever. `done()` now always leaves the `ad` state before running the handler, and the handler may override afterwards.
2. **The dev skip button must be real DOM, not a canvas button.** The SDK injects `div#local-overlay` at `z-index: 10000` with `pointer-events: auto` covering the whole viewport, so anything drawn on the canvas sits underneath it and can never be clicked. `#devskip` in `index.html` sits above it and is unhidden only when `isDev()` — a `local` SDK environment or a literal localhost host.

**There is exactly ONE dev skip button, and it is DOM.** There used to be a second one
drawn on the canvas, which could never work — the SDK's ad overlay is a fixed div at
z-index 10000 covering the viewport, so anything on the canvas is underneath it and
unreachable. Two identical "DEV: SKIP AD" buttons, one live and one inert, meant the
skip appeared broken or not depending on which one you happened to aim at. The canvas
one is gone; `#devskip` in `index.html` is the only one.

**A dev skip must dismiss the SDK's overlay, not just our promise.** The local SDK
paints its demo ad as `div#local-overlay` — fixed, z-index 10000, pointer-events on —
and runs its own countdown to completion. `DEV: SKIP AD` resolved our pending ad and
nothing else, so the game resumed *underneath* a grey overlay that kept eating every
click until the demo timer ran out on its own: the button looked completely broken.
`SDK.dismissLocalAd()` removes the element, and is guarded on the local environment so
it finds nothing and does nothing on a real CrazyGames host. It must never be able to
dismiss a real ad.

Keep the watchdogs in `sdk.js` regardless (`AD_START_TIMEOUT` 9s, `AD_TOTAL_TIMEOUT` 125s): a provider that never calls back must never be able to strand the player.

### Rewarded ads — the revenue centre

Placements:
1. **Continue after fail** — max once per level attempt, 5-second countdown on the button, skip immediately visible, coin alternative always offered.
   **A continue must hand back a board the player can actually save.** Clearing the damage alone left the blade wherever it had wandered to — usually off the plank entirely — so the meter refilled within a second and the player lost again immediately, having spent an ad or 60 coins for nothing. `doContinue()` now re-seats the cut on the line, rewinds 150px so the player re-enters *before* the bit that beat them, drops the kerf samples from the rewound stretch, and counts in **3 – 2 – 1 – GO** with the board held still and steering discarded. The same count-in runs when resuming from the pause menu mid-cut, which has the identical problem.
2. **Double coins** on level complete.
3. **Daily free chest** — one per local day, offered on the pause menu (top row, above
   Level Select) and as a card at the top of the Workshop column, both of which vanish
   once it is claimed. Pays coins scaled gently with progress (120 + 12/level, capped at
   level 40) plus one random supply, and routes through the same player-opened ceremony
   in `chest.js` as the other two chests.

   **It must never REQUIRE an ad.** Basic Launch runs with ads disabled for 7-21 days,
   and that is exactly the window in which CrazyGames measures the D1 retention this
   feature exists to defend — a return hook that only functions after Full Launch does
   not defend the metric it was built for. So: rewarded where `adsUsable()`, simply given
   where it is not, with the "▶ Watch a short ad" sub-label present only in the first
   case. On `adError` the chest is not awarded (§3 never rewards on error) and the day's
   claim is left unspent, so the player can try again rather than losing it.
4. **Finish a saw upgrade** — on the upgrades screen, when the player has between 50% and 100% of the next tier's cost, one "FIT IT NOW" button appears. Watching the ad takes the coins they *do* have and fits the part, so the ad finishes a purchase rather than replacing one. **At most one such offer is on screen at a time** (the first qualifying part); four stacked "watch an ad" buttons read as an ad wall, which is the presentation this section exists to prevent.

Rules:
- Label the button with the actual reward — "Watch Ad for +50 Coins", not "Watch Ad".
- Include a video/camera icon so it's obvious an ad is coming.
- Skip button must match the reward button in size, font and colour. Hiding or shrinking it is a rejection trigger.
- **Never reward on `adError`.**
- Show a confirmation animation on `adFinished`.
- No ad chaining (multiple ads for one reward). No offering after every single death — use a timer.
- Diminishing returns on repeat currency ads (100 → 50 → 25), daily cap ~5.

### Banner ads

- Desktop side panels and level-select/menu screens **only**. Never during gameplay.
- Max 2 per screen. Minimum 30 seconds between refreshes of the same container. Max 120 refreshes per session per size.
- Must be clearly distinguishable from game content and never overlap UI at any screen size.
- Keep buttons well clear of banners — accidental-click layouts are a rejection trigger.
- Clear all banners before a video ad plays.
- **Disabled inside the CrazyGames mobile app** (banners aren't served there).

**The 30-second floor is measured from the last REQUEST, whatever happened since.** It
used to be skipped whenever the container was marked not-shown — and clearing banners
marks them not-shown, so every pause/resume flip re-requested at once (measured 2 → 14
refreshes in seconds). A container cleared inside the window stays empty until it ends.

**Implemented in `sdk.js`**, with the policy enforced in code rather than trusted to
discipline: max 2 containers, ≥30s between refreshes of the same container, ≤120
refreshes per session, cleared before every video ad, and refused outright inside the
CrazyGames mobile app or under adblock. `main.js` only requests them on full-screen
menus (`BANNER_SCREENS`) and only when the desktop letterbox gutter is ≥320 CSS px —
so a banner can never sit under a button, because every button is drawn inside the
720-wide play column. Verified: 2 containers at 1280×800 and 1920×1080, zero at
390×844 and 800×450.

### Adblock

Check `hasAdblock()` at boot. The game must remain **fully playable**. Rewarded buttons either hide or fall back to their coin alternative. **Never leave a dead rewarded button on screen** — a rewarded button that is clickable but does nothing is an explicit violation.

---

## 4. CrazyGames compliance checklist

### Size and files
- ≤ **50MB** initial download (we target **<2MB**), ≤ **250MB** total, ≤ **1500** files.
- ≤ **20MB** initial download to qualify for the **mobile homepage** — protect this budget.
- **Relative paths only.** Absolute paths break the platform embed.
- Time-to-gameplay must be **≤ 20 seconds**; we target **<1 second**.

### Rendering and input
- Must run well on Chrome and Edge; Safari compatibility expected (poor Safari performance gets the game disabled).
- Must run smoothly on a 4GB-RAM Chromebook.
- Readable from **907×510 to 1920×1080** desktop, and **800×450** mobile.
- **Frame-rate-independent physics.** CrazyGames explicitly tests at 144Hz and 165Hz. Use a fixed-timestep accumulator — never multiply gameplay state by raw `deltaTime`.
- Apply `user-select: none` with all vendor prefixes to stop long-press selection on touch.
- Portrait is permitted with letterboxing. Do **not** implement orientation locks — the platform handles rotation.
- The platform manages devicePixelRatio (forced to 1 on iOS and low-memory Android). Read it, don't fight it.

### Forbidden / required behaviours
- **No custom fullscreen button.**
- Don't trap **Escape** (it exits fullscreen). Disable **Ctrl/Cmd+W** during fullscreen.
  The keydown handler in `main.js` therefore never calls `preventDefault()` on Escape,
  and returns immediately when `document.fullscreenElement` is set — otherwise the one
  keypress both leaves fullscreen and jumps the player a screen backwards. Escape may
  still act as "back" outside fullscreen; it may not be swallowed.
- Keyboard bindings must adapt to layout (AZERTY → ZQSD).
- No cross-promotion to other games or platforms.
- PEGI 12 content — the platform serves ages 13+.
- English localization mandatory; detect locale via SDK system info, default to English.
- Original assets and an original name. No IP conflicts, no generic single-word titles.

### iOS specifics
- `AudioContext` enters `interrupted` state when backgrounded and must be resumed inside a user gesture:
  ```js
  document.addEventListener("touchend", () => {
    if (audioContext && audioContext.state === "suspended") audioContext.resume();
  });
  ```

### CrazyGames mobile app
- Detect via `getSystemInfo().applicationType` → `apple_store` (iOS) or `google_play_store` (Android).
- Renders fullscreen immersive — use **CSS safe-area insets** so UI clears notches and dynamic islands.
- Sitelock whitelist **must** include `capacitor://app.crazygames.com` (iOS) and `https://app.crazygames.com` (Android), or the game shows a blank screen in the app.
- Banners and Xsolla purchases are unavailable in the app — hide those paths.

### Browser / device compatibility — how it was verified (2026-09-28)
Minimum: **iOS 13.4+** (optional chaining / `??` are the newest syntax in `src/`), any
current Chrome/Edge/Android. **Every browser on iPhone is WebKit** — Chrome on iOS is
Safari underneath — so "iPhone Safari" and "iPhone Chrome" are one test, and the CrazyGames
iOS app (Capacitor WKWebView) is the same engine again. The Android app is an Android
WebView (Chromium).

What ran, all against the dev server with the localhost test hooks:
- **Android Chrome**: Playwright Chromium with Pixel 7 / Galaxy S8 / Pixel 7 landscape
  emulation and REAL CDP touch events (`Input.dispatchTouchEvent`) — 16/16 each: tap to
  play, audio unlocks on first tap, finger steering both ways, no page scroll/zoom, jump
  by tap, slider drag, list scroll without opening a level, Build taps + room browser.
  Plus two-thumb steering (second finger keeps steering when the first lifts).
- **iPhone/iPad**: Playwright's WebKit build (Safari 26 engine) as iPhone 13, iPhone SE,
  iPhone 13 landscape and iPad — 15/15 each (audio skipped: that Linux WebKit's GStreamer
  output hangs even on a bare oscillator; the game's audio was verified in desktop WebKit).
  Taps are real; drags are touch-type PointerEvents (Playwright has no WebKit touch-move).
- **Edge (Windows, real)**: headless Edge 154 driven over DevTools from PowerShell with
  real mouse/keyboard — 11/11 incl. arrow keys and wheel scroll. **Chrome desktop**:
  the puppeteer regression at 1280x800.
- **CrazyGames site**: the game in a cross-origin iframe on a different-origin "portal"
  page (desktop Chrome, Android, iPhone) — boots, storage works, taps/drags/keys reach
  the game, host page never scrolls.
- **CrazyGames app**: fullscreen safe areas faked at 47px top / 34px bottom (iPhone notch
  + home bar) — no button under either on any fixed screen, and scrolling lists end
  above the home bar. No sitelock exists, so the app origins cannot blank the game.

- **Real Android (2026-09-28 f)**: Android Studio's emulator (AVD `Pixel_7`, Android 15,
  Chrome 124) driven with OS-level input (`adb shell input tap/swipe` — genuine
  `pointerType: touch`), state read over Chrome DevTools via `adb forward`. Passed: boot,
  tap to play, audio on first tap, swipe steering both ways, no page scroll/zoom, NEXT
  LEVEL, music slider swipe, level-select scroll without opening a level, Build purchase,
  tap-to-jump (1 jump, 0 missed), zero page errors. **Found a real bug** (below).
  Rig lessons: Chrome's first-run and "Enhanced ad privacy" screens cover the page and
  eat every touch — dismiss them first; never reload the page from inside a DevTools
  evaluate (the reply never comes); killing a DevTools client mid-call wedges the adb
  forward and eventually the emulator.

NOT verifiable here: real phone hardware feel/perf, the real CrazyGames app shell, and
iOS audio on a device. **No iOS simulator is possible on this PC** — Apple only ships it
inside Xcode on macOS. **iPhone ring/silent switch mutes Web Audio** — "no sound on
iPhone" is usually the switch.

### Quality review — top rejection triggers
Poor onboarding · unclear objectives · unresponsive controls · inconsistent art direction or resolution · compression artifacts · imbalanced audio levels · repetitive gameplay · hard-coded US keyboard layout · UI that manipulates users toward ads (oversized ad buttons, artificial delays) · misleading cover imagery.

### Launch path
**Basic Launch** (7–21 days, graduates at 7+ days AND 500+ plays): SDK optional, **ads disabled even if integrated**. Metrics measured are the three in §1.
**Full Launch**: SDK mandatory, monetization enabled.
→ ~~*We integrate the SDK from day one and let ads sit inert until Full Launch.*~~
**WRONG (2026-09-28).** The portal's QA step inspects SDK usage and rejects a Basic
Launch build that touches the ad module AT ALL — one `clearAllBanners()` produced "Ads
were detected in your game ... Your submission will be rejected." Ads are now behind
`ADS_ALLOWED` in `src/sdk.js` (**false** for Basic Launch): no requestAd, requestBanner,
clearAllBanners or hasAdblock. Every rewarded offer already falls back through
`adsUsable()`. **Flip it to true only when CrazyGames moves the game to Full Launch**,
then rebuild with `tools/build_upload.py`.

### Submission assets
- Covers: **1920×1080** landscape, **800×1200** portrait, **800×800** square. Consistent visuals across all three, game title on the cover in a stylized font. No borders, no extra text, no icons, no raw gameplay screenshots.
- Preview video: 15–20s max, ≤50MB, 1080p, **no audio**, no black bars, no cursor, no promo text. Opens on the static cover image.

### Payouts
Minimum **€100** before payout; monthly via Tipalti (wire / ACH / eCheck / PayPal); officially NET 60, typically paid by the 10th of the following month. Revenue share percentage is not published in the docs.

---

## 5. SDK integration reference

**Script tag (in `index.html`):**
```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```

**Init:**
```js
await window.CrazyGames.SDK.init();
window.CrazyGames.SDK.environment; // "local" | "crazygames" | "disabled"
```

**Game module — lifecycle (mandatory):**
```js
SDK.game.loadingStart();
SDK.game.loadingStop();
SDK.game.gameplayStart();   // level start, revive, resume
SDK.game.gameplayStop();    // menu, level end, pause, before every ad
SDK.game.happytime();       // major achievement only — use sparingly
SDK.game.reportGameCompletedPercentage(0..100);
SDK.game.settings.muteAudio;      // OVERRIDES our in-game audio toggle
SDK.game.addSettingsChangeListener(fn);
```

**The SDK throttles `gameplayStart`/`gameplayStop` to one call per method per second, and
a throttled call is DROPPED, not queued** (it only logs "gameplayStart() call throttled,
delay 1000" as a console error). So pause -> RESUME inside a second used to leave the
platform believing play had stopped while the player was cutting, which corrupts the very
playtime number Basic Launch judges. `sdk.js` therefore tracks what the SDK was actually
told, separately from what the game wants, and when a call would be throttled it retries
after the window with whatever the game wants by then. Never call `SDK.game.gameplay*`
directly — always go through the wrapper.

**Ads:**
```js
SDK.ad.requestAd("midgame" | "rewarded", {
  adStarted:  () => { /* pause game, mute audio, block UI */ },
  adFinished: () => { /* resume, grant reward */ },
  adError:    (e) => { /* resume, DO NOT grant reward */ },
});
SDK.ad.hasAdblock();
```
Error codes: `adsDisabledBasicLaunch` · `unfilled` · `adblock` · `adCooldown` · `other`.

**Banners:**
```js
SDK.banner.requestBanner({ id: "container-id", width: 300, height: 250 });
SDK.banner.requestResponsiveBanner("container-id");
SDK.banner.clearBanner("container-id");
SDK.banner.clearAllBanners();
```
Sizes: 728×90, 300×250, 320×50, 468×60, 320×100.

**Ad watchdogs (required).** `src/sdk.js` arms a timer on every ad request: 9s to receive `adStarted` or a terminal callback, then 125s for the ad to finish. If neither lands, the game resumes itself. Without this, an ad provider that never calls back leaves the player stuck on a cover screen forever. This was a real bug caught in testing — do not remove these.

**Data (cross-device synced progress, 1MB cap):**
```js
SDK.data.setItem(key, value);
SDK.data.getItem(key);
SDK.data.removeItem(key);
SDK.data.clear();
```
Preloaded at init, debounced ~1s on write, guest data migrates on login. Error `dataLimitExcedeed` past 1MB. **Always keep a localStorage fallback** for when the SDK is disabled.

**User / system info:**
```js
SDK.user.getSystemInfo;  // countryCode, locale, device.type, os, browser, applicationType
SDK.user.isUserAccountAvailable;
await SDK.user.getUser();
```

**Testing:** localhost runs in `local` mode with demo ads. On any other non-CrazyGames domain the SDK disables itself — append `?useLocalSdk=true` to force local mode. QA tool at `crazygames.com/preview` and in the developer dashboard.

---

## 6. Art & audio direction

**The bar: bright and colourful, realistic wood, fun — but not childish and not simplistic.** Think a well-lit modern workshop, not a cartoon.

- **Wood:** tiling **JPEG** textures (pine, oak, maple, cherry, walnut, ebony — 512×1024, ~45KB each, 328KB total), generated by `tools/gen_wood.py` and committed as real image files. JPEG rather than WebP: universally supported with zero fallback logic, and grain is photographic so it compresses well. Re-run the script to change the wood; don't hand-edit the images.
  - Textures tile on **Y** (the plank scrolls vertically). Periodicity comes from FFT low-pass noise over a wrapped grid.
  - What makes it read as wood rather than marble is **anisotropy** — every noise field is stretched hard along Y so grain runs the board's length in long near-parallel lines. An isotropic version of this looked like psychedelic marble.
  - Knots need a **hard-edged dark core plus tight rings**. A soft radial blob reads as a stain, not a knot.
- **Cut treatment:** the kerf is drawn in four passes (torn fibres, bright sawn edge, the gap, a dark core), and segments where the cut went off the line get widened scorch and tearing driven by the per-sample quality recorded in `cut.kerf`.
- **The guide line encodes tolerance in its GLOW RADIUS, not a filled band.** A filled tolerance corridor turns muddy green over warm wood — it was tried and looked like a stain. The halo is wide and soft on easy levels and tightens to a hairline on hard ones, which communicates difficulty at a glance.
- **Palette:** warm woods against cool workshop steel/blue-grey, with saturated accent colours on UI and rewards. High contrast so the guide line reads instantly on every wood type.
- **Consistency is a review criterion** — one art direction throughout, no cartoon-to-realistic shifts, no mixed resolutions, no compression artifacts.

**Audio is the primary moment-to-moment feedback channel:**
- Blade whine pitch bends continuously with tracking error — the player hears accuracy before they see it.
- Cutting texture noise layered under it, varying by wood species.
- Rising combo chime while on the line; splinter crack when off.
- Level complete: escalating star chimes, coin cascade.
- Keep levels consistent and comfortable — imbalanced audio is a rejection trigger. Honour `SDK.game.settings.muteAudio` above the in-game toggle.

**Two volume sliders, two buses (2026-09-28).** `audio.js` routes every effect —
saw included — through `sfx` and the music through `musicBus`, both into `master`
(which the HUD speaker still mutes). The menus have an SFX and a MUSIC slider in place
of SOUND ON/OFF (home: side by side above INVERT; pause menu: one row). Slider values
are `meta.settings.sfxVol` / `musicVol` (defaults 0.85 / 0.45), applied SQUARED since
loudness is heard logarithmically. Dragging either slider lifts a mute; dragging SFX
plays preview ticks. Sliders are buttons carrying `slider:` so hit-testing is shared;
`game.slider` holds the one being dragged. Measured at defaults: music sits ~9 dB under
the running saw.

**Music (`src/music.js`, 2026-09-28).** Synthesised like everything else — no files.
A sequencer, not a loop: SEVEN sections × 16 bars at 92 BPM (~4.9 min per cycle), each
with its own key, groove and instruments — morning (FM e-piano, shaker), workbench
(Karplus-Strong guitar arps, walking bass), sawdust (marimba), night shift (pads, bells,
minor), whistle (whistled folk tune, strum, stomp-clap), music box (breather, no drums),
funk (funky bass, clav, full kit). Melodies come from a seeded two-bar motif played
A A' B A, snapped to chord tones on the beat, and the seed changes every pass — so the
second time through a section is a different tune. Starts at a random section. Drum fill
into every section change. Nothing is scheduled while the page is hidden.

**Every action makes a sound (2026-09-28).** Every button tap: `uiClick` (wood-block
tick; brighter for primary/reward buttons), `denied` for locked ones, plus `whoosh` on
navigation. Every coin/star/key flight that lands: `coinCollect` / `starLand` /
`keyChime` via `fx.arriveSound` (rate-limited to one per 45 ms). The results coin roll
ticks with `coinCollect`; stars land with `starLand`; purchases play `purchase`
(ka-ching); can't-afford plays `denied`. The old button sound (a 90 ms 520 Hz sine
thunk) existed but was too dull to register — the owner didn't know buttons had sound.

---

### The UI is built from workshop materials (2026-09-28)

The owner's siblings — the first outside play-testers — recognised the old UI as
AI-made **on sight**. The tells, all now gone: glossy gradient pill buttons with a white
highlight strip, green/orange/grey fills, dark translucent rounded cards, bold all-caps
system font, gradient title text with a thick black outline, a rainbow progress meter,
and an emoji 🔒. The owner chose "workshop materials" over "blueprint" and "vintage tool
catalogue". Everything lives in `src/ui.js`; textures come from `tools/gen_ui.py`.

| Old | Now |
|---|---|
| glossy pill button | plywood block: raw (secondary), or painted green / safety yellow / grey (locked) with the paint worn back to the wood at the edges; ply layers on the cut edge; stencilled lettering, burned on raw wood; nails on big blocks |
| dark translucent card / panel | stained plywood board (`boardPanel`), screwed at the corners |
| flat black menu backdrop | pegboard wall (`pegboardWall`) |
| pill labels, toasts, headers | torn masking tape, marker or stencil (`tape`) |
| title text | stencilled plank sign (`plankSign`) |
| progress bars | tape measure (`tapeMeasure`); results meter = steel rule, one colour |
| slider | tape label + steel rule + brass slider (`rulerSlider`) |
| gimmick briefing | a WORK ORDER on a clipboard (`clipboard`), gimmicks in red marker |
| loot cards | kraft price tags (`priceTag`) |
| level-select cells | an offcut of that level's actual board, number on tape, pencil ring on "you are here" |
| outlined titles | spray-stencil text (`sprayText`) |
| emoji padlock | vector padlock (`padlock`) |

**Fonts** (bundled in `assets/fonts/`, licences alongside — never fetched from Google,
so they work offline and inside the CrazyGames iframe): Big Shoulders Stencil (OFL) for
titles/buttons, Permanent Marker (Apache 2.0) for anything written on tape, Barlow
Condensed (OFL) for body text. Loaded with `FontFace` in `loadUiSkin()`, awaited at boot
inside the same 10 s texture timeout; a failed font falls back to system-ui.

**Palette**: text is cream (`#f3e9d2`) / warm tan, never the old blue-greys; overlays are
warm near-black (`rgba(14,9,5,…)`), not blue-black. Gameplay colours (the cyan guide
line) are untouched — they are functional, not UI.

**No `multiply` (or other blend modes) for UI stains.** In the Android emulator's Chrome
124 (GPU-rasterised canvas) a multiply fill drawn inside a clip over a pattern fill was
silently dropped: every stained board and the title sign rendered as raw pale plywood
with cream text on it. A plain multiply on a test tile worked, and a pixel readback
(getImageData) forced a software path that HID the bug — so only a screenshot of the
live page showed it. Stains are source-over now, with colours solved to land on the same
browns. (render.js's metal-board multiply is gameplay art and was left alone; it did not
show the fault.)

**Everything static is cached offscreen** (`drawBlock`, `cachedArt`), under a **pixel
budget** (~12M px ≈ 48 MB across both caches, oldest evicted first) rather than an entry
count — a phone tab gets far less memory than a desktop one. Measured afterwards: 9 Mpx
at 1280x800@2, 5 Mpx on a phone. Measured: drawn
live, the tape strips alone took the home screen from 24 fps to 7 and the Workshop from
21 to 4 (1280x800@2, software raster). Cached, home/play/levels match the old UI and the
Workshop is 28 vs 34 fps (blitting nine textured boards instead of flat fills; not an
issue on a GPU). **Any new UI piece that uses patterns, shadowBlur or multiply must go
through `cachedArt`** — never draw them live per frame.

### The saw machine

The saw is the one object the player looks at for an entire run, so it gets the same
treatment as the wood. Three rules, all of them from owner feedback on a version that
broke each one (and a fourth, below, for the dust hose):

- **Metal is textured, not gradient-filled.** `tools/gen_machine.py` generates
  cast iron, brushed stainless and blade steel with the same FFT approach as the wood.
  Flat grey gradients read as moulded plastic. Note the pattern must be *scaled down*
  when filling a small part — a 512px texture on a 66px-tall arm samples one
  near-uniform crop and looks exactly as flat as the gradient it replaced.
- **The blade passes THROUGH the board.** It is drawn in two passes either side of the
  plank: `drawBladeUnder` before, so the uncut board occludes the run ahead of the
  cut, and the visible stub in the open kerf after. A blade floating entirely on top
  of the workpiece is the first thing that reads as wrong.
- **The contact point must be explicit.** A reticle tinted by the current accuracy
  band sits on the blade, plus a hairline across the exact contact line. Making the
  aim point hard to find makes the game harder in the wrong way.

**The machine stays out of the line's way.** Everything above the contact point sits
over the line still to come, so every unit of metal there is a unit of line the player
cannot read. The head used to be a 92×96 two-lobed casting with clamp jaws and
hold-down pads reaching down to the board, on a 60-unit arm; together they hid the last
~100 units before the blade, and the owner found the line hard to see in front of the
saw. It is now a **narrow 26-unit arm and a small 30×26 chuck** gripping the top of the
blade, with nothing reaching down past it and the tension knob moved out over the
bench. Do not grow it back.

**Nothing is drawn below the contact point.** There used to be a blade stub trailing
back down the open kerf, on the theory that the player should see the blade emerging
from the cut it just made. It did the opposite: a strip of steel lying along the
finished kerf reads as the blade being BEHIND the board, which made the whole scene
look like it was being viewed from underneath. Past the contact point there is now only
kerf, so the cut reads as going down INTO the wood.

**The blade has to reach the work.** The head hung over the board with the only blade
on screen being the stub trailing *below* the contact point, in the open kerf. With
nothing joining the casting to the cut, the scene read as though the board were being
seen from underneath with the blade behind it — the owner's words were that the blade
"is not visually connected to the machine". A scroll-saw blade is clamped in the upper
arm and passes DOWN through the workpiece, so there is now an **upper run** drawn after
the plank (it is above the board, so the board cannot occlude it), from the contact
point up into the clamp jaws, with its own shadow on the board. The head's open throat
already existed so the player can read the guide line right up to the blade; it turns
out the honest shape and the readable shape are the same shape here too.

Three details about that run are not optional:

- **It is serrated.** This is the part actually doing the cutting, and a plain grey strip reads as a rod. Teeth are cut along both edges, sampled along the same curve the blade is stroked on so they stay on it as it flexes.
- **It runs far enough up to finish INSIDE the chuck** (`BLADE_UPPER`), not merely to its edge. Stopping short leaves the blade apparently hanging unattached below the machine.
- **The top end does not bob.** It is clamped, so only the cutting end reciprocates. Bobbing both ends slid the whole blade up and down inside a static casting, opening and closing a visible gap at the chuck — the blade detaching from the head every few frames.

**The dust hose is a lit, corrugated cylinder** (2026-09-26). It was one dark 28px
stroke with faint ticks, and the owner called it flat and 2D. `renderHose` shades it
across its width in lanes as a cylinder lit from the lamp over the blade, lays
corrugation ribs along the curve (dark trough, lit crest, brightest where the cylinder
faces the light), adds a specular streak and a contact shadow, and ends it in an
aluminium spigot with a worm-drive clamp. It is static per layout, so it is rendered
once to a cached sprite like the bench.

### Menu and UI motion

The play field always had weight — dust, sparks, shake. The menus did not, so a results screen read as a spreadsheet updating. Every UI event now has physical impact, via the menu-juice layer in `fx.js` (`ring`, `flight`, `flash`, `createRoll`):

- **Results panel** springs in with a slight rotation, the title pops on an overshoot ease, each star lands with its own shockwave ring + sparkle spray + screen flash, the breakdown rows cascade in from the left one per beat with a blip each, the coin total **rolls up** rather than being printed, and the buttons stagger in last so the player's eye is on the score when it lands.
- **Purchases** punch the button that was tapped, and coins physically **fly from the coin counter to the thing bought** (or from a claimed quest back to the counter). Spending should look like spending.
- **Build parts** drop onto the model with an overshoot, then land with a ring, a shake and a thump.

Rings and coin flights draw above panels but **below buttons**, so a coin can cross a results card without hiding what the player is about to tap.

---

### Boot must never hang, and must never hang silently

`boot()` is wrapped in try/catch, and every await in it is raced against a timeout
(`withTimeout`): 8s for `SDK.initSdk()`, 10s for the textures. Missing textures already
degrade to a flat fill, so **starting without them beats not starting**. An image that
404s fires `onerror` and resolves; one on a stalled connection fires neither, and
awaiting that forever is a game that never starts.

`index.html` carries a **plain, non-module** boot watchdog. It has to be non-module so
it still runs when the module graph itself fails to evaluate. It captures
`error`/`unhandledrejection`, and if `window.__gameReady` is not set within 12s it
replaces the LOADING text with the actual problem, the page URL, and a reload button.
The URL matters: opened over `file://`, or from a host that is neither localhost nor
CrazyGames, the SDK behaves differently — showing it turns "it doesn't work" into
something diagnosable.

`main.js` clears the loading screen only after a frame has genuinely been drawn. The
old version cleared it on a bare `requestAnimationFrame` timer that could not tell
"running" from "hung".

### The local dev server must be THREADED

`tools/serve.py` uses `ThreadingMixIn` with `HTTP/1.1`, because that is what
`python3 -m http.server` does (stdlib `ThreadingHTTPServer`). The first version of
this file used a plain single-threaded `TCPServer`, which serialises requests — and a
browser opens up to six keep-alive connections per host, so one held-open socket
blocks every other asset and the page stalls half-loaded. If you replace this server,
keep it threaded.

### Performance — measure, then cache what doesn't move

The saw rewrite dropped the game to **8.5 fps on a 2x display**. Everything below was
found by ablation (disable one draw call, re-measure), not by reading the code — the
instrumented JS call time was only 0.5ms of a 116ms frame, because the real cost is
deferred rasterisation.

Rules that came out of it:

- **Never use `ctx.filter = 'blur(...)'` per frame.** It was the single largest cost
  (removing three of them took 8.5 → 30 fps). Soft shadows are three nested rects at
  low alpha; nobody can tell at these radii.
- **Never use `ctx.shadowBlur` on a long path.** The guide line stroked its full-height
  path three times with shadowBlur for the glow: ~5.6ms/frame. Concentric translucent
  strokes read identically and cost nothing.
- **Cache anything static as a sprite.** The bench (~11ms/frame: full-screen fill, 140
  full-width grain strokes, 46 marks, 16 radial gradients, two full-screen gradients)
  and the saw arm + head (6 `createPattern` calls, ~20 gradients, clips, blurs) are
  static per workshop/layout. Both are now offscreen canvases rendered once and
  blitted; only the 26 airborne dust motes and the live blade/reticle draw per frame.
  The workshop's 3D project badge is cached per (project, parts, size) too.
- **Clamp every fill to the viewport.** A board is up to 6400 units tall against a
  ~1500-unit viewport, and `plankShading`/`drawSheen` were filling all of it.
- **Build a path once.** The guide line rebuilt several hundred `lineTo` calls six
  times per frame; it is one `Path2D` now.

Result: 8.5 → 60 fps at 430x900 @2x, 19 → 48 at 1280x800 @2x (software rasterisation
in headless — real GPU compositing is faster), workshop 27 → 59.

**When touching the renderer, re-run the ablation.** Frame time is a feature: playtime
is the multiplier on every impression, and nobody plays a game at 8 fps.

### The Build screen is 2D

**Retired: the in-game 3D renderer (`model3d.js`), 2026-09-21.** The Build screen and
the chest were live 3D on a painter's-algorithm rasteriser for two weeks. It needed the
eight rules below to stop faces popping, solids rendering inside-out and walls sorting
in front of the furniture — and after all of them the owner's verdict was still that
the buildings and chests did not look good. The faults were never really bugs: a
rasteriser without a depth buffer that can give each face only one flat colour cannot
produce art of the quality the rest of the game has.

What replaced it:

- **Everything is rendered OFFLINE in Blender** (Cycles, full-resolution meshes, real
  soft shadows, the chest's own painted texture) by `tools/gen_kitchen.py` and
  `tools/gen_chest.py`, which drive the Windows Blender headless from WSL. The runtime
  only blits images. Blender is a dev-machine tool, like numpy — nothing ships but PNGs.
- **One fixed orthographic camera for every kitchen sprite.** Under an orthographic
  camera and SUN lights only, an object's image does not depend on where it stands, so
  one render of each distinct (object, size, turn) serves every placement in every
  room: 41 sprites plus 4 empty rooms (~490 KB). The runtime places a sprite by projecting its world
  position with the camera's right/up vectors, which the tool writes into
  `src/kitchen_sprites.js`. Turns are deliberately few — a 3° fridge was snapped to 0°.
- **Four different ROOMS, not four kitchens** (2026-09-26 (b)). The owner: the rooms
  "should definitely not all be kitchens! make each one unique and interesting". Now
  **The Woodshop** (brick and concrete; workbench with vise, pegboard of tools, red tool
  chest, lumber rack, sawhorses, stool, shop vac, offcut crate, radio), **The Kitchen**,
  **The Living Room** (striped paper over oak boards; lit fireplace, velvet sofa, leather
  armchair, rug, bookcase, coffee table, standard lamp, painting, fig, side table, pouf)
  and **The Music Room** (navy walls over wood panelling; upright piano and stool, drum
  kit, acoustic and electric guitars, amp, record player, speakers, acoustic panels).
  The room ids (`starter`/`family`/`chef`/`dream`) and each room's part count are
  unchanged, so a save part-way through a room carries over. A room's shell carries a
  `finish` (`brick`, `stripes`, `paint`; floor `concrete`, `boards`, `paint`; optional
  `panel` height), rendered by `finish_mat` in `kitchen_models.py`; panelling replaces
  the skirting because the two would overlap coplanar. Rugs draw in their own layer
  between the floorboards and the furniture.
- **The kitchen objects are modelled in code, not imported** (2026-09-26).
  `tools/blender/kitchen_models.py` builds every object from bevelled primitives with
  procedural materials — butcher-block oak worktops, sage shaker fronts with brass
  pulls, a red enamel range with cast-iron grates, a cream retro fridge, a painted
  casement window with sky behind it, a walnut spindle chair, and **oak floorboards as
  the floor purchases** (the thing the player has been cutting all game). The CC0 OBJ
  pack it replaced was pastel low-poly and the owner judged it did not look good; its
  layouts also overlapped (the starter cooker stood 0.2 units inside the worktop).
  Every object is built facing the viewer (+z) at its real size, so layouts no longer
  carry quarter-turns and positions are worked out from the sizes listed at the top
  of `kitchens.js`. A floor band's size is part of its sprite key, so each kitchen's
  bands exactly pave its own room. Rules the first render taught:
  - **No two visible faces may be coplanar and overlapping.** A shaker frame built
    from four full-length bars puts two front faces in one plane at each corner, and
    Cycles renders them as black squares. Stiles run full height; rails fit between.
  - **A sunk basin needs a hole in EVERY solid above it** — the worktop and the
    carcass. Carving only the worktop left the bowl full of green cabinet.
  - **A window's sky is emission only, on a black base.** A lit base colour plus
    emission under the key light blew the pane out to white.
- **The painter's order is trivial now** because the view never moves: floor tiles
  first, then everything else by depth toward the camera (height included, so a vase
  on a worktop draws after the worktop).
- **The ghost uses a shadow-free silhouette** of each sprite, built at load time. A
  sprite carries its cast shadow as dark translucent pixels, and flattened to the
  ghost's pale colour that shadow became a pale box on the wall.
- **No orbit or zoom.** They existed to look round a 3D model; a fixed view composed
  for the room is the better picture and one less thing to learn.
- **The art is fetched after the first frame and never awaited** — both screens are a
  tap from launch, and time-to-first-frame is where conversion is won.

Three things the first render caught, all invisible in the old flat-shaded 3D:
- **The counter and the wall cabinet are modelled facing +x**, so at the layouts' old
  quarter-turn they stood with their drawers and doors to the wall. They take `-HALF`.
- **The octree quantiser gives fully transparent pixels an alpha of 2-7**, a haze that
  composites into a visible box round every sprite. `clear_transparent()` in
  `tools/sprite_common.py` points them all at one alpha-0 palette entry.
- **A cast shadow that runs off the render frame is cut with a straight edge.**
  Shadow pixels (near-black, translucent) are faded out near the frame edge.

`tools/harness_build2d.html` replaces the three 3D harnesses: every kitchen empty,
half-built and complete, and the chest at each stage, drawn by the game's own code.

### The 3D renderer — RETIRED 2026-09-21 (kept as a record)

The rules below applied to `model3d.js`, which no longer exists. They are kept because
they are what it cost to learn that live 3D was the wrong tool here; do not bring it
back without reading them.

`src/model3d.js` is a painter's-algorithm software rasteriser. It has no depth buffer, so it depends entirely on getting two things right, and it had both wrong:

1. **Depth must grow AWAY from the camera.** The view transform added the rotated depth term to `cam.dist` instead of subtracting it, so `bz` grew toward the viewer. `polys.sort((a, b) => b.z - a.z)` then drew the *nearest* faces first and the farthest last — far geometry painted over near geometry, and the player saw the inside of every solid. Perspective ran backwards at the same time (far parts drawn larger). Backface culling is done from **screen-space signed area**, which is independent of depth, so single convex objects still looked correct and the fault only showed on multi-part models. That is why a previous "render a test grid and look at it" pass missed it.
   **Assert it, don't eyeball it:** render two identical boxes at z = +2 and z = −2 and sample the pixels. The near one must win, and must be wider.
2. **Ring-based primitives must derive their winding from the geometry.** Every cylinder was inside-out — sides for `axis: 'y'`, caps for `'x'` and `'z'` — because the handedness of `(cos a, sin a)` flips depending on which pair of axes it is mapped onto. `pushFaceOut()` now orients each face using a known-interior point, which makes the whole class of bug impossible. `tools/harness_3d.html`'s winding check compares every face normal against the direction from the shape's centroid.
3. **Never draw a translucent preview face-by-face.** The unbought remainder on the Build screen was drawn at 0.24 alpha per face, so every surface let the ones behind it through and a model with nothing bought was a stack of overlapping interiors — an x-ray, not a preview. The ghost is now rendered **opaquely into an offscreen buffer and composited once**, which gives one even density regardless of how many surfaces overlap.

4. **No two surfaces may be COPLANAR AND OVERLAPPING.** This is the "boxes pop in and out of view" bug, and it hit the chest and every building. The sort key is a face's average depth, so two faces lying in the same plane and covering the same area differ only by where their centroids happen to fall in it — rotate the model and that ordering genuinely flips, so they trade places every few frames and the part flickers. The renderer cannot fix it: "which of these two identical depths is nearer" has no geometric answer, only a modelling one. `resolveCoplanar()` in `model3d.js` runs at build time over a finished mesh and pushes such surfaces apart by 0.006 — invisible on models 2-4 units across — using BUILD ORDER as the authority on which one sits on top (you place a wall, then put a strap on it). Three things it had to learn the hard way: the nudge direction comes from the two solids' **centres**, not the face normal, because boxes flush back-to-back have normals pointing into each other; a part flush on **opposite** sides cannot be translated out of trouble at all and is inset instead; and the coplanarity tolerance must stay far below the nudge distance, or a part nudged clear of one plane lands inside tolerance of another a hundredth away and oscillates forever instead of settling.
5. **A container has to be modelled as a container.** The chest body was one solid `box`, so with the lid swung back the face you looked straight down at was a lit wood plank sitting exactly at the rim — the chest read as still shut, a crate with a lid leaning on it. No amount of shading fixes that; the cavity has to actually exist. It is now a floor plus four walls, with a **dark inside liner**, because a wall's inner and outer faces share one `side` colour and the inside has to be in shadow while the outside stays lit. Iron straps that used to run the full depth in one box also laid a metal bar straight across the open mouth; they are a front plate and a back plate now.

6. **The painter's sort is by PRIMITIVE, then by face — and a LAYER beats both.** Sorting
   every face by its own average depth is what made the chest's lock and latches vanish
   behind the lid: a big face's centroid can sit further forward than a small solid
   standing proud of it (the lid's front face is at z 0.67 while the lid's *centre* is
   at z 0, against a latch at 0.70), so the face key picks the wrong one and picks
   differently as the model turns. `renderModel` therefore keys on each primitive's mean
   depth and uses face depth only to break ties inside a primitive. The code computed
   that key and then sorted by the face key anyway for two sessions — **if you touch the
   sort, render the 16-angle sweep, don't read it.**

   Even a per-primitive key cannot order a large slab against the small solids lying
   UNDER it — a gable roof's centroid is the middle of its slope while the rafters
   beneath it sit near the eave, so the rafters win and paint through their own roof.
   That is a modelling fact, not a geometric one, and it is stated in `LAYERS` in
   `kitchens.js` (formerly `models.js`, deleted 2026-09-18): a part may declare an
   outside-in draw layer, and layer beats depth.
   Three rules for editing it — 0 is the default and means "pure depth"; only raise a
   part that is genuinely a SHELL over another part; and **build order is not
   automatically outside-in** (the workshop's machinery is bought after its glazing and
   stands inside it, the cabin's jetty and boat merely stand beside the building).

7. **A rotated part must slope the same way as the thing it sits on.** The workshop's
   roof panels were tilted `-s * 0.28` while their own rafters were tilted `+s * 0.30`,
   so the roof pitched *up* toward the eaves — a valley sitting under its own ridge
   beam, crossing through the structure holding it up. From most angles it read as the
   roof having been torn into loose sheets. The cabin's veranda roof had the same sign
   error. `gable()` derives its slope from the eave and ridge heights precisely so this
   cannot happen; any roof built by hand out of `box(..., { rx })` has to be checked in
   a render, because the sign is not readable from the source.

8. **Never make a solid translucent to soften it.** Translucent faces deliberately skip
   backface culling so glazing reads as a box rather than a decal — which means a
   translucent BALL draws every far facet through every near one, and the per-face
   outline stroke then draws all of their edges. The cabin's chimney smoke was three
   such balls and came out as grey wireframe blobs. Opaque, with `outline: false`.

**`tools/harness_3d.html` exists for this.** It renders every project complete and half-built, plus the chest closed and open, at four orbit angles. Open it before and after touching anything in `model3d.js` or `kitchens.js` (`models.js` was deleted on 2026-09-18). It is not part of the bundle.

### Code-drawn props must be lit by the scene, not shaded by hand

§8.4 says procedurally drawn Canvas art reads as generic to a human eye while passing
every critic round, and the odd finds were that failure in miniature: a watermelon, a
rubber duck and a donut in flat vector fills, sitting on photographic wood next to a
lit metal machine. The owner called them garbage on sight, which is the only quality
gate that counts.

Two changes fixed it, and neither was "draw more detail":

1. **They are lit by the lamp that actually exists.** The work light hangs over the
   blade at `cx`/`bladeY`, so each find derives its light direction from where it sits
   relative to that point, with the effect scaled by distance — a find under the lamp
   is lit flat from above with no cast shadow, one away up the board is lit from the
   blade's side and throws its shadow away from it. One consistent light over
   everything on screen is most of what separates "rendered" from "pasted on".
2. **They are SET INTO the board.** A socket, a torn wood lip catching the light on
   the lamp side, a contact shadow tight underneath. A prop that floats has to be
   drawn perfectly to look real; a prop bedded into the surface gets most of the way
   there for free.

The set itself changed with the technique. They are salvage now — a coin, a marble, a
brass screw, a cut nail, a bottle cap, a key — things that genuinely turn up in
reclaimed timber and would genuinely stop a blade. That is what made the lighting
honest: a cartoon watermelon has no correct way to be lit into this scene.

Two rules fell out of it that generalise:

- **The socket and the shadow must track the object's FOOTPRINT, not its nominal
  radius.** A round socket under a thin key is a black disc with a key laid across it,
  which looks worse than no socket. `OBJECT_FOOT` carries per-type dimensions and
  `OBJECT_BED` carries per-type strength, because a mostly-hollow silhouette shows its
  own bedding straight through itself.
- **Never `globalCompositeOperation = 'destination-out'` on the shared canvas.** The
  key's bow used it to punch its hole — which does not cut a hole in the key, it
  erases the BOARD, right through the canvas to the page behind. Build the shape so
  the gap is never painted instead. (The old donut had the same bug.)

**`tools/harness_finds.html` exists for this** — every find on real wood at three lamp
directions, which is the only way a lighting fault shows. Not part of the bundle.

**Then the owner could not tell what they were** (2026-09-16), and the lighting was not
the problem. Five of the six were small discs seen square-on — a coin, a marble, a screw
head, a nail head, a bottle cap — so at play size they were near-identical blobs. Rules
from the fix:

- **Silhouette first.** Pick objects whose OUTLINE names them from directly overhead: a
  nail and a screw lying on their sides, a skeleton key, a horseshoe, a pocket watch on
  its chain. At most one disc (the coin, which carries a big struck numeral). A find that
  needs its shading to be identified will not be identified.
- **They are image files now**, like the wood and the machine metal:
  `tools/gen_finds.py` models each as a height field and renders it with normals,
  self-shadowing, AO and a reflected environment, into `assets/finds/<type>.png` — a
  strip of 8 frames lit from 8 directions plus one from overhead, 224px, quantised to
  256 colours (~180KB for the set). `drawObjects` picks and cross-fades frames from the
  lamp's direction corrected for the find's own rotation, so the lamp rule above still
  holds and the baked shadow always falls away from it. The old socket/bed drawing is
  gone; the baked contact shadow does that job. Overhead frame is lit at 62°, not
  straight down — any steeper and every flat metal top mirrors the lamp and blows out.
- **Big enough to read:** drawn at 1.35× their modelled size. Long finds lie along the
  line so they read as being in the cut's path.
- **The line is drawn again over them.** A find big enough to recognise is big enough to
  hide ~100 units of path, so the guide line's core is re-stroked on top, clipped to the
  finds (`drawLineOverFinds`). The guide reads as a projected laser, so this is
  physically fine as well as necessary.

### Imported 3D art — the bake is a build step, never a runtime loader

The chest is IMPORTED art (CC0), not geometry written by hand. The kitchen objects
were too until 2026-09-26, when they were replaced by models built in code (see "The
Build screen is 2D"); the decimation rules below applied to that OBJ pack and are kept
for any future import. `tools/gen_chest.py` reads a GLB, `tools/gen_kitchen.py` builds
its models in Blender, and each emits a plain JS module of numbers.

**Nothing parses a model at runtime.** A glTF reader plus a PNG sampler is a lot of
bytes and a lot of load time to spend on art that never changes, and time-to-first-frame
is what §1 says conversion is won on. The originals live in `assets/src/` as source
material and are not shipped.

Four rules came out of doing this, and all four cost a render to find:

- **Re-expose the albedo at bake time.** The chest's texture is authored for a PBR
  renderer that will light it: mean (34, 23, 17), nothing above 113. `model3d.js`
  multiplies a face by at most ~1.08, so baking those numbers straight in gives a
  near-black chest. `tone_map()` in `gen_chest.py` re-exposes (peak → 238, gamma 0.82,
  a little chroma back). That is a conversion between two lighting models, not
  beautification — and it belongs in the BAKER, never as a multiplier in the renderer,
  which would silently brighten everything else too.
- **Reduce losslessly first, decimate second.** The pack is subdivision-smoothed (the
  oven is 41,888 quads), and merging adjacent coplanar quads is free — it changes no
  silhouette and no pixel. But it is not enough on its own: the oven still had 29,237
  faces afterwards, because almost nothing on it is actually flat.
- **Quadric edge collapse needs a NORMAL-FLIP GUARD.** Without it, quadric error is
  perfectly happy to drag a vertex clean through the surface: the fold it leaves has a
  small error but the face points backwards. The result is long spiky shards, and it is
  invisible in the face count — the first kitchen bake reported healthy numbers and
  rendered as wreckage. `would_flip()` rejects any collapse that inverts or slivers a
  surviving neighbour.
- **Never hold a boundary by pinning it.** Pinning every open-boundary vertex puts a
  hard floor under the whole reduction — the oven has 2,333 of them, so ~3,800
  triangles was the least it could ever reach, at any budget. Add a heavily weighted
  boundary QUADRIC per boundary edge instead: the outline then simplifies along its own
  length while resisting being pulled off its line.

**And two process rules, which are the point of the section:**

- **A face budget is set from a RENDER, not from a timing.** The first kitchen bake
  budgeted 260-460 faces per object because the measurements said that was cheap. The
  harness then showed the counter and sink as gouged wreckage while the oven — which had
  stalled at 3,798 faces and so was barely touched — looked completely right. Budgets
  went up roughly threefold and the layouts lost duplicate objects to pay for it.
- **Never let a shortfall fall through to dropping faces.** An early version trimmed to
  budget by keeping the largest faces, which punches holes straight through a closed
  shell. Being over budget is reported loudly and the faces are kept; a hole is always
  worse than a millisecond.

`tools/harness_kitchen.html` is the page for all of this — every object at four angles,
then every kitchen complete and half-built. Open it before and after touching
`gen_kitchen.py`, `kitchens.js` or the budgets. `tools/harness_3d_selftest.html`'s
coplanar scan now runs over the kitchen LAYOUTS too, because a layout can place two
objects flush (tiles edge to edge, flowers on a worktop) and coplanar overlapping
surfaces are exactly what the painter's sort cannot order stably.

### The frame loop must be crash-proof

`requestAnimationFrame(frame)` is the **first** statement in `frame()`, not the last,
and everything after it is inside a try/catch. This is not defensive padding — it is
the fix for a real freeze:

> A browser holding a stale cached `render.js` against a new `main.js` threw
> `R.drawBladeUnder is not a function` on the first frame. Because the reschedule was
> the last line, the loop was never re-armed: the game froze on the bench background
> forever, silently, with no message.

A game that silently does nothing is the worst outcome on this platform — it reads as
broken and takes playtime and conversion with it. So:

- **Reschedule first, then work.** One bad frame must never be fatal.
- **Count errors, don't swallow them.** A one-off is logged and skipped; a streak of
  30 raises a DOM overlay (not canvas — if the canvas is what broke, a canvas message
  never appears) offering a reload. It clears itself after 120 clean frames.
- **Check the module seams at boot.** `checkModules()` verifies the exports `main.js`
  actually calls. A stale bundle is indistinguishable from a broken build at runtime,
  so this turns a mystery freeze into "Stale files cached — hard-reload".

---

### UI text must fit the box it is drawn in

Canvas has no layout engine, so every string is drawn at whatever size the caller
picked, over whatever happens to be behind it. Three separate faults of this kind
were on one screen at once: a rewarded sub-label ("▶ Watch a short ad") wider than
its own button, "UPGRADES" spilling out of its button and across the copy beside it,
and the supplies blurbs running straight underneath their price buttons. On a review
where "UI that overlaps at some screen size" is a listed rejection trigger, that is
not a cosmetic issue.

Two helpers now handle it, and new UI is expected to use them rather than to hand-tune
a string length:

- `fitFont()` in `main.js` — every button label and sub-label is shrunk (to a floor of
  11px) until it fits the button's inner width. A caller cannot be expected to
  re-measure every string.
- `clipText()` in `workshop.js` — body copy that sits to the LEFT of a button is
  given the width actually available, shrinks a size or two first, and only then
  truncates with an ellipsis. Shrinking before truncating matters: these lines are the
  only place a helper's effect is explained, so losing "…use it into a hard corner"
  costs more than a point of type size.

**Screenshot every screen you touch at 430x900 and at 907x510.** All three of these
faults were invisible in code review and obvious in a screenshot.

## 7. Architecture

```
index.html          canvas, SDK script tag, inline critical CSS, safe-area probe
CLAUDE.md           points every new session at this file
src/
  main.js           fixed-timestep loop, state machine, UI panels, buttons
  render.js         layout, backdrop, table/bench, plank, guide line, kerf, saw, HUD
  plank.js          PLANK_WIDTH, seeded line generation, cut evaluation, damage, scoring
  levels.js         difficulty parameter curve, LEVEL_COUNT, the endless generator
  input.js          relative-drag steering + keyboard (arrows, WASD, ZQSD)
  fx.js             sawdust, sparks, confetti, screenshake, pop text,
                    plus the menu-juice layer: rings, coin flights, flash, number rolls
  meta.js           persisted progression: coins, projects, supplies, quests, daily, settings
  workshop.js       the scrolling Workshop screen (cards)
  build.js          the full-screen 2D Build screen: sprite compositor, part drop-in,
                    the finished-kitchen showcase, the Workshop badge
  menu.js           main menu (the launch screen), the endless difficulty picker,
                    the pause menu (reached by the HUD gear) and the level-select grid
  chest.js          the player-opened chest ceremony (every chest source), 2D frames
  kitchens.js       DATA ONLY: the four kitchens' layouts, palettes, costs. Read by the
                    game AND by tools/gen_kitchen.py (through node). PROJECTS in meta.js
                    is derived from it
  kitchen_sprites.js GENERATED by tools/gen_kitchen.py — camera basis, scale, anchors
  chest_sprites.js  GENERATED by tools/gen_chest.py — frame rects, lid angles, pivots
  audio.js          WebAudio synthesis, SFX + music buses, iOS unlock/resume
  music.js          the synthesised multi-section background music sequencer
  sdk.js            real CrazyGames SDK wrapper + ad watchdogs
  rng.js            seeded RNG, clamp, lerp
tools/serve.py      no-cache dev server — use this, not python3 -m http.server
tools/gen_wood.py   regenerates assets/wood/*.jpg
tools/gen_machine.py regenerates assets/machine/*.jpg (the saw's metal)
tools/gen_covers.py regenerates submission/cover_*.png
tools/gen_chest.py  renders the chest GLB in Blender -> assets/chest/ + src/chest_sprites.js
tools/gen_kitchen.py models + renders the kitchen objects in Blender (the models
                    are tools/blender/kitchen_models.py) -> assets/kitchen/ +
                    src/kitchen_sprites.js
tools/blender/      the Blender-side scripts both of those run (common rig, scenes)
tools/sprite_common.py shared: run Blender from WSL, crop, quantise, fix transparency
tools/harness_build2d.html every kitchen and chest stage, for checking a re-render
assets/src/         the ORIGINAL downloaded art (GLB/OBJ/textures). Only the chest's GLB is
                    still read; the kitchen OBJ pack is unused since 2026-09-26.
                    Source material, not shipped — nothing in src/ loads from here
submission/         store covers + preview video. NOT part of the game bundle.
tools/build_standalone.py builds dist/ — a one-file offline test copy (see §7)
dist/               GENERATED offline test build. NOT part of the game bundle.
assets/wood/        pine/oak/maple/cherry/walnut/ebony .jpg, 512×1024, tiles on Y
```

Zero dependencies, no build step, ES modules loaded directly. This is what keeps the first frame under a second and guarantees Safari/iOS compatibility.

**`model3d.js` existed because of that rule** (retired 2026-09-21 — the same rule is now kept by rendering offline instead). The Build screen needs real 3D; adding three.js would cost ~600KB and blow the load-time budget that CrazyGames conversion depends on. A painter's-algorithm rasteriser over Canvas 2D is a few hundred lines, costs nothing at load, and is more than enough for chunky painted-toy models. Meshes are built once per project and cached.

Two things about it are easy to get wrong:
- **Winding.** Faces are wound counter-clockwise as seen from OUTSIDE the solid. Backface culling is done on the screen-space signed area (front faces come out negative, because the canvas y-axis points down). Get this backwards and you render every model's interior.
- **Framing.** Fit the camera to the bounding box's separate horizontal and vertical extents, never to the bounding SPHERE — the sphere's radius is half the box diagonal, so a wide shallow building gets sized as if it were a cube and under-fills the frame badly.

### Layout system — important

The play column is a **fixed 720 logical units wide with a VARIABLE logical height**. `R.computeLayout(cw, ch)` returns `L` with `scale`, `ox`, `h`, `cx`, `bladeY`, and `left`/`right` (the visible logical extent, which runs past the column on wide screens).

- Position everything against `L.h` and `L.bladeY`. **There is no fixed stage height.**
- Tall phones therefore get **no letterbox bars** (390×844 → `L.h ≈ 1558`); desktop clamps to `MIN_H = 1150` and centres the column, with the workshop scene bleeding out to `L.left`/`L.right`.
- Panels compute their own height from their content and centre in `L.h`. Never hardcode panel Y or height — an earlier version did and the NEXT LEVEL button hung outside the panel on desktop.

### Local development

```
python3 tools/serve.py
```
**Not `python3 -m http.server`** — the stdlib server sends no `Cache-Control`, so
Chrome serves stale ES modules on reload and silently hides your changes. That cost a
review cycle once already; see the 2026-09-08 (b) changelog entry.
Port 8936 is this project's; 8935 belongs to Rush Hour Rampage. The SDK runs in `local` mode on localhost with demo ads. `src/main.js` exposes `__gameState()`, `__steerToLine()`, `__tapButton()` and `__setLevel()` **on localhost only** for headless testing.

### Offline play-test build (flash drive / friends and family)

```
python3 tools/build_standalone.py
```
Writes `dist/CutItStraight.zip` (~8 MB, plus the same thing unzipped in
`dist/CutItStraight/`). The tester unzips it and double-clicks **`Start Game.bat`**,
which runs `server.ps1` — a no-install static server on Windows PowerShell 5.1's
`HttpListener` — on `http://localhost:8936/` (walks up to 8960 if the port is busy),
and opens the browser there. Closing the console window stops it. Mac:
`Start Game (Mac).command` (python3 http.server). Launcher sources live in
`tools/tester/`. The server must send `.js` as `text/javascript` or the browser
rejects the modules; it refuses paths outside the folder. `.bat` is written CRLF and
`server.ps1` with a BOM (PS 5.1 reads BOM-less scripts as ANSI).

Why a server: browsers refuse to load ES module files from a `file://` page, so
opening `index.html` from the drive just shows "Couldn't start".

The package's `index.html` drops the SDK tag (no ads, localStorage saves) and sets
`window.__testerBuild`, which makes `isDev()` false — without it the DEV: RESET
PROGRESS button shows, because the package runs on localhost.

**Backup inside the package: `CutItStraight.html`**, one ~5.7 MB file that runs by
double-click from `file://` with no server. How it works: every module is inlined into one `<script type="module">` (each wrapped
in its own scope, exports exposed through getters so live bindings survive), and every
shipped image is embedded as a `data:` URL behind a shim on `HTMLImageElement.src`.
`data:` images also keep the canvas untainted, so the Build screen's `getImageData`
silhouettes still work. The CrazyGames SDK tag is removed — `sdk.js` already runs
standalone (no ads, localStorage saves). The bundler refuses import/export forms it
doesn't handle rather than emitting a broken file.

**It is a test build, never the CrazyGames upload.** The upload stays the project
folder (index.html + src/ + assets/, minus `assets/src/`, `submission/`, `dist/`).
Rebuild it after any change — it is a snapshot, not a live view.

---

## 8. Failure modes from prior titles — do not repeat

Two earlier games in this studio (Rush Hour Rampage, Tender Town) were built and polished for weeks and **never shipped**. Their design conclusions are unvalidated — no real player ever played either one, so nothing strategic from those projects should be inherited as proven. What *is* real evidence is how they failed:

1. **Both shipped with a 100% mocked SDK wrapper.** `init()` was a no-op, ads were a fake countdown div, saves were localStorage-only. Nobody noticed for weeks because every review round checked gameplay, never the shipping seam. **This project wires the real SDK from the first commit and verifies it in `local` mode.** Never write a mock SDK "for now."
2. **Weeks of pre-launch polish loops replaced actually shipping.** Internal AI critic rounds produced scores of 78–90/100 on games that were then rejected on sight by the owner. **A critic score is not evidence. Real player data is.** Get to submittable, then submit.
3. **A currency existed that could not be spent on anything.** Four rigorous review rounds never caught it, because nothing crashes when a mechanic is merely pointless. **Manual gate: every number visible on the HUD must do something.**
4. **Procedurally hand-drawn Canvas art read as generic AI slop to a human**, despite critics praising it every round. This is the direct reason wood here uses real texture files rather than code-drawn grain. Be skeptical of any art this project draws purely from code paths — get real eyes on it.
5. **Cosmetic-only progression exhausts fast.** Upgrades here must actually change how the game plays (tolerance, steering, look-ahead), not just recolour things.
6. **Genre/differentiation was assessed only after both games were fully built.** The retrospective called that backwards.

**The owner's own eyes on a real build are the only quality gate that counts.** Not a critic score, not an agent's self-report, not a screenshot review.

### Owner feedback already acted on — don't regress these

- **Cosmetic effects are never sold for coins.** They are triggered by what's happening: gold sparkles from a long combo, confetti from collecting an object, sparks on metal, ice shards on ice. Effects are feedback, not store items.
- **Everything must read from directly overhead.** No walls, no eye-level furniture, no pegboards, no drawer fronts. An early build mixed a standing-perspective wall with a top-down saw and it looked incoherent.
- **Wood grain must wander.** Three scales of noise displacement plus varying ring density. A single heavily-stretched noise field gives ruler-straight corduroy stripes that don't read as wood.
- **Metal must look metallic**, which comes from light, not hue: high dynamic range along the sheet, narrow blown-out specular bands, and a shadow tint much darker and cooler than the body colour. Heavy fine striping reads as brushed fabric.
- The `?dev` skip-ad button only exists when the SDK reports a `local` environment or the host is localhost, so it can never reach production.

## 9. Changelog

- **2026-09-07 (a)** — Project created. Researched full CrazyGames developer + advertising documentation. Established prime directives, game design spec, monetization rules, compliance checklist, SDK reference, art/audio direction, and architecture. Decisions locked: vanilla JS + Canvas 2D (zero deps), portrait-first responsive with desktop letterboxing, hybrid wood art.

- **2026-09-07 (b)** — Vertical slice built and verified headlessly at 390×844, 1280×800 and 800×450. Working: full cut mechanic with graded accuracy bands and a damage meter, procedural level curve, star scoring, coins, sawdust/sparks/confetti/screenshake, synthesised audio with error-tracking blade whine, plank split animation, complete and fail panels, rewarded + midgame ad paths, and **real SDK integration** (`init`, `loadingStart/Stop`, `gameplayStart/Stop`, `reportGameCompletedPercentage`, `happytime`, `data` save with localStorage fallback) confirmed firing in `local` mode.

  Changed from the original plan:
  - **Wood art is JPEG, not WebP** — universal support, no fallback logic, 328KB total.
  - **Layout is height-adaptive**, not a fixed 9:16 letterboxed stage. See §7.
  - **Tolerance is shown by glow radius, not a filled band.** The filled version looked like a green stain on the wood.
  - Added **ad watchdogs** after testing found the game could hang forever in the `ad` state.
  - `PLANK_WIDTH` moved to `plank.js` (was `input.js`) and widened 300 → 360.

  Not yet built: Workshop, daily challenge, saw upgrades, banners, level select, and the submission assets (covers, preview video).

- **2026-09-07 (c)** — Owner feedback pass. Rebuilt the scene as a true **top-down** view (bench surface, scroll saw with an overhead arm sweeping in from the right, presser-foot yoke, dust hose under the board); removed the eye-level wall, pegboard and drawers. **Ad policy rewritten**: 10-minute grace, player-initiated transitions only, any ad resets the clock. **Difficulty stretched ~4.5x** so it stays easy for the first 10 minutes. Added the **combo multiplier**, **odd finds**, and **perfect turns → keys → treasure chest**. Added materials (weathered barn board, steel, copper, brass, realistic metals) with **matched workshops, per-material guide-line colours, particles and audio profiles**. Fixed wood grain to wander instead of running ruler-straight. Blade now flexes with steering and heats up off the line; corners fire a directional dust burst instead of a constant dribble; leaving the board entirely is its own dramatic event. Dev-only skip-ad button.

  Bugs caught by testing this pass: corner detection fired on gentle curves and paid 1000+ coins on level 1; pop text drew over the results panel.

- **2026-09-07 (d)** — Second owner feedback pass.
  - **Fixed a real bug: plank texture tiles were anchored to SCREEN coordinates**, so the grain never moved and the board looked completely static while feeding. Tiles are now anchored to the plank's own top edge. There is a regression test for this (`scroll.mjs`) that checks the grain pattern actually translates.
  - **Metal now looks metallic.** A static texture always reads dead, so metal and ice get a live specular pass composited on top: broad reflections that slide as the player steers, plus glints that travel down the sheet as it feeds. Keep the multiply-darkening pass mild — an aggressive one crushes the sheet to near-black, which is what "grey and lifeless" looked like.
  - **Objects are sized relative to each other** (watermelon 1.15, can 0.62 …) rather than all being one size.
  - **Built the whole meta layer**: Workshop screen, Build projects, consumable supplies with an in-run helper bar, star chest, quest board, daily challenge with streak.

  Still not built: banners, level select, submission assets (covers, preview video).

- **2026-09-08** — Third owner feedback pass. Owner kept the upgrades page, materials and sound effects; everything else below was raised as a problem and fixed in this pass.

  **Fixed a hard soft lock in the ad path (two independent bugs).** `runAd()` only restored `game.state` on the error path, so DOUBLE COINS completed, paid out, and left the game frozen on the ad cover — reproduced headlessly (coins 60059 → 60118 with `state` still `"ad"`). And the dev skip was a canvas button sitting under the SDK's `div#local-overlay` (`z-index: 10000`, pointer events on), so it was never clickable at all. Both rules are now written down in §3.

  **The Build screen is now a whole screen of real 3D.** Added `model3d.js`, a dependency-free software rasteriser (quad meshes, painter's sort, lambert shading, screen-space backface culling, orbit camera, translucent faces for glazing), and `models.js`, which carries part-by-part geometry for all five projects — 600–1300 faces each, deliberately saturated rather than realistic. The player orbits by dragging and zooms by wheel or pinch; a bought part physically drops in and locks on; unbought parts are a 24%-opacity ghost of the finished thing. The Workshop card now shows the same 3D geometry as a badge, so the two can never drift apart.

  Modelling bugs caught by rendering test grids: every roof was hand-placed and floated off its walls (replaced with one `gable()` helper that derives slope, panel length and shingle courses from eave height, ridge height and half-width); the cabin had **no roof at all** and its water plane was so large it blew out the auto-framing; the shed's door and window z-fought with the cladding; camera fitting used the bounding sphere and under-filled the frame by ~40%.

  **Chests are opened by the player.** New `chest.js`: a 3D chest with a hinged lid that the player taps three times, knocking off one latch per tap, light leaking from the seam as the lock weakens, then a burst with light shafts and loot cards that fly out and land. Both chest sources route through it. The three-keys chest is no longer auto-credited on the results screen — it becomes an OPEN TREASURE CHEST button.

  **Menu motion.** New juice layer in `fx.js` (shockwave rings, coin flights, screen flash, rolling numbers). Results panel springs in; stars land with rings, sparks and a flash; breakdown rows cascade; the coin total rolls up; buttons stagger in. Purchases punch the tapped button and fly coins between the counter and the item. Workshop cards stagger in on open.

  **The guide line no longer ends on screen** — it now runs `(L.h - L.bladeY) + 220` behind the blade, i.e. off the bottom edge, so the player can look below the blade and compare the kerf against the line. Asserted by `__guideExtent()` rather than eyeballed.

  **Inverted steering** added as a persisted setting (Workshop → Settings), verified functionally: the same input produces +300 with it off and −300 with it on.

  Also hardened: `setPointerCapture` is wrapped in try/catch — it throws if the pointer is already gone, and an exception there aborts the listener and drops steering input entirely.

  Still not built: banners, level select, submission assets (covers, preview video). Still open: the theme/differentiation decision (§8).

- **2026-09-08 (b)** — Fourth owner feedback pass, plus the three items carried over from the previous entry.

  **Root cause of "it doesn't seem like you've implemented much at all": two of my failures, not one.**
  (1) `python3 -m http.server` sends no `Cache-Control` header, so Chrome heuristically cached the ES modules and served the previous session's code on reload. Added `tools/serve.py`, which sends `no-store`; CLAUDE.md now says to use it. (2) Even with fresh code, every new feature was behind "finish a level → WORKSHOP → scroll to the bottom". That is a design failure, and §2 now carries the rule it produced: **a feature more than two taps from gameplay does not exist.**

  **Pause menu + level select** (`menu.js`). A gear on the play HUD opens a menu at any moment, mid-cut included, with Resume, Level Select, Build, Workshop, Invert Steering and Sound. Level select is a scrolling grid showing every level reached plus a row ahead, with its material and best stars per cell.

  **Boards now vary in length and width** per level, deterministically from the level number. `PLANK_WIDTH` is no longer authoritative: `render.js` reads `cut.plank.width` throughout and derives the texture tile height from it, and `buildPlank` scales the guide line's amplitude to the board so a narrow plank does not become unplayable.

  **The saw was rebuilt.** The owner's three complaints were all correct: the arm did not look like metal, the blade made no physical sense floating entirely above the wood, and the contact point was hard to locate. Added `tools/gen_machine.py` (cast iron / brushed stainless / blade steel, same FFT method as the wood); the blade is now drawn in two passes either side of the plank so it genuinely passes through the board; the chuck and hold-down foot are one open-throat casting instead of two unexplained grey prongs; and there is an explicit contact reticle tinted by the accuracy band. See §6.

  Caught while doing it: filling a 66px-tall arm with a 512px pattern at 1:1 samples one near-uniform crop and looks exactly as flat as the gradient it replaced — the pattern has to be scaled down.

  **Banner ads implemented** (`sdk.js` + `main.js`), with every §3 constraint enforced in code. Verified 2 containers at 1280×800 and 1920×1080, zero at 390×844 and 800×450, never during gameplay, cleared before every video ad.

  **Submission assets produced** in `submission/`: three covers generated by `tools/gen_covers.py` from the game's own wood texture, and `preview_1080p.mp4` — a real 19.4s 1080p silent capture of the running game (CDP screencast, true frame timings), showing the cut, the results, the chest being opened and a build part landing. Ad banners suppressed for the capture. `submission/` must not ship in the bundle.

  Regression: no console or page errors at 390×844, 1280×800, 800×450 or 1920×1080.

  Still open: the theme/differentiation decision (§8). Still to write by hand: the store description and tags.

- **2026-09-08 (c)** — Owner reported the game freezing on the table background at launch. Reproduced exactly: their browser held a **stale cached `render.js`** from before the previous pass against the new `main.js`, so the first frame threw `R.drawBladeUnder is not a function`.

  The stale cache was the trigger; the freeze was a latent bug of mine. `requestAnimationFrame(frame)` was the **last** statement in the loop, so any exception in `update()` or `draw()` permanently un-armed it — the game stopped dead with no message, showing only the bench and saw table that had been painted before the throw.

  Fixed properly rather than papering over the cache:
  - **Reschedule first, work second**, with the body in a try/catch. Verified by injecting 45 consecutive throwing frames mid-game: the loop survives the fault window and resumes normally afterwards.
  - **Frame errors are counted and surfaced.** A streak of 30 raises a DOM overlay with a reload button; it clears itself after 120 clean frames.
  - **`checkModules()` at boot** verifies the exports `main.js` calls actually exist, so a stale bundle produces "Stale files cached — hard-reload (Ctrl+Shift+R)" instead of a silent freeze. Verified by serving a deliberately stripped `render.js`.

  See the new "frame loop must be crash-proof" subsection in §6. Regression re-run clean at 390×844, 1280×800, 800×450 and 1920×1080, ad paths included.

- **2026-09-08 (d)** — Owner reported the game stuck on the loading screen. I could **not** reproduce it (8 cold loads in real headless Chrome with fresh profiles, plus a LAN-IP host, all boot fine), but the investigation found two genuine defects, both mine, both introduced by the previous two fixes:

  - **`tools/serve.py` was single-threaded.** I wrote it to fix the caching problem and used a plain `socketserver.TCPServer`, where `python3 -m http.server` uses `ThreadingHTTPServer`. A browser opens up to six keep-alive connections per host; against a single-threaded server one held-open socket blocks every other asset and the page stalls half-loaded. Now `ThreadingMixIn` + `HTTP/1.1`.
  - **Boot had no timeouts and no watchdog.** `await SDK.initSdk()` and the texture loads could hang forever with nothing on screen but "LOADING…". Both are now raced against timeouts, `boot()` is wrapped in try/catch, and `index.html` carries a non-module watchdog that names the failure after 12s.

  Verified: a healthy boot clears normally; assets that hang forever no longer prevent the game starting (it degrades to flat fills); a module that fails to load now shows the real error and the page URL with a reload button.

  **Process note:** I diagnosed this class of problem twice from my own environment and was wrong about the user's both times. Reproduce from the user's actual conditions — warm cache, their URL, their browser — or instrument the failure so the software reports it, rather than inferring from a passing test.

- **2026-09-08 (e)** — Owner reported the framerate had collapsed. Measured at **8.5 fps** at 430x900 @2x — my saw rewrite was the cause.

  Found by ablation, not inspection: instrumented canvas calls accounted for 0.5ms of a 116ms frame, because the cost is in deferred rasterisation, not JS.

  | fix | effect |
  |---|---|
  | Removed 3 per-frame `ctx.filter = 'blur()'` | 8.5 → 30 fps |
  | Cached the bench as a sprite (static per workshop/layout) | +~11ms/frame |
  | Cached the saw arm + head as a sprite | removed 6 `createPattern` + ~20 gradients + blurs per frame |
  | Guide line: one `Path2D`, glow by translucent strokes instead of `shadowBlur` | +~5.6ms/frame |
  | Clamped `plankShading`/`drawSheen`/clip/shadow to the viewport | boards are up to 4x taller than the screen |
  | Cached the workshop's 3D project badge | workshop 27 → 59 fps |

  Final: 60 fps at 430x900 @2x and 1920x1080 @1x, 48 at 1280x800 @2x, 59 workshop, 53 build screen — all under headless software rasterisation, so real hardware is faster. Visual output verified unchanged by screenshot. Full regression clean at all four sizes.

  New §6 subsection records the rules (no per-frame blur, no shadowBlur on long paths, cache static layers, clamp fills to the viewport) and says to re-run the ablation when touching the renderer.

- **2026-09-09** — Picked up the two things the previous session left unfinished.

  **Saw upgrades were never built.** They were listed as "not yet built" on 2026-09-07, then quietly dropped out of the carry-over list on the next three passes while banners, level select and the submission assets were tracked properly. Nothing in `src/` contained the string "upgrade" at the start of this session, and §3's fourth rewarded-ad placement — "instant saw upgrade completion" — described a screen that did not exist. Now built: four parts, four tiers each, on their own screen two taps from the cut (gear → UPGRADE THE SAW, plus a card in the Workshop column). See the table in §2.

  Every tier moves a number the cut mechanic reads — tolerance, feed speed, look-ahead, damage and repair — because §8.5 says upgrades that only recolour things exhaust fast. The values are baked onto the cut at `createCut()` rather than read from `meta` in the step loop, so a purchase cannot change the board being cut, and `drawGuideLine` now sizes the glow from `cut.tol` so a sharper blade visibly widens the margin the player is being scored against. A `tests`-free build is still the rule, but `window.__sawMods()`, `__cutMods()` and `__upgrades()` exist so this is assertable headlessly rather than by eye.

  **The Guide Laser is not "more line".** The guide line already runs the full height of the screen, so extra look-ahead had to mean something else: a beam rising from the blade, a crosshair sitting on the line N pixels further along, and an arrow head **on the beam** — the crosshair is what has to travel and the beam is where it has to get to. First version drew it with `globalCompositeOperation = 'lighter'`, which over pale pine washes out to near-white and effectively vanishes; straight alpha keeps the hue on every material. Measured 60 fps with it on at all four test sizes.

  **Rewarded ad placement #4 implemented as "finish a fitting"**, not "skip the economy": offered only between 50% and 100% of the next tier's cost, it consumes the coins the player has, and only one offer is ever on screen at a time.

  **Store listing copy written** — `submission/listing.md` carries the title, tagline, long description, controls, category and tags ready to paste into the portal. Category is **Puzzle** (21 min platform average vs 8.6 hypercasual) and the game honestly supports the tag.

  Regression: 430×900@2x, 1280×800@2x, 1920×1080@1x and 800×450@1x — no console or page errors, 60–61 fps on the new screen and in play with the laser running, upgrades persist across a reload (save bumped to v5; pre-v5 saves load with an unfitted saw).

  Still open: the theme/differentiation decision (§8) — owner's call, untouched.

- **2026-09-09 (b)** — Owner feedback pass: *"I can see inside the 3D rectangles… like falling through the map and looking up at the inside of the objects."* They were exactly right, and it was three separate renderer faults — see the new "3D renderer" subsection in §6. The severe one was an **inverted depth axis**: the painter's sort was drawing near-first and far-last, so every solid was drawn inside-out. Found by rendering two boxes at known depths and sampling the pixels, not by reading the code, because backface culling uses screen-space area and therefore kept single objects looking correct. Also fixed: every cylinder was wound inside-out, and the Build screen's unbought-remainder ghost was an x-ray instead of a preview.

  **Upgrades reworked from four parts to eight, in two groups**, and every fitted part now has an **ON/OFF switch** — the owner asked for it about the laser specifically, and the general principle is that an aid you cannot remove is something you paid to be stuck with. New parts: Flywheel Drum (combo tiers arrive sooner), Timber Ledger (more coins per board), Salvage Crate (odd finds worth more), Micrometer Gauge (a bonus paid against accuracy cubed). The last two show as their own lines on the results panel, so a purchase visibly pays out.

  **The Guide Laser stopped escalating its look-ahead distance.** The owner's objection — "if it's too far away it's useless" — is correct: a marker further up the board describes a corner you cannot steer for yet. Distance now barely moves (130 → 190px) and the tiers add capability instead: arrow, corner warning, second pip.

  **Added the SPLIT meter.** Board damage was previously only a red vignette, which meant Wood Filler ("clears all damage") and Dust Extraction had nothing on screen to point at — the owner asked what both of them actually did. There is now a labelled bar under the level progress bar, and both the helper and the upgrade are described in terms of it. Helper buttons also carry a plain-language sub-label (HALF SPEED / AUTO-STEER / FIX SPLIT).

  **Continue-after-fail was broken** and is fixed with a 3-2-1 count-in; see §3. **Slow-Mo now stretches the other helpers' timers** rather than letting them burn off at half value. **Dev-only RESET PROGRESS** added to the pause menu, gated on `isDev()` exactly like the ad skip.

  Regression at 430×900@2x, 1280×800@2x, 1920×1080@1x, 800×450@1x: all 32 upgrade tiers buy, all eight toggles return the game to neutral and back, results panel shows the new lines, build screen and chest render solid, banner policy unchanged (2 desktop / 0 phone), dev reset returns a first-install state, 57–60 fps, zero console errors.

- **2026-09-10** — Session opened with "start the server and finish anything left in the middle." Nothing was mid-flight, so the outstanding work was re-derived from the code rather than from the previous entry's carry-over list — which is how the saw upgrades went missing for four passes. The audit found two things documented here but absent from `src/`, and the code found two more.

  **The daily free chest had never been built.** It has been listed as rewarded placement #3 in §3 since 2026-09-07 while nothing in the code opened one; the only two chest sources were the star chest and the three-keys chest. It is now on the pause menu and at the top of the Workshop column, both of which drop the entry once it is claimed, and it opens through the existing `chest.js` ceremony. `meta.dailyChest` persists it (save v7; pre-v7 saves load with one waiting, which is the right way round for a returning player).

  The design decision worth keeping: **it is offered on an ad but never gated behind one.** Basic Launch disables ads for 7-21 days, which is precisely the window where D1 retention is measured — a return hook that only works after Full Launch does not defend the number it was built for.

  **Escape was being trapped.** `e.preventDefault()` on the Escape keydown is an explicit §4 rejection trigger, because Escape is how a player leaves fullscreen. It no longer preventDefaults, and it returns early while `document.fullscreenElement` is set so the same keypress cannot both exit fullscreen and jump a screen backwards.

  **Banner requests were leaking unhandled promise rejections.** `requestBanner()` returns a promise that rejects whenever the container does not fill — routine in local mode, common in production — and the call was wrapped in a bare `try/catch`, which only guards a synchronous throw. Every desktop load printed "Uncaught (in promise)" twice. Caught properly now, and `clearAllBanners()` with it. Found by the regression run, not by reading: the previous pass's "zero console errors" claim was measured on sizes where banners do not appear.

  **Three UI overlaps on the Workshop screen**, two of them pre-existing — see the new "UI text must fit the box" subsection in §6.

  Regression: 430x900@2, 1280x800@2, 1920x1080@1, 800x450@1 and — for the first time — **907x510@1**, the minimum desktop resolution §4 names and the one size that had never been in this project's regression set. All sizes: boots into gameplay, chest claims and pays out, claim survives a reload and returns the next day, Escape not swallowed, workshop/upgrades/build still route, banner policy unchanged (2 desktop / 0 phone, short and 907x510), 60 fps, zero console errors. `tools/harness_3d_selftest.html` still passes all 11 assertions.

  Still open: the theme/differentiation decision (§8) — owner's call, untouched.

- **2026-09-13** — Owner feedback pass, five items, all reproduced and all real.

  **The chest was not hollow.** With the lid open you looked straight at the body box's
  +Y face — a lit wood plank at the rim — so the chest read as still shut. It is now a
  floor and four walls with a dark inside liner, and the iron straps no longer run a
  metal bar across the open mouth. See the new fourth rule in §6's 3D subsection.

  **The blade did not reach the work.** The only blade on screen was the stub below the
  contact point, so the machine connected to nothing and the board read as being seen
  from below. There is now an upper run from the contact point up into the head's clamp
  jaws, drawn after the plank because it sits above the board. See §2.

  **`DEV: SKIP AD` did nothing visible.** It settled our pending ad but left the local
  SDK's `div#local-overlay` on screen with its own countdown still running, so the
  screen stayed grey and the player still waited out the full duration. See §3.

  **Level select existed but was unfindable** — it was only ever a row on the pause
  menu. It now also has a Workshop card and a LEVELS button on the results panel, with
  `game.levelsReturn` sending BACK to whichever screen opened it.

  **The odd finds looked like clipart**, because they were: flat vector cartoons with
  no lighting at all, against photographic wood. Replaced with salvage — coin, marble,
  brass screw, cut nail, bottle cap, key — each lit from the work light's actual
  position over the blade and bedded into the board. New §6 subsection records the
  technique and the two bugs found on the way (footprint-tracked sockets, and never
  compositing `destination-out` onto the shared canvas, which erases the board rather
  than the object). New dev harness `tools/harness_finds.html`.

  Measured, per §6, rather than assumed: with 8 finds forced on screen at 1280x800 @2x
  the new art costs **1 fps**, so it is not worth caching. Regression clean at
  430x900@2, 1280x800@2, 1920x1080@1, 800x450@1 and 907x510@1 — zero console errors,
  every route intact, banner policy unchanged (2 desktop / 0 phone), 3D selftest 11/11.

  **Found but NOT fixed — metal and ice boards are slow.** 16 of the 140 levels use a
  metal or ice material, and they run 27-48 fps at 1280x800 @2x against 48-57 for wood
  (level 35, brass, is the worst at 27). Ablation confirms this is pre-existing and
  nothing to do with this pass: disabling the new finds and the new blade run changes
  it by 1 fps. The cost is `drawSheen` — three full-plank `lighter` gradient fills, a
  run of radial glints, and a full-plank `multiply` fill, every frame, none of it
  cached. The fix is the one §6 already prescribes (cache what doesn't move), but it is
  a renderer change the owner has not asked for, so it is recorded here rather than
  taken on unasked.

  Still open: the theme/differentiation decision (§8) — owner's call, untouched.

- **2026-09-13 (b)** — Second owner feedback pass on the same session's work.

  **The chest and the buildings still flickered.** Root cause found by instrumenting the
  sort rather than by looking: the swapping faces had a depth gap of *exactly zero* —
  they were coplanar. A painter's-algorithm renderer has no answer for that, so the
  models must not create it. `resolveCoplanar()` now runs at build time over every mesh
  (chest and all five projects) and separates such surfaces by 0.006 along build order.
  Getting it to converge took three corrections, all recorded in §6's new rule 4; the
  most instructive is that a part nudged clear of one plane can land inside tolerance of
  another a hundredth away and oscillate forever, which is why the tolerance has to be
  far smaller than the nudge. **An attempt to fix this in the renderer instead — sorting
  whole primitives rather than faces — made it measurably worse and was reverted.**

  `tools/harness_3d_selftest.html` grew a **static** assertion for it (no two faces from
  different primitives may be coplanar and overlapping), now 21 checks. Static and not
  "does it flicker when spun": faces legitimately reorder as a model turns, and telling
  that apart from a pop after the fact is guesswork. A first attempt at the dynamic
  version flagged every model and proved nothing.

  **The blade.** Everything below the contact point is gone — the stub trailing down the
  kerf was what made the board look like it was being seen from underneath. The upper run
  is now serrated on both edges, reaches far enough up to finish inside the casting, and
  no longer bobs at its clamped end (bobbing both ends was the "sometimes disconnects
  from the machine" the owner saw). See §6.

  **The dev skip had a second, inert button.** A canvas-drawn "DEV: SKIP AD" sat under
  the SDK's z-index-10000 overlay and could never be clicked, so the skip worked or not
  depending on which of two identical buttons you aimed at. Canvas one deleted. The
  forced-midgame path is now testable directly via `SDK.expireAdGrace()` / `__expireAdGrace()`
  and verified end to end: overlay torn down and gameplay resumed in ~0ms, at four
  different click timings.

  **The flawless cut.** 100% now awards a fourth PURPLE star under a FLAWLESS title, with
  a real explosion and `bigFanfare()`. The results panel also gained the accuracy METER
  — fills to the cut's accuracy, marked gates at 76 / 93 / 100%, and "N% short of 3
  stars" underneath. See the new §2 subsection.

  Regression: 430x900@2, 1280x800@2, 1920x1080@1, 800x450@1, 907x510@1 — zero console
  errors, every route intact, banner policy unchanged, the taller results panel still
  fits at 907x510, 3D selftest 21/21.

  Still open: the theme/differentiation decision (§8), and the metal/ice board framerate
  recorded in the previous entry — both owner's calls, both untouched.

- **2026-09-15** — Owner feature pass: a main menu, a 100-level campaign, and Endless.

  **The game now launches on a main menu.** Every previous pass dropped the player
  straight into level 1 on the conversion argument, and twice the consequence was the
  owner not being able to find features that had been built — the gear on the play HUD
  was the only route to level select, the Workshop, the Build screen and the saw
  upgrades. §2's "four-second comprehension" is rewritten around the new shape: PLAY is
  one tap, it is the only tall button on the screen and it resumes the player's level,
  and **the game runs behind the menu** — a board of their current level feeding
  through the saw and being cut perfectly — so the first thing on screen is still
  gameplay. Everything else on the menu is one tap from launch: level select, Endless,
  Build, Workshop, saw upgrades, sound, invert, and the daily chest on the day it is
  available.

  Every screen's BACK now returns to whichever screen opened it (`wsReturn`,
  `upReturn`, `buildReturn`, `levelsReturn`). The Workshop used to hardcode a return to
  the results panel — a screen that does not exist when it was opened from the menu —
  and its button said "BACK TO CUTTING" while about to do nothing of the kind.

  **The campaign is now exactly 100 levels** and the curve was rebuilt to fit them.
  `d = 22u + 12u²` keeps the opening levels at the old slope (that half of the curve is
  what protects conversion) and steepens the last quarter, ending at d = 34 against the
  old ceiling of 30.9 — so the hardest boards are harder than anything the old 140-level
  curve reached, and they arrive while the player is still playing rather than at a
  level number most players would never see. Caps raised to match: feed 400px/s,
  amplitude 150, frequency 4.2, tolerance floor 9.5, zigzag 0.95. **Boards lengthen with
  difficulty** — `2500 + 190d`, so ~13s at level 1 against ~24s at level 100, and the
  length wobble damps out at the end so the last chapter never hands back a short board.
  Whole campaign: ~31 minutes of cutting.

  **New difficulty lever: `detail`.** Amplitude and zigzag alone stop biting, because a
  big regular shape is still predictable. From d ≈ 14 a small slow wander is laid over
  whatever the line is already doing — added AFTER the zigzag blend, so a zigzag board
  gets it too rather than losing it to the parameter that makes the board hard. Its
  wavelength is ~300px on purpose: about a second of board at full speed. A first
  attempt tied it to the line frequency and produced a 69px wavelength, which is a
  jitter nobody can steer for — difficulty of the wrong kind. Level 100's line changes
  direction 73 times; level 1's changes 8.

  **Endless**, unlocked by finishing level 100. Two axes rather than one difficulty
  number — board speed and line complexity, five steps each — because those are the two
  things that decide how a board plays and players split on which one they can read. The
  line tiers feed the same `paramsFor()` the campaign uses, so there is no second
  difficulty model to drift. Both axes raise the coin multiplier (0.64x → 5.28x, its own
  line on the results panel), a run tightens as it goes, one ruined board ends it, the
  rewarded continue is once per RUN rather than once per board, and records are kept per
  difficulty pair — one shared record would make the easy settings the only place a
  record can be set. See the new §2 subsection.

  Caught while building it: the fail panel grew a MAIN MENU row for endless runs
  without adding its height to the panel, so the button hung outside the card — the
  exact fault §7 warns about, found in a screenshot and not in the code.

  Save bumped to **v8** (`meta.endless`: unlock flag, last-picked difficulty, per-pair
  records). Pre-v8 saves load with Endless locked unless they already hold a star on
  level 100, in which case it unlocks on load rather than asking the player to finish
  the campaign a second time.

  Regression at 430x900@2, 1280x800@2, 1920x1080@1, 800x450@1 and 907x510@1: zero
  console errors, every route out of the main menu returns to it, the campaign-complete
  panel and the endless picker fit at the smallest desktop size, banner policy unchanged
  (2 desktop / 0 phone). Endless verified end to end — pick difficulty, run boards,
  spend the continue, lose the run, bank the record per setting, start a new one.

  **Measured, not assumed: the late campaign costs frame rate.** At 1280x800@2 under
  headless software rasterisation, level 1 runs 56 fps and level 100 runs 30 (37 with
  the blade tracking the line, since a board being ruined adds the damage vignette and
  a lot of dust). Ablation says nothing dominates — the whole plank is ~8ms, of which
  shading, the guide line, the texture and the kerf are 1-4ms each, and the bench and
  saw are ~2ms each; JS time is under 1ms in every case, so it is all deferred
  rasterisation. It is the same band the metal/ice boards have been in since 2026-09-13
  (27-48 fps here) and real GPU compositing is substantially faster than this
  environment, so it is recorded rather than optimised — but if the renderer is touched
  again, the long wiggly line at tight tolerance is now the most expensive board in the
  game.

  Still open: the theme/differentiation decision (§8), and the metal/ice board frame
  rate — both owner's calls, both untouched.

- **2026-09-16** — Owner feedback pass: the odd finds could not be identified, and the
  saw hid the line in front of the blade.

  **Finds replaced** with coin / pocket watch / screw / nail / horseshoe / key (was coin /
  marble / screw / nail / bottle cap / key — five discs). Chosen by silhouette, rendered
  offline by the new `tools/gen_finds.py` into lit sprite strips, drawn 1.35× larger,
  long ones laid along the line, and the guide line's core re-drawn over them so a big
  find never hides the path. `OBJECT_TYPES` keeps six entries in the same slots, so every
  level still rolls the same number of finds at the same places. See §6 "Code-drawn
  props must be lit by the scene".

  **Saw slimmed:** the two-lobed head, clamp jaws and hold-down pads are gone; a 26-unit
  arm (was 60) ends in a 30×26 chuck, the visible blade run is 54 (was 92), and the
  tension knob sits out over the bench. See §6 "The saw machine".

  Measured at 1280x800@2 (headless software raster): lv1 51fps, lv33 54, lv58 51;
  430x900@3 lv33 60. Zero console errors through menu, campaign and an Endless run.

- **2026-09-17** — Audit pass, then an owner report that the buildings and the chest
  had parts missing.

  **Full bug comb + headless playtest** of the whole game: every screen route, a full
  Endless run, continue-after-fail, the ad paths, chests, quests, save round-trip, a
  30-board soak and a 300-tap fuzz. Findings recorded but NOT yet fixed: three of the
  eleven wood textures (`weathered`, `steel`, `copper`) are never loaded so those boards
  render as flat colour; the mute setting does not survive a reload (`setMuted` writes a
  gain node that does not exist until the first gesture, and `initAudio` then hard-sets
  0.9), which also swallows `SDK.game.settings.muteAudio`; `clearBanners()` resets the
  per-container `shown` flag and so defeats the ≥30s refresh rule (2 → 14 refreshes in
  seconds of screen flipping); completing a Build project swaps to the next project's
  ghost on the same frame, so the finished model is never shown; `resultStarY()` is 42px
  out of step with `drawComplete()`, so every star's impact ring lands below its star;
  `clampCamera`'s hard `dist >= 3.6` overrides the Build screen's per-project zoom range
  (the birdhouse zooms in by 8%); retrying a failed Daily Cut starts the campaign level
  instead; and levels 88-100 spend up to 23% of the board with the guide line pinned
  dead-straight against `maxOffsetFor(width)`.

  **Fixed this session, all of it 3D:** the painter's sort ignored the per-primitive
  depth key it computed (chest lock and latches vanishing behind the lid); the shed's
  rafters painted through its own roof, now settled with the new `LAYERS` table; the
  workshop's roof panels were pitched the wrong way and crossed through their rafters;
  the cabin's veranda roof was pitched the wrong way and read as a slab floating beside
  the building; the cabin's chimney smoke was translucent and rendered as wireframe
  blobs. See the four new rules in §6.

  Verified: 40/40 checks in `harness_3d_selftest.html`, a 16-angle sweep of the chest
  (open and shut) and all five projects, every project bought part by part in the real
  Build screen, the chest ceremony end to end, zero console errors, and `renderModel` at
  1.6-3.3ms per render (build screen 31fps at 1280x800@2 under software raster, the same
  band as before).

- **2026-09-18** — Owner feedback pass: a reset that did not reset, an ad rule that was
  too generous, a bar to nowhere on the results panel, and the buildings replaced.

  **The reset was genuinely broken, not merely hard to find.** `resetProgress()` called
  `save()` BEFORE `startLevel(1)`, and `save()` does `meta.levelNum = game.levelNum` — so
  a reset wiped coins and wrote the player's CURRENT level straight back over the fresh
  save. On the next load `maxLevel` was derived from it and the whole campaign position
  came back. Fixed by starting the level first and saving after. Console commands
  (`resetProgress()`, `__reset()`, `wipeSave()`) clear both stores and reload for a true
  cold boot; they sit outside the hostname gate and self-gate on `isDev()` at call time,
  because `isDev()` also accepts an SDK `local` environment and a LAN address with
  `?useLocalSdk=true` used to draw the reset button while `__reset` was undefined.

  **Forced-ad grace narrowed to first-session and 7-day-lapsed only.** See the new table
  in §3. Save bumped to **v9** (`meta.lastPlayedAt`). The player-initiated-transition
  rule is untouched and still absolute.

  **The "weird metal bar" on the results panel was the saw ARM**, which ran from the
  blade to `L.right` and stopped at the screen edge. During a cut the board, blade and
  chuck explain it; on the results panel the board has split away and the card covers
  the chuck, leaving a bar across the bench held up by nothing. It now ends in a bolted
  cast COLUMN standing on the bench (`ARM_COLUMN_X = 430`). The saw sprite's bounds and
  cache key no longer depend on `L.right`, so it also survives a resize.

  **The chest is an imported CC0 model** ("Low Poly Chest [2.0]", The_3Darknight), baked
  by the new `tools/gen_chest.py`. The hinge is read from the model's own armature
  rather than guessed. Only the three poppable latches and the padlock are still built
  by hand, and they are placed off the imported casing's measurements.

  **The five hand-modelled buildings are gone.** The Build screen is four KITCHENS fitted
  out object by object, from a CC0 art pack baked by `tools/gen_kitchen.py`. `models.js`
  is deleted; `meta.js` PROJECTS is derived from `kitchens.js`. Each kitchen has a room
  shell (floor and two walls) because the cabinet and window are wall-mounted and were
  otherwise hanging in mid-air. See the new §6 "Imported 3D art" for the four modelling
  rules and the two process rules this cost to learn.

  **Star meter fixed:** it drew gates for stars 2, 3 and flawless only, so a three-star
  cut showed three stars in the panel and two on the bar. The first star now has a
  marker too.

  **Every board counts in 3-2-1-GO,** not just revives and resumes. A player tapping
  PLAY was dropped onto a moving board, and on first launch into a game they had never
  seen. `countIn()` is reused; its sub-label now reflects why it is running.

  **The menu's backdrop board no longer reseeds itself.** It did `lv.seed += random`, so
  the board idling behind the main menu was a different board from the one PLAY started.
  Campaign lines are fixed per level by design and the menu is a preview of the real one.

  Verified: every screen route at 430x900@2, 1280x800@2 and 907x510@1 with zero console
  errors; ad-grace boundaries (first / 8d / 7.01d / 6.9d / 2d / 1min / future clock);
  reset surviving a reload; the chest ceremony end to end; the Build screen buying parts.

- **2026-09-18 (b)** — Second owner feedback batch, first block.

  **Consumable supplies deleted** (Slow-Mo / Steady Hand / Wood Filler), with the shop
  card, the in-run bar, the buy and use handlers and the save field. The owner never
  used one and the reason generalises — see §2. Chests paid a random consumable as their
  second reward and now pay KEYS instead. Save still loads pre-v9 files; `d.helpers` is
  read and ignored.

  **Feed speed is no longer a difficulty lever.** Fixed `BASE_SPEED = 250` for the whole
  campaign. Speed is a gimmick now. Endless keeps its player-chosen speed axis.

  **Every level from 4 on has an announced gimmick** — ten of them, pairing from level 22,
  gated by a per-gimmick `from` level, shown on the count-in before the board moves. See
  the new §2 subsection. Measured across the campaign: 27 distinct labels, 20 paired
  levels, 3 plain, four distinct feed speeds (250 / 363 / 388 / 500) all of them
  announced.

  **Board size varies far more** — width 165-520, length 1500-8000+, from three
  incommensurate terms instead of two. Base length climbs only gently (2200 → 4200).

  **Three board types were silently broken and are restored.** `weathered`, `steel` and
  `copper` are defined as materials and ship as real .jpg files, but were never in
  `loadTextures()` — so those boards rendered as a flat fill. Found in the 2026-09-17
  audit, fixed here and verified by screenshot.

  **Every board counts in 3-2-1-GO** (also in the 2026-09-18 entry above), which is what
  gave the gimmick announcement somewhere to live.

  Verified: every screen route at 430x900@2, 1280x800@2 and 907x510@1 with zero console
  errors; the campaign's 100 levels generated and inspected; the three restored textures
  screenshotted on real boards.

  Still open from this batch: the board-to-board JUMP mechanic, odd finds being cut in
  half rather than despawning, multi-factor star scoring (accuracy + finds + combo +
  jumps), new coin art, a sticky coin/key HUD in the menus, a visually interesting daily
  streak, and more ice transparency / additional materials.

- **2026-09-18 (c)** — Owner reported the kitchens still looked wrong, plus three
  specific bugs. Fixed, and one investigated and deliberately left open.

  **The kitchen objects are no longer tinted.** Each was being pulled a third of the way
  toward a per-kitchen accent hue, which is what the owner saw as "a weird effect or
  overlay". The pack is a coherent pastel set already; per-kitchen character now comes
  from the ROOM (walls, floor, backdrop), which changes the light the objects sit in
  without repainting them.

  **Walls are a BACKDROP layer and never occlude the furniture.** They were depth-sorted
  against it, which cannot work: a wall is tall and thin, so its centroid sits high, and
  with the camera pitched down a high centroid reads as NEAR — the back wall sorted in
  front of a counter standing before it. Same fault as a roof against its own rafters,
  same answer: state it with a layer. A wall the camera has orbited outside now fades
  out (`wallAlphas`). **The fade's x-sign is not obvious**: renderModel's toward-camera
  vector is `(-sin yaw, 0, cos yaw)`, and getting it wrong inverts the left wall, so the
  one wall standing between the player and the kitchen is the one kept solid.

  **Walls are also segmented** (~0.9 units), so a long slab is not forced to sort wholly
  in front of or behind a given object. **`GHOST_ALPHA` 0.34 → 0.55**: that value was
  tuned for one large building massing and left a scatter of small unbought objects
  reading as simply absent. Room palettes warmed toward cream.

  **Materials: fourteen of the first sixteen levels were pine.** The six woods were
  banded into six equal chapters, so a player met two materials in their whole first
  session. The palette now WIDENS with progress while the choice cycles within it, and
  specials land every fifth level offset off the breather. First 20 levels now show 7
  distinct materials, no two adjacent levels alike, pine down to 20% of the campaign.

  **Star meter, two bugs.** The purple gate tested `acc >= 1.0` while `isFlawless` is
  `acc >= 0.995`, so a 99.7% cut lit the fourth star in the panel and left the gate
  below it empty. It reads FLAWLESS_AT now. And the first star was drawn without its
  gate line, which made it read as a stray mark near the start of the bar; every gate
  draws its line.

  **STILL OPEN — the travelling "split" in the board.** It is real and measured: a
  full-width single-row dip of 50-90/255 against a grain noise floor of ~1, drifting
  down the board at the plank's own speed. Two fixes were tried in `tileTexture` and
  BOTH were ruled out by measurement — overlapping the tiles, and replacing the loop
  with a wrapping `createPattern` fill. Neither moved the number, so the seam does not
  come from the texture tiling and that function is back to its shipped form. The next
  thing to rule out is the shading/sheen passes drawn over the texture, which are also
  anchored to the board and would travel with it in exactly this way.

- **2026-09-19** — The jump mechanic, the SPLIT bar made honest, finds sawn in half,
  and the travelling "split" ruled out by measurement.

  **BOARD JUMP / THREE PIECES.** The one thing in the game that is not "follow the
  line": the board arrives in pieces, steering goes dead over the hole, and a tap
  crosses it. See the new §2 "The jump" for all of it — the timing window, why a
  missed jump is not a loss, why nothing may come off a blade that is over a hole, and
  why the line's swing is halved on a jump board. Fourteen campaign levels carry it
  (one hole from 26, two from 58) and Endless takes one every third board from the
  fifth. `rearmJumps` keeps the rewarded continue honest.

  **The SPLIT bar was reported as "doesn't fill up or do anything" and it was right.**
  Damage only moves in the `off` band. The bar now shows live strain up to 45% of the
  track and real damage past a marked tick — see §2 "Scoring". One quantity, two zones,
  always alive.

  **A find the blade goes through is now sawn in half** and stays in the board, rather
  than blinking out on the frame it was collected. See §2 reward layer 3.

  **The travelling board "split" did not reproduce and is not in the code.** Measured
  across 15 levels, 6 materials, board widths 175-448 and four screen sizes, sampling
  two separated columns per frame and matching dips between frames displaced by the
  board's own travel: every dip found sits at a FIXED screen row (the saw arm, the
  table plate, the HUD) and none travels with the board. The wood textures were also
  measured directly — no dark row at any tile edge, so it was never baked into the art.
  Two candidate fixes were ruled out by the previous session and a third suspect
  (`plankShading` / `drawSheen`) is ruled out here by the same measurement: those passes
  are horizontal gradients and cannot produce a single dark ROW. The most likely
  explanation is that the 2026-09-18 board-size rewrite changed every board's width and
  length, and with them the tile height and its fractional alignment. Do not spend a
  fourth session on it without a fresh screenshot from the owner.

  Verified: every screen route (home / levels / workshop / upgrades / build and back)
  at 430x900@2, 1280x800@2 and 907x510@1 with zero console errors; a jump board played
  to completion at all three, with both holes of a THREE PIECES board crossed perfectly;
  a perfect jump landing in the `perfect` band at 98.6% accuracy and a missed jump
  costing the combo and its bonus without ending the run.

- **2026-09-19 (b)** — The rest of the owner's list: multi-factor stars, a rendered
  coin, a pinned currency strip, translucent ice and a daily streak that pays.

  **Stars are scored on more than the line** — see the new rules under §2 "Scoring".
  Accuracy plus a craft bonus worth at most six points, normalised over the components
  the board actually has, and incapable of buying a FLAWLESS.

  **The coin is a rendered sprite** (`tools/gen_coin.py`), struck with the game's own saw
  blade. See the new §2 "The coin is a rendered sprite".

  **Coins, stars and keys are pinned** to the top of the scrolling menus instead of
  scrolling away, and the coin flights start and end at the counter's real position. See
  §2 "The currency strip is pinned, not scrolled".

  **Ice is translucent**, with fractures and bubbles inside the sheet. See §2 "Materials
  and environments".

  **The daily streak is a seven-day ladder that pays** a multiplier and a chest on day
  seven. See §2 "Meta systems".

  Also: the daily chest's copy still promised "coins and a supply" months after supplies
  were deleted — it pays a key. And the results panel's chest button claimed "3 perfect
  corners" whatever the chest came from; it now names the streak when that is what earned
  it.

  Verified: every screen route at 430x900@2, 1280x800@2 and 907x510@1 with zero console
  errors, including a scrolled Workshop; a seventh-day Daily Cut played end to end
  (streak 6 -> 7, +100 streak coins of 219, one chest offered, labelled "7 day streak");
  the star meter at 100%/+6% craft still showing the purple gate lit and at 85%/+5% still
  reading "3% short of 3 stars".

- **2026-09-19 (c)** — Four new board materials, and the load list that can no longer
  go stale.

  **Birch, Zebrano, Purpleheart and Blued Steel**, generated by `tools/gen_wood.py`
  alongside the others. See §2 "Materials and environments" for why these four and for
  the new `sheen` scale. The early palette widens faster to match: three woods from
  level 1, all nine by 43.

  **`loadTextures` is derived from `MATERIALS`.** The hard-coded list is how `weathered`,
  `steel` and `copper` came to be real board types that had never been loaded.

- **2026-09-21** — Owner pass: the results meter, a briefing card for gimmicks, and the
  Build screen and chest moved to 2D.

  **The results meter** no longer runs past a gate it has not cleared, and no longer
  turns orange at the craft seam. See §2 "Scoring".

  **Gimmicks get a briefing card** that holds the count-in until the player taps GOT IT.
  Paired gimmicks list both (only the first one's copy was ever shown). See §2 "Every
  level has a gimmick".

  **The Build screen and the chest are 2D**, rendered offline in Blender; `model3d.js`,
  `kitchen_model.js`, `chest_model.js` and the three 3D harnesses are gone. See §6 "The
  Build screen is 2D". The counter and wall cabinet now face into the room (they faced
  the wall in every kitchen, unnoticed in flat shading).

  Bugs fixed from the 2026-09-17 audit: mute now survives a reload (§6 says honour the
  setting — `initAudio` hard-set the gain over it); the banner 30s floor can no longer be
  bypassed by clearing (§3); finishing a kitchen now shows off THAT kitchen, held until
  NEXT KITCHEN; a failed Daily Cut spends the day instead of offering a retry that
  dropped into the campaign; the Build screen's dead zoom is gone with the zoom. And the results panel's star-impact rings landed 42px below the stars (`resultStarY` was missing the meter's height). Found
  on the way: the daily streak was kept alive by opening the game, not by cutting —
  now measured from `meta.daily.last`.

  Verified headlessly at 430x900@2, 907x510@1 and 1280x800@2 with zero console errors:
  briefing card holds the count at 3.75s until Space; meter at 99%+6%, 100% and 85%+3%;
  the whole Starter Kitchen bought part by part to the showcase and on to the Family
  Kitchen; a star chest opened by three real clicks through to COLLECT.
  Build art ~165 KB, chest art ~370 KB on disk; the three deleted 3D modules were 350 KB.

- **2026-09-23** — Bug and exception sweep. Headless run of every route at 430x900@2,
  907x510@1, 1280x800@2, 800x450@1 and 1920x1080@1: campaign levels 1/2/7/14/26/42/58/
  77/91/100, fail -> continue by ad -> continue by coins -> retry, pause/resume mid-cut,
  every menu route, every kitchen bought through to the Chef's showcase, every saw upgrade,
  a run chest and the daily chest opened to COLLECT, a Daily Cut, Endless, mute across a
  reload, a 400-action fuzz, heap flat at 10MB. Zero page errors, zero failed requests,
  no soft locks.

  **One real bug, fixed:** the only console errors were the SDK's own "gameplayStart() /
  gameplayStop() call throttled" — and a throttled call is dropped, so a quick pause/resume
  desynced the platform's gameplay tracking. See §5 under the lifecycle block. Verified:
  four pause/resume flips 150ms apart now reach the SDK as start/stop/start spaced over a
  second apart, ending on start while the player cuts, with no throttle errors.

- **2026-09-26** — Owner pass: the board seam, and the Build screen's art.

  **The horizontal seam that crossed the board every few seconds is fixed.** It was
  the join between two texture tiles: `tileTexture` stacked `drawImage` tiles whose
  edges land on fractional pixels, the GPU rasteriser anti-aliases both edges, and two
  partial coverages of one row do not make an opaque row, so the board's dark shadow
  showed through as a line that moved with the board and vanished whenever the join
  happened to land on a whole pixel. The board is now ONE repeating-pattern fill
  anchored to its top edge, so there are no joins. The 2026-09-18 pass ruled this
  function out because headless SOFTWARE raster does not show it at all; with
  `--force-gpu-rasterization` the old code measured a dark row at the tile joins in
  most frames (up to 33/255), the new code none. **Measure rendering seams with
  GPU rasterisation forced on**, or you are testing a different renderer from the
  player's.

  **The kitchen objects are modelled in code** instead of the imported pack, and the
  four layouts are re-planned around their real sizes (same part count per kitchen, so
  saves are unaffected). See §6 "The Build screen is 2D". Art is 209 KB.

  Verified: `tools/harness_build2d.html` — every kitchen empty/half/complete, every
  object facing into the room; the Build screen at 430x900@2, 1280x800@1 and 907x510@1
  buying five parts, no page errors; the board at level 1 and 7 under GPU raster.

- **2026-09-26 (b)** — Owner nitpick pass ("getting close to the finish line").

  **Metal saw sound no longer hurts** — 880 Hz triangle instead of a 1560 Hz sawtooth,
  lower and wider noise band. **The saw is silent behind a gimmick briefing card** until
  it is dismissed. See §2 "Materials and environments".

  **15 → 48 boards**: 24 new woods and 9 new metals, two new workshops (Boathouse,
  Blacksmith's Forge), a new board picker, and on-demand texture loading so boot fetches
  3-5 board textures instead of the whole roster. See §2 "Materials and environments".

  **The dust hose is a lit, corrugated hose** with a spigot and clamp, not a flat band.
  See §6 "The saw machine".

  **The Build screen's four rooms are four different rooms**: Woodshop, Kitchen, Living
  Room, Music Room, with their own wall and floor finishes. See §6 "The Build screen is
  2D". UI copy says "room" (NEXT ROOM, Every room built!).

  Verified: every texture tiles (row-wrap check); 13 new-material levels played headless
  under GPU raster with zero errors and the guide line legible on each; boot fetched 5
  board textures, all 48 loaded afterwards; `harness_build2d.html` every room
  empty/half/complete; Build screen at 430x900@2, 1280x800@1, 907x510@1 buying five parts.
  Not verifiable headless: how the new metal sound actually sounds — that is the owner's
  ear, not a measurement.

- **2026-09-28** — **Offline play-test build.** Owner wanted a copy on a flash drive for
  their siblings to play. New `tools/build_standalone.py` packs the whole game into one
  `dist/CutItStraight.html` (5.7 MB; zip 4.1 MB) that runs by double-click from
  `file://`, offline, no ads. See §7 "Offline play-test build". Nothing in `src/` changed.

  Session-start check first: the 2026-09-26 (b) pass had finished and been written up;
  nothing was mid-flight. Still open from earlier notes, untouched this session: the
  theme/thumbnail decision, the metal/ice fps gap, late-line flat-topping (09-17 audit
  #8), and the dev-only pause-menu row clipping at 907x510.

  Verified from `file://` in headless Chrome at 1280x800@1 and 430x900@2: boots, level 1
  played to FLAWLESS, Build screen renders with sprites and ghost silhouettes (canvas not
  tainted), save survives a reload, zero page errors / failed requests. The untouched
  shipped file boots clean at both sizes too.

- **2026-09-28 (b)** — Owner wanted the real folder + a server launcher, not only a
  single file. The tester zip now holds the game folder, `Start Game.bat` → `server.ps1`
  (no-install PowerShell server on localhost:8936, opens the browser), a Mac
  `.command`, and the single-file build as a backup. See §7. `isDev()` now returns false
  when `window.__testerBuild` is set (only the tester package sets it), so testers on
  localhost don't get the dev reset button.

  Verified on this Windows PC: the extracted zip's launcher served every file type
  correctly (html/js as text/javascript/png/jpg, 404 for missing and `../` paths), and
  headless Edge loaded the game from localhost to the home menu with no dev row.

- **2026-09-28 (c)** — Owner batch, six items, all done in the dev copy and the tester
  zip rebuilt.
  1. **SFX + MUSIC sliders** replace SOUND ON/OFF in the home and pause menus. See §6.
  2. **Real background music** — there was none before (the owner was most likely
     hearing the saw drone; say so if a sound "can't be found"). New `src/music.js`:
     seven different-sounding sections, ~4.9 min per cycle, new melodies every pass. §6.
  3. **Every action has a sound** — button click, navigation swish, locked/denied,
     every landing coin/star/key, results roll, purchase ka-ching. §6.
  4. **New players start with the opposite steering direction**; old saves keep theirs
     (save v10 migration). §2 Controls.
  5. **Board variety up front** — levels 1-12 now 12 different boards, colourful and
     patterned ones first. §2 Materials.
  6. **Finished rooms can be revisited**: ◀ ▶ beside the room name on the Build screen
     flips through every finished room (drawn complete, "✓ BUILT · ROOM n OF 4") and
     the current one; BACK TO <room> returns. `build.js` `browseRoom`/`viewCurrentRoom`,
     `B.view`.

  Verified on the dev server at 1280x800, 907x510 and 430x900@2: sliders dragged with
  real pointer events change the measured output level (music 0 → silent) and persist
  over reload; a real 120px right-drag moves the board the opposite way to before, and
  the inverted setting reverses it; level 1 completes; room browser round-trips; pause
  and home menus fit at 907x510; zero errors. Tester single-file build re-tested from
  file:// at two sizes. Not verifiable headless: whether the music sounds GOOD — that is
  the owner's ear.

- **2026-09-28 (d)** — Compatibility verification pass (phones, tablets, Edge, Chrome,
  CrazyGames site embed, CrazyGames app safe areas). See §4 "Browser / device
  compatibility". Fixes found by it:
  1. **iPhone went silent after any interruption** (call, lock button, app switch):
     iOS puts the AudioContext in `'interrupted'`, and `resumeAudio()` only handled
     `'suspended'`. Now resumes any non-running, non-closed state.
  2. **Ctrl/Cmd+W not blocked in fullscreen** (§4 requirement) — now is.
  3. **Three `ctx.filter` blur shadows** on the saw (Safari < 18 ignores canvas
     filters → hard black slabs on older iPhones) → `softShadow()` using shadowBlur,
     baked once into the cached saw sprite. Visually identical in Chromium and WebKit.
  4. **iOS pinch could zoom the page** (Safari ignores `user-scalable=no`) → `input.js`
     cancels `gesturestart`/`gesturechange`.
  5. **Lifting the first of two thumbs stopped steering** while the second was still
     dragging → drag now ends only for the steering pointer.
  6. **Workshop/Upgrades lists stopped with BACK under the iPhone home bar** in the
     fullscreen app → scroll extent includes the bottom safe-area inset.
  New test hook `__lvScroll()`. Tester zip rebuilt and re-tested from file://.

- **2026-09-28 (e)** — **UI restyle: workshop materials.** Owner's siblings said the UI
  "looks very AI". Every screen rebuilt from plywood blocks, stained boards, pegboard,
  masking tape, a clipboard work order, tape-measure progress and kraft tags, with
  bundled stencil/marker/condensed fonts and a warm palette. See §6 "The UI is built from
  workshop materials". New `src/ui.js`, `tools/gen_ui.py`, `assets/ui/{ply,kraft,card,
  tape,pegboard}.jpg` + `grunge.png`, `assets/fonts/` (+licences). `render.js` exports
  `textureImage()`; `levelPreview()` carries `tex`. Tester builds embed the fonts
  (build_standalone.py) and the PowerShell server maps `.woff2`.

  Verified: every screen screenshotted at 430x900@2, 1280x800 and 907x510 (home, play,
  results, fail, briefing, pause, level select, workshop, upgrades, build, endless,
  chest); functional regressions unchanged — desktop puppeteer suite clean, Android
  touch 16/16, iPhone WebKit 15/15, single-file build from file:// with embedded fonts
  rendering. Frame rate measured against the pre-restyle build on the same machine.

- **2026-09-28 (f)** — Real Android emulator pass (owner asked for a phone emulator).
  Android Studio + AVD `Pixel_7` (Chrome 124) with OS-level touch: every control passes
  (see §4 "Browser / device compatibility"). Fixed the bug it found — `multiply` stains
  dropped by Android's GPU canvas — by switching `ui.js` stains to source-over; and gave
  the UI caches a pixel budget. Workshop frame rate went UP with the change (37 vs 28 fps
  at 1280x800@2, now above the pre-restyle 34). Desktop suite, Android touch 16/16 and
  the file:// build re-run clean; tester zip rebuilt.

- **2026-09-28 (g)** — **Level select shows the purple star.** A FLAWLESS cut was never
  saved — `meta.stars` holds the best star count (max 3) — so level select could only
  ever show 3. New `meta.flawless` (level → true, save **v11**), set in `finishLevel`
  from `isFlawless(accuracy)` and never cleared by a later, worse cut. Level-select cells
  draw 3 gold + 1 purple star for those levels. Pre-v11 saves start with no flawless
  records (they were never stored); a level shows purple once it is cut flawless again.
  Verified: lv1 cut at 100% shows the purple star after a reload, lv2 at 65% does not.

- **2026-09-28 (h)** — **Endless deals boards from a shuffled deck.** Owner asked whether
  Endless goes randomly through every board. It did not: it walked the lists in a fixed
  order and ignored the run seed, so every run opened Pine, Padauk, Walnut, Steel… and
  all 48 only appeared after 65 boards — a length almost no run reaches, since one
  ruined board ends it. New `endlessMaterial(board, runSeed)` in levels.js: woods and
  specials are each shuffled from the run's seed and dealt with no repeats until the
  whole list has come up, then reshuffled (never the same board twice across the
  seam). Specials still land on every 4th board. Simulated 2000 runs: all 33 woods
  appear as openers, 0 back-to-back repeats, 0 repeated woods before all 33 dealt,
  second-board choice uniform over 5000 runs. Played two runs in-browser, no errors.
  `__plankInfo()` now reports `mat`.

- **2026-09-28 (i)** — **Submission package.** Owner decided the game is ready to submit.
  New covers (`tools/covers.html`: the game's own boards, cut line and stencilled plank
  sign — the old ones had the gradient-outlined title testers called "AI"); new 18.8 s
  preview video re-captured with the current UI (level 39: GO!, a PERFECT JUMP, a
  3-star PERFECT CUT, a Build piece, level select); `submission/listing.md` rewritten
  against the current build (48 boards, gimmicks + jumps, 4 rooms, purple star,
  shuffled Endless; `3d` tag dropped); new `tools/build_upload.py` →
  `dist/CutItStraight-crazygames.zip` (148 files, 4.7 MB, index.html at the zip root,
  limits checked, absolute paths refused). The in-play gimmick label moved to masking
  tape (the last old-style dark card). Upload package booted from a non-localhost
  address: no dev UI, no test hooks, SDK loaded, zero errors / failed requests.

- **2026-09-28 (j)** — CrazyGames QA-preview feedback. (1) **Volume sliders added to the
  Workshop's Settings card**, under Invert steering (they were only on the home menu and
  the pause menu, and the owner looked for them in Settings). Its invert sub-label now
  states the current behaviour (it still described the pre-v10 default). (2) **"No
  sound" in the QA preview** investigated, not reproduced: under Chrome's strictest
  autoplay policy, inside a cross-origin iframe with NO `allow="autoplay"`, one click
  starts the AudioContext and the music. The SDK takes `muteAudio` from the host page
  (and the QA tool may drive it to test "supports muting through SDK"); when it is set
  the game is silent BY DESIGN and the HUD speaker shows crossed out. Checklist for the
  owner given in chat. Note: `menu.js` exports `volumeSliders`, used by workshop.js.

- **2026-09-28 (k)** — **Ads switched off for Basic Launch.** The QA checker listed
  "Clear All Banners" and warned the submission would be rejected for containing ads.
  New `ADS_ALLOWED = false` in sdk.js gates every ad/banner call (see §4 Launch path).
  Also: the upgrades screen's "finish with an ad" offer now checks `adsUsable()` (it
  did not, and would have shown a dead button); `runAd` restores the player's own mute
  as well as the platform's. Verified with a spy wrapped round the SDK's ad and banner
  modules across every former ad touchpoint (results, forced-ad transition with the
  grace expired, fail panel, daily chest, upgrades, workshop, pause): **zero calls**; a
  control call proved the spy records them. Also verified Firefox 155 (desktop + touch)
  plays, steers and has audio with zero errors.
