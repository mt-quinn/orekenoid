# The score

Two files go here. They are two mixes of the **same piece at the same length**: one for the mine, one for a
live claim.

```
public/music/exploration.ogg   (or .mp3 / .m4a / .wav)
public/music/framed.ogg        (or .mp3 / .m4a / .wav)
```

`src/music.ts` tries `.ogg`, then `.mp3`, then `.m4a`, then `.wav`, and takes the first that both fetches and
decodes — so drop them in whichever format you have. Ogg is smallest at a given quality and Safari refuses it,
which is what the fallbacks are for; shipping `.ogg` **and** `.mp3` covers everything.

## What the code assumes

**Identical length.** Both tracks play continuously from the same instant and never stop; switching energy
only moves their gains. That is what makes a transition sound like one piece leaning into a claim rather than
like one song stopping and another starting, and it works because the two playheads are never allowed to
differ. If the durations disagree by more than 50ms the console says so and both loop on the shorter one to
stay locked.

**Seamless loop.** They loop for the whole session, so the end has to meet the beginning. Trim to an exact
bar and avoid an encoder that pads with silence — LAME adds a gap to MP3 that will be audible every time
round. Ogg or a gapless-tagged MP3 is safer for the looping copy.

**Same arrangement.** The crossfade is linear rather than equal-power, because the two mixes are correlated
and their amplitudes add. That holds as long as they really are the same take: if the "framed" mix is a
different performance rather than a different balance of the same one, the middle of a transition will sound
doubled instead of louder.

**Mixed to sit under the game.** Both are played at `MUSIC.volume` (0.34) and the sound effects carry the
game's actual information — a rally, a refusal, a brick's material. Master them so nothing has to fight.

There is no music until these files exist. That is a normal state: the game runs silent and says nothing about
it.
