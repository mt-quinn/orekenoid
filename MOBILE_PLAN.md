# Orekenoid on phones

> **Status: built.** Every phase below is implemented, with ten phone specs and the desktop suite
> green. The "Built" section records what the plan got wrong and what the work turned up; the phase
> descriptions are kept as the record of why each piece is shaped the way it is.

## Where it stood

The game was unplayable on a phone for two independent reasons, either of which alone would have
been fatal.

**The viewport is a fixed 16:9 letterbox.** `VIEW_WIDTH`/`VIEW_HEIGHT` are `1280`/`720`, the Pixi
stage is created at that size, and `.viewport` in CSS is locked to the same ratio:

```css
width:  min(calc(100vw - …), calc((100dvh - …) * 16 / 9));
height: min(calc(100dvh - …), calc((100vw - …) *  9 / 16));
```

On a 390×844 phone held in portrait this resolves to roughly **378×213** — the game occupies about
a ninth of the screen, centred in a field of black.

**There is no touch input at all.** Every gameplay control is a `keydown`/`keyup` listener on
`window`. Menus respond to `click`, so a phone can reach the deployment screen and press CHOOSE,
and then the player is parked in the rock with no way to move.

Two things are working in our favour. Only 22 lines reference the view constants, and all but one
of the interesting ones are in `camera.ts` (a single centring line) and `gantry.ts` (absolute
layout for the Refit Bay). And the DOM HUD is written almost entirely in container-query units —
85 uses of `cqw` — so it rescales itself the moment the container changes shape.

One latent bug will surface immediately once the stage stops being 1280×720: there is no camera
zoom. A board is drawn at `CELL = 42` and the camera only pans and rotates, so a 19-deep frame is
798px tall on a 720px stage and already overflows today. Any narrower stage makes this worse, and
the fix — fit the board to the view — is the same fix in both cases.

## Decisions

Settled, so the implementation does not have to relitigate them:

- **Portrait only.** Portrait is the designed and only supported phone experience. Landscape shows
  a designed rotate-back gate, not a browser default, and never loses state.
- **Paddle: direct drag with a vertical offset.** Touch anywhere on the board, the paddle tracks
  the finger's X, offset upward so the thumb never covers the paddle or the contact point.
- **Survey: floating left stick to fly, right-half drag to turn.** The two axes stay independent,
  because aiming a claim precisely without drifting into the rock is the whole survey skill.
- **Platform: installable PWA with offline play, wake lock, and audio unlock.** No fullscreen
  request and no haptics.
- **Audio loss is a pause.** When the audio context is lost or suspended, the game pauses and shows
  an obtrusive one-tap dismissal — not the full pause menu, just a tap-to-resume plate. This falls
  out of a rule worth having anyway: losing window context always pauses.

## Built

All eight phases are in, with 10 phone specs and the desktop suite green. What the plan did not
anticipate, and what the work turned up:

- **The camera zoom was never applied.** `applyTo` set pivot, position and rotation and never
  scale, so a committed board ran off both edges of the phone. Found by measuring brick positions on
  the stage after container bounds came back bit-for-bit identical at two different zooms -- the
  bounds are reported in the board's own units and do not carry the camera scale, which is a trap
  worth remembering.
- **Rotation was all-or-nothing against hull collision**, making the fastest gestures the ones most
  likely to do nothing: a held key produces hundredths of a radian per frame, a thumb flick most of
  a radian at once. It steps now, the way movement already slid along walls.
- **`setPointerCapture` throws** for a pointer the browser does not consider active, aborting the
  handler before the gesture registered.
- **The gesture demonstration ran for one frame.** `renderTutorial` is called every frame, so
  marking a gesture shown the first time it was asked for suppressed it immediately. The bookkeeping
  is time-based now.
- **`[hidden]` loses to `display: grid`.** The FAST pad stayed on screen out in the mine, where it
  does nothing, because the UA `display: none` was out-specified.
- **The pre-serve aim was derived from an axis that carries no signal**, and the assertion covering
  it checked that the aim *changed* rather than that it went the right way -- so it passed on easing
  noise while the feature did nothing. Aiming is its own tap now. See phase C.
- **The deployment screen was a hard blocker** nobody had looked at: two of three chassis off the
  right edge, DEPLOY unreachable. It gated every phone test that starts a game.

## Shape of the work

Eight phases. A–B are the enabling structural work and everything else depends on them; C–D are
where the game becomes playable at all; E–H are what make it good rather than merely possible.

### A. Make the stage responsive

Replace the `VIEW_WIDTH`/`VIEW_HEIGHT` constants with a live `view` object carrying the current
stage size, driven by the container's real dimensions and a capped `devicePixelRatio`. The Pixi
renderer resizes with it. `camera.applyTo` reads the current size rather than a constant. The Refit
Bay's absolute layout is recomputed on resize instead of at module load.

This is the load-bearing change. Nothing else is possible while the stage is a fixed rectangle, and
doing it first means every later phase is written against the responsive world rather than being
retrofitted into it.

### B. Layout modes

A single `layout` signal — `desktop`, `phone`, `tablet` — derived from viewport size, pointer
coarseness and touch capability, exposed to both CSS (a data attribute on the shell) and
TypeScript. Everything downstream branches on this one value rather than each sprouting its own
media query, so there is one place to reason about what "on a phone" means.

### C. Touch input

A new input layer in front of the existing key set, so the game's own code keeps asking "is the
player moving left" rather than learning about pointers. Gameplay reads intent from an input
source; the keyboard becomes one implementation of that source rather than the only one.

| context | desktop | phone |
|---|---|---|
| survey movement | WASD / arrows | floating stick, left half |
| survey frame rotation | Q / E | drag on the right half, relative |
| commit a claim | F | primary action button in the thumb zone |
| paddle | A / D | direct drag, X only, offset upward |
| serve aim | Q / E | vertical component of the same pre-serve drag |
| serve | SPACE | tap — touch and release without movement |
| speed up | hold W / S | hold the FAST pad; ramps ×2 → ×4 → ×8 |
| atlas / forge / pause | M / C / ESC | control cluster, 44px targets |

Positioning, aiming and serving are three sequential decisions, so they are three separate
controls: the drag moves the paddle, a tap on the board aims the serve at the tapped point, and the
SERVE button launches.

The plan originally called for two axes on one thumb, with the vertical component carrying the
angle. That does not work — the paddle chases the finger so the horizontal gap closes, and the
paddle lift fixes the vertical gap at a constant — and it was built anyway.

Worse was the first attempt to repair it, which read the angle from which side of the board the
thumb was on. That gave a phone player strictly less control than Q and E give: with the paddle
parked right, a hard left serve became impossible. **Any fix that leaves one platform with less
control than another is not a fix.** The aim is now the direction from the paddle to the tapped
point, which gives touch the full range the keyboard has, and the spec asserts exactly that shot.

### D. Mobile HUD and menus

Reflow the HUD for a tall viewport, respect safe-area insets, and raise every interactive target to
44px minimum. Details in the affordances section below.

There is a specific trap in the deployment screen: chassis previews are driven by `pointerenter`
and `pointerleave`. Hover does not exist on touch, and iOS synthesises a first-tap hover that makes
this actively confusing. Those need a tap-driven equivalent.

### E. Fit the board to the view

Give the camera a zoom, chosen so the framed board plus margin always fits the current stage. This
fixes the existing deep-frame overflow and is what lets a 19-wide board work on a portrait phone.
The claim transition already animates focus and rotation; zoom joins them as a third channel, so
committing a claim frames the board rather than merely flying to it.

### F. Performance

Cap render resolution on high-DPI phones, budget particles and settled debris by layout mode, and
audit the per-frame `Graphics` rebuilds — the coach, the trajectory and the liability gauge all
clear and redraw every frame, which is cheap on a desktop GPU and not necessarily cheap on a
mid-range phone. Establish a frame-time budget and measure against a throttled profile rather than
guessing.

### G. Platform integration

`viewport-fit=cover` and safe-area padding; `touch-action: none` on the play surface plus
suppression of double-tap zoom, pull-to-refresh and the iOS selection callout; audio unlock on
first gesture with the tap-to-resume plate described above; pause on `visibilitychange` and `blur`;
a wake lock so the screen does not sleep mid-claim; and a web app manifest with icons and a service
worker so the game installs to the home screen and plays offline.

### H. Testing

Playwright device projects for a phone and a tablet, with `hasTouch` so touch events are real
rather than emulated mouse. The existing suite drives everything by keyboard, so these are new
specs: fly the drone, commit a claim, serve, and move the paddle entirely by touch; plus the
rotate gate, the resume plate, and offline load.

## UI and UX affordances

The phases above make the game *possible* on a phone. This section is what makes it *good*, and it
is the part most likely to be skipped, so it is written out rather than assumed.

### Reach and the thumb zone

A portrait phone has a comfortable arc at the bottom of the screen and a hostile corner at the top
opposite the holding hand. Everything the player does under pressure lives in the bottom third:
the stick, the FAST pad, COMMIT, SERVE. Everything they do deliberately and rarely — atlas, forge,
pause — can live at the top, where an accidental brush is least likely.

Nothing that must be *read* during play goes in the bottom third, because that is where the thumbs
are. Integrity, cargo and the claim readout move to the top on phones.

### Occlusion

The paddle offset exists because a thumb on the paddle hides the one thing the player most needs to
watch: the contact point. The same logic applies to the board's lower rows, which is the second
reason the board is fitted with margin rather than filling the stage — the bottom of the play area
should sit above the thumb's resting arc.

Drops and ore fly toward the paddle, so their arrival is also in the occluded band. Their telegraph
needs to read from above.

### Touch targets and feedback

44px minimum on every target, generous invisible padding around anything smaller than it looks, and
a pressed state that appears within a frame of contact. A touch that produces no acknowledgement
reads as a dropped input, and the player's next move is to press harder and then twice.

The refusal feedback built for the opening sequence already covers the "that does nothing yet"
case; touch needs the complementary "that registered" case on everything.

### Controls that show themselves

The floating stick appears where the thumb lands rather than sitting at a fixed spot, so the player
never has to look down to find it. It fades to a low resting opacity when idle so it does not
compete with the world, and the knob shows its deflection so thrust is legible.

The right-half turn zone is invisible until touched, then shows a light arc indicating rotation
direction and rate.

### Teaching gestures rather than keys

The opening sequence currently says `WASD / ARROWS`. On a phone that is worse than nothing. The
coach prompt takes a gesture instead: a short glyph and, for the first occurrence of each gesture,
an animated demonstration — a ghost thumb performing the drag — anchored to the same subject the
prompt already points at.

This is a natural fit for the tag built last session: it already anchors to the drone, the frame,
the paddle and the ball, which is exactly where a gesture demonstration wants to be.

### The rotate gate

A designed screen in the game's own visual language — the aperture marks, the brass rule, the
machine type — saying the survey rig runs vertical. Not a browser default and not a wall of text.
Rotating back returns to precisely the state that was left, with the game paused across the whole
transition.

### The resume plate

One plate, one tap, in the game's voice. It appears whenever context is lost — audio suspended, tab
backgrounded, call taken — and the simulation is genuinely stopped behind it, not merely hidden.
Resuming runs the existing 3-2-1 countdown, because a live ball does not wait for a player to find
the paddle again.

### First load

A phone on cellular needs something on screen immediately. The shell paints its frame and a
loading state before the world generates, rather than showing black while the generator runs.

### Motion and comfort

Screen kick and hit-pause read differently on a device held 30cm from the face than on a monitor.
Both get a layout-scaled multiplier, and `prefers-reduced-motion` is honoured — the board reactions
carry the feedback perfectly well without camera movement, which is the argument the feedback pass
was built on in the first place.

## Assumptions

- **One responsive build**, not a separate mobile site. Same URL, same save format, same code
  paths; the layout adapts.
- **The desktop experience does not regress.** Keyboard stays primary there and the 16:9 framing
  stays available; mobile is additive.
- Tablets get the desktop layout scaled, plus touch controls. Falling back to desktop framing on a
  tablet is acceptable; showing a 378×213 strip is not.
