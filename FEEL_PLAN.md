# Feel, everywhere else

The breakout board already had the screenshake talk applied to it. Nothing else in the game did, and
two gaps are large enough to be felt as bugs rather than as missing polish:

- **Catching ore produces one sound and no picture.** The drop vanishes on the frame it is caught.
  The single most rewarding moment in the loop is currently invisible.
- **Being unable to move produces nothing at all.** `hullFits` returns false and the drone silently
  fails to go anywhere. A player pressing into rock cannot tell the difference between "the game is
  refusing me" and "the game dropped my input", which is the worst ambiguity a control scheme can
  have.

## The governing rule

From the talk, and from the correction this project already took once: **the things in the world
react, and the camera is the last and smallest layer.** Shake on every event stops meaning anything
by the tenth event. The talk's own framing is that the effects which sell an impact are the enemies
flashing, the knockback, the props responding — the camera is a garnish.

Two rules follow, and both are enforced in code rather than left to taste:

1. **Repeats saturate, they do not stack.** Ten events in one frame must not produce ten times the
   flash. Every accumulator takes a `max`, not a `+=`.
2. **Sustained states are textures, not machine guns.** Holding into a wall must not fire a fresh
   impact every frame. First contact is an event; continuing to push is a low, gated hum.

Everything scales through `motionScale()` and `effectBudget()`, so a phone and a
`prefers-reduced-motion` player get the same information with less movement.

## What gets feedback

### A. A shared vocabulary — `view/feel.ts`

Three primitives, so each surface does not invent its own.

- `Shudder` — a 2D spring-damper offset plus roll, for single actors that should be knocked. The
  board's bricks already have their own; this is for the drone, the paddle, a marker.
- `Pulse` — a 0..1 decaying value whose `hit()` saturates. Drives flashes and glows.
- `Gate` — permits an event at most every N seconds. The difference between a grinding wall being a
  texture and being a jackhammer.

### B. Flying the drone

- **Lean into travel.** The hull rolls a few degrees toward its direction of motion and settles back.
  Reads as mass; costs nothing.
- **Thruster wash.** Dust shed opposite the direction of travel, rate scaled by speed, so movement
  leaves a wake instead of sliding a sprite.
- **Camera lead.** The focus sits slightly ahead of the velocity, a handful of pixels at full speed.
  Makes travel feel intentional rather than dragged.

### C. Being refused — the headline

Split into two distinct events, because they mean different things:

- **First contact.** The hull shudders along the blocked normal, sparks and dust at the point of
  contact, a short scrape, and a single small camera nudge *against* the direction pushed. This is
  the one new camera movement in the whole pass, and it is gated to first contact only.
- **Grinding.** While still pushing into rock the hull holds pressed a few pixels into the obstruction
  and sheds dust at a gated rate with a quiet repeating scrape. No camera at all.

Refused *rotation* gets the same treatment, which matters because the rotation refusal is the more
confusing of the two — nothing on screen currently explains why the frame will not turn.

### D. Catching ore

- The drop **streaks** into the hull rather than blinking out: a short trail on the last leg.
- A **ring in the ore's own colour** at the catch point, and shards of that colour.
- The **paddle pops** — a brief scale punch, the same language a struck brick uses.
- The **cargo readout punches** in the HUD, so the number and the catch are one event.
- **Combo escalates the picture, not just the pitch**: ring size and brightness rise with the run and
  cap, so a good streak looks like one.
- A **missed** drop lands and settles rather than vanishing. Permanence, in the talk's sense: the
  claim should show what the player failed to catch.

### E. Banking

Coming home is the payoff for a whole expedition and currently plays one tone. It gets a deposit
thunk, a ring at the rack, the cargo counter rolling down rather than snapping, and a repair shimmer
across the hull.

### F. Damage and integrity

- Hull shudder and flash when load gets through the plating.
- Low integrity reads as a slow, quiet pulse on the health bar itself rather than a screen-edge
  vignette. A vignette fights the board for attention exactly when the player can least afford it.

### G. Sound variation

Every tone gets a small per-play pitch jitter. Identical repeated samples phase-lock into a buzz;
a few percent of variation is the difference between a rally sounding like rock and sounding like a
synthesiser. Deliberately pitched sounds — the combo ladder — keep their intent and jitter around it.

## What deliberately does not get feedback

- No camera shake on ordinary brick contact. That was already tried and removed.
- No screen flash on damage. The hull is the thing being damaged; the screen is not.
- No sound on every drop spawn. A board shedding twenty pieces of ore would be a rattle of nothing.
