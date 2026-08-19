# The score

Two files go here. They are two mixes of the **same piece at the same length**: one for the mine, one for a
live claim.

```
public/music/bgm-explore.opus   (or .ogg / .mp3 / .m4a / .wav)
public/music/bgm-framed.opus
```

`src/music.ts` tries `.opus`, `.m4a`, `.ogg`, `.mp3`, `.wav` in turn and takes the first that both fetches and
decodes. Opus in an Ogg container is the master; **Safari does not support Ogg**, so an AAC copy sits beside
every file and is what plays on an iPhone. `m4a` is second in that list rather than last because it is the
fallback that actually ships: Safari fetches the Opus, fails to decode it, and should then reach the working
file in one more request rather than three.

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

**No Web Audio graph.** The score is two plain `<audio>` elements playing to the output, with the crossfade, the
duck and the player's level all multiplied into `element.volume`. The textbook shape -- `createMediaElementSource`
into gain nodes -- works in Chromium and played to nowhere on WebKit: the elements reported themselves unpaused,
the format was right, the gains were right, and no sound came out, while the sound effects were audible in the
same context through the same destination. If anything here ever needs a filter or an analyser, that is the
trade-off being reopened, and it is worth remembering what it cost the first time.

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

# The impacts

Three recordings also live here, and none of them is music — this is just where they were put. They are loaded
by `src/sfx.ts`, whose `SAMPLES` table holds the one line to change if they move.

```
public/music/ballhitwallpaddle.opus   ball against the paddle or an arena rail
public/music/ballhitbrick.opus        ball against a brick, breaking it or not
public/music/brickbreak.opus          a brick giving way, layered over the hit above
```

Decoded into memory rather than streamed, which is the opposite of the decision above and for the opposite
reason: two are 73ms and one is 1.19s, so all three are under half a megabyte of PCM, and they need a start with
no scheduling latency and several copies overlapping. A media element gives neither.

**Not level-matched to each other.** Measured peaks are -5.0dB, -11.8dB and -4.1dB, so `ballhitbrick` sits 6.7dB
under `ballhitwallpaddle` in the files. `SAMPLES` states each measured peak alongside the peak the sound should
play at and takes the ratio, so the balance between the game's three most frequent sounds is a decision in code
rather than an accident of mastering. `target` is the only number worth editing.

**Set the targets against the tone bank in `src/audio.ts`, never against the music.** The first version reasoned
from the score's 0.34 gain and landed on peaks of 0.18 to 0.36. The synthesised effects these stand in for peak
between 0.012 and 0.075, so the recordings played 15 to 20dB over everything else and buried the game. They now
sit at 0.035, 0.035 and 0.075, a little above each stand-in's own peak because a recorded transient reads quieter
than a decaying oscillator of the same height, and `tests/sfx.test.ts` holds every target against its fallback's
volume so the two cannot drift apart again.

Re-measure `peak` if a file is replaced:

```
ffmpeg -i public/music/brickbreak.opus -af astats=measure_perchannel=none -f null -
```

**One recording for both the paddle and the rails**, per the design. `RAIL_VOICE` steps the rail back 4dB and up
a tone, because a rally is meant to be readable with the screen ignored and paddle-rail-rail-paddle is the shape
being read. Set both to 1 to hear them identical.

# Encode the fallbacks in stereo. This one cost hours.

Safari &mdash; and therefore every WebKit browser, including DuckDuckGo on a Mac &mdash; refused the AAC copies
outright: `readyState` 0, `MediaError.code` 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`), `play()` rejecting with
`NotSupportedError`, before a single byte was loaded. The container was fine (`ftyp M4A`, `moov` ahead of
`mdat`), the codec was fine (AAC-LC 48kHz), the MIME type was right, byte ranges worked, and
`decodeAudioData` accepted output from the same encoder without complaint.

The difference was that the music files were **mono** and the sound effect that decoded fine was **stereo**.
`afinfo` reports "no channel layout" on both, and a mono AAC track with no channel configuration is something
WebKit's media element pipeline will not touch, even though its decoder will. `-ac 2` on the encode is the whole
fix.

So: **always pass `-ac 2`**, even when the master is mono. It is one flag and it is the difference between a
score and silence on every Apple browser.

`src/music.ts` no longer trusts `canPlayType` either. It collects every format the browser claims, starts on the
first, and listens for the element's `error` &mdash; which is the only honest signal &mdash; falling through to
the next on failure. `canPlayType` answered "probably" for the file above.

# Fallbacks, and the headers that make them work

Every file here has an AAC twin, generated from the Opus master and committed alongside it. Regenerate them
whenever a master changes:

```
for f in bgm-explore bgm-framed; do
  ffmpeg -y -i "$f.opus" -ac 2 -c:a aac        -b:a 160k -movflags +faststart "$f.m4a"
  ffmpeg -y -i "$f.opus" -ac 2 -c:a libmp3lame -b:a 160k                      "$f.mp3"
done
for f in ballhitwallpaddle ballhitbrick brickbreak; do
  ffmpeg -y -i "$f.opus" -ac 2 -c:a aac -b:a 160k -movflags +faststart "$f.m4a"
done
```

Check the result before believing it:

```
afinfo bgm-explore.m4a    # must say "2 ch"
```

**Encode both mixes in the same pass.** The identical-length assumption above applies to the fallbacks too, and
it is the one that breaks silently. AAC pads, so the pair came out at 508.895s rather than the master's
508.901542s -- what matters is that they came out equal to *each other*, which they do because they were
encoded with the same encoder and the same settings. Encode one and not the other, or at different bitrates,
and the sync spends the session snapping.

**AAC is not gapless.** The encoder's delay and padding mean the looping copy may click on the wrap in Safari
where the Opus does not. Nothing in the code can fix that; it needs either a gapless-tagged file or a loop
short enough to decode into a buffer.

## Vercel serves these as `application/octet-stream` unless told otherwise

Neither `.opus` nor `.m4a` is in Vercel's extension table, so both arrive as a generic byte stream.
`decodeAudioData` does not care -- it is handed an `ArrayBuffer` and the type is never consulted, which is why
the sound effects worked on the live site regardless. A media element does care, and the score is streamed
through one. `vercel.json` sets `audio/ogg` and `audio/mp4` explicitly; a new audio extension needs a rule
there as well as a file here.
