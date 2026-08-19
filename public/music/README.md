# The score

Two files go here. They are two mixes of the **same piece at the same length**: one for the mine, one for a
live claim.

```
public/music/bgm-explore.opus   (or .ogg / .mp3 / .m4a / .wav)
public/music/bgm-framed.opus
```

`src/music.ts` tries `.opus`, `.ogg`, `.mp3`, `.m4a`, `.wav` in turn and takes the first that loads. Opus in an
Ogg container is what is here now and it plays in Chromium and Firefox; **Safari does not support Ogg**, so an
`.mp3` or `.m4a` alongside is what would make this work on an iPhone.

## What the code assumes

**Identical length.** Both tracks play continuously from the same instant and never stop; switching energy only
moves their gains. That is what makes a transition sound like one piece leaning into a claim rather than one
song stopping and another starting. The two files here agree exactly, at 508.901542s.

**Streamed, not decoded.** They are played through media elements rather than decoded into `AudioBuffer`s.
Measured on these files: eight and a half minutes at 48kHz is 98MB of float32 PCM per mix, and the heap sat at
342MB after decoding both, plus about a second of decoding each at deployment. Fine on a desktop, and a good way
to have a phone kill the tab. The cost is that two media elements keep their own clocks and can drift, so the
score corrects the framed mix toward the exploration one a couple of times a second — measured drift on these
files is effectively zero, and the correction is a safety net for a backgrounded tab rather than a routine
event.

**A shorter loop would be better.** At two minutes or less, decoding into memory becomes cheap again, and buffer
sources cannot drift at all. If the piece is ever cut down, `src/music.ts` is the only file that would change.

**Seamless loop.** They loop for the whole session, so the end has to meet the beginning. Trim to an exact
bar and avoid an encoder that pads with silence — LAME adds a gap to MP3 that will be audible every time
round. Ogg or a gapless-tagged MP3 is safer for the looping copy.

**Same arrangement.** The crossfade is linear rather than equal-power, because the two mixes are correlated
and their amplitudes add. That holds as long as they really are the same take: if the "framed" mix is a
different performance rather than a different balance of the same one, the middle of a transition will sound
doubled instead of louder.

**Mixed to sit under the game.** Both are played at `MUSIC.volume` (0.34) and the sound effects carry the game's
actual information — a rally, a refusal, a brick's material. Master them so nothing has to fight.

**Measured on the current pair.** `bgm-framed` is about 2dB louder than `bgm-explore` (RMS 0.2019 against
0.1606) and peaks at 1.066 in the decode, i.e. over full scale. At the score's 0.34 playback gain that lands
around 0.36, so nothing clips — but the transition into a claim is a step in level as well as in energy. If that
is deliberate, nothing needs doing. If the two were meant to be level-matched, the framed mix wants about 2dB
off it.

There is no music until these files exist. That is a normal state: the game runs silent and says nothing about
it.
