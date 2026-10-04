# What undertone is (context for the reviewer)

undertone turns live Claude Code coding sessions into background music, generated in real time in
the browser (Tone.js; four engines: Synth (all synthesized), Sampled (real instruments via smplr:
GM soundfonts, drum machines, electric pianos), Strudel, SuperCollider). The person codes with it on
for hours, with several sessions at once. It is an information system first: by ear they should know
what's happening and what needs them, without looking.

How it works today:
- A conductor ticks every 16th note. Each session is a "lane" with its own instrument voice; every
  tool call the session makes becomes a note in that voice (reads low, edits on chord tones,
  commands high). Energy (how busy the sessions are) opens filters and brings drums in.
- Signals that must stay recognizable in every style: each lane's call (a 3-note motif) when its turn
  ends or it needs the person, rising when it needs them and settling when it's done; a sour note held
  while a check fails (a different interval per kind of failure); "asks" (a soft rising bell figure)
  for questions waiting on the person; a commit resolving the progression home with a bell.
- A mood = key, tempo, swing, chord progression, drum pattern. A mood can carry a style (its own band
  and groove): Late shift (lofi), Blue hour (jazz-hop trio), Afterhours (house). The busiest project of
  the last 3 minutes leads and sets the mood; each project has a default mood.
- Planned "DJ": tracks hold 16 bars and change on phrase boundaries, in related keys and beat-matched
  tempos; projects "take over" the track on pushes or green deploys.

Constraints any idea has to survive:
1. It plays for hours under focused work: no fatigue, no constant tones (a waiting-questions drone was
   removed because it sounded like a lawnmower), nothing that grabs attention unless it means something.
2. Every change in the music should carry information (who's busy, what needs you, what broke, what
   shipped). Variety for its own sake becomes a radio and gets tuned out.
3. Generated live from events, not pre-recorded tracks; must run in a browser tab (Tone.js, Web Audio),
   samples loaded on demand (2-4 MB per GM soundfont instrument).
4. No copying: capture technique, instrumentation, harmony and form, never melodies or themes from the
   games.

---

# Space styles: what Stellaris and Mass Effect get right, and what undertone can take

Alex, 10-4: "you know what i want is some shit stellaris and mass effect." This is the research, the
craft worth borrowing, and the ideas it leads to. Technique, instrumentation, harmony and form only:
no melodies or themes from either game.

## Mass Effect: what makes it work

Sources are listed at the end; anything marked *(inferred)* is by ear, not sourced.

- **The brief was a sound, not a genre.** Casey Hudson asked for Vangelis's *Blade Runner* crossed with
  Tangerine Dream; Jack Wall added the *Solaris* remake's orchestral ambience. Late-70s and early-80s
  analog synths plus organic sounds. [1][5][6]
- **All in the box.** Arturia's CS-80V, Minimoog V and Moog Modular V, plus Atmosphere. The orchestra
  was written to sound like synthetic strings and brass. [1][3][4]
- **One room for everything.** Synths sit in the same very wet reverb as the acoustic instruments, so
  the electronics and the orchestra read as one place. [2][12]
- **Pulses tie it together.** "Electric pulses" run through the score; the main theme opens on synth-bass
  pulses. [2][7]
- **The galaxy map is an ostinato.** "Uncharted Worlds" sits on an 8-note pattern that never drops out
  and builds by adding layers. [9][10]
- **Harmony.** "Vigil": 110 bpm, mostly sus and add chords. The main theme is in 3/4 and its opening
  notes become the series motif. ME3's dread is one "Reaper chord"; its heart is four piano chords. [8][11][18]
  *(inferred)* Chords change every 1 to 4 bars over a held bass pedal; wonder comes from sus2/add9 and a
  raised 4th; dread from upper chords shifting over a static pedal and low brass clusters.
- **Adaptive, never a light switch.** ME2 (Wwise): exploration, a tension cue between fights, and three
  combat layers chosen by how many enemies are left, joined by transitions and stingers (30 to 60 per
  level), not fades. ME3: light and medium combat stems swap seamlessly; Mansell called it DJing, "a
  holding pattern, then the big explosion". Andromeda: a CombatStress parameter sets intensity, event
  overlays play in sync, ambient overlays come in as the action fades. [14][15][16][17][21]

## Stellaris: what makes it work

- **Synths for the otherworldly, orchestra for the organic.** Andreas Waldetoft names Vangelis and Mike
  Oldfield (and Bach). Most of the work went into the synth palette, which carries both atmosphere and
  melody: "It is incredible what you can do with some sine and sawtooth waveforms". Live orchestras
  on top; organ is a recurring colour; the choir is sparing and weaves in and out. [S1][S2][S3][S5][S7][S8]
- **Nothing pulls toward a cadence.** Chord detection on the main themes gives D minor loops (Dm, C, Bb,
  F / Am): i–bVII–bVI with a minor v and no leading tone. *(inferred)* That's why hours of it never feel
  like they're waiting to end. Pedal tones under ostinati, sus and add9 pads, a chord every 1 to 2 bars,
  slower in the ambient pieces. [S10][S11]
- **Odd meters push it forward.** Odd time signatures are used on purpose to drive the music; 7/8 is
  Waldetoft's favourite. Rough tempos: 73 (Spatial Lullaby), 95 (Creation & Beyond), 130 (Faster Than
  Light). [S1][S9][S12-14]
- **Long arcs, variations not repeats.** Tracks run 5 to 8 minutes, some 11 to 12. They open quiet and
  erupt into the theme, or open narrow and widen to full stereo; the main theme comes back slowed and
  elegiac. Deliberately not static ambient: melody and a beat keep it moving. [S1][S4][S6][S7][S8][S9]
- **The music barely adapts; the ambience does.** The music is a shuffled playlist (a player since 1.5;
  people untick tracks they dislike). The adaptivity lives in a layered ambient bed that keeps moving
  without drawing attention, and in hums that change with zoom. [S1][S16][S17]
- **The one escalating loop is the part people hate.** A crisis loop gets louder as an endgame crisis
  spreads, and players find it grating. Escalating loops cause fatigue. [S21][S22]
- **One language, many palettes.** Each DLC shifts the palette inside the same musical language: darker
  and faster (Leviathans), big brass (Utopia), simple retro synths (Synthetic Dawn), ominous choir
  (Apocalypse), darksynth (Machine Age, which some players turn off), throat singing and drums (Nomads). [S5][S9][S23-27]

## What undertone can take

| Craft | Where it comes from | What it becomes in undertone |
| :- | :- | :- |
| An ostinato that never drops out, built up by adding layers | ME1 galaxy map | The style's arpeggio is the room's activity: busy sessions add notes and accents to it, quiet ones thin it back to the pedal |
| Synth-bass pulses on a pedal | ME1 main theme | The bass pulses eighths on the key's root while chords move above it |
| One wet room for synths and orchestra | ME1, ME2 | Every instrument in a style shares one long hall; calm plays wetter and wider, busy plays drier |
| Sus/add chords, no leading tone, nothing that cadences | Both | Space styles loop Aeolian i–bVII–bVI–v with sus/add9 colour, so hours of it never sound like they're about to end |
| Tension, low and full layers, switched with hysteresis, joined by transitions and stingers | ME2, ME3, Andromeda's CombatStress | Energy picks one of three tiers, held at least 8 bars, changed on phrase boundaries with a riser in and a swell out |
| "A holding pattern, then the big explosion" | Mansell, ME3 | A long turn builds (the ostinato holds, the filter climbs); the turn ending, or a commit, is the release. How long the build ran tells you how long Claude was heads-down |
| Escalating loops grate | Stellaris crisis loop | A failure never gets louder over time: the sour note holds at one level, then settles into the texture after a few minutes (the score still names it) |
| One language, many palettes | Stellaris DLC packs | Each project is a faction: same harmony and form, its own lead colour (organ, horn, choir, saw lead) |
| A series motif from the main theme's first notes | ME | undertone's own four-note motif for the system's moments (a commit landing home, the bridge coming up), voiced per style |
| Themes return slowed and elegiac | Stellaris | Late at night, or after a long day, the lead's material comes back slower and softer: time of day you can hear |
| Narrow to wide | Stellaris (Dragon Breath) | Stereo width follows how many sessions are open |

## Ideas

**Two styles.**

1. **Far shore** (after ME1, synth noir). Synth engine, no downloads. A 16-step analog arpeggio
   (saw or pulse through a resonant low-pass swept over bars, dotted-eighth delay) on the chord's
   sus/add tones; eighth-note bass pulses on a pedal; CS-80-style brass swells (detuned saws, slow
   attack, filter swell); one long hall. About 110 bpm, Aeolian with sus colour. Drums only in the full
   tier: a big gated snare on 2 and 4. Tool calls feed the arpeggio instead of playing loose notes.
2. **Deep field** (after Stellaris, orchestral synth). Sampled engine, loaded only when it plays: string
   ensemble, choir (sparing), French horn for the lead project's colour, harp, organ, timpani. A sine and
   saw synth ostinato under it. About 95 bpm, i–bVII–bVI–v over a pedal, chords every 2 bars. Opens
   narrow and quiet; erupts into the full arrangement when the room gets busy; drops to a slowed,
   elegiac version late at night. Synth falls back to saw strings and sine choir pads.

**Five system ideas, for every style.**

3. **Intensity tiers.** Calm, working and full, from energy with hysteresis; a tier holds at least 8 bars and
   changes on a phrase boundary with a riser in or a swell out. Today's energy fades continuously, so
   nothing marks the moment the room got busy.
4. **The build and the release.** A turn that runs past a few minutes builds (the ostinato holds, a filter
   and a soft riser climb); its end, or a commit, lands the release. The build's length is the
   information.
5. **Failures that don't nag.** The sour note holds at one level and settles into the texture after a few
   minutes, without disappearing from the score; it comes back to full when the check changes (a new
   failure, or another fail of the same check). Fixes the month-long red run problem too.
6. **Factions.** Each project has a lead colour inside the style's language (organ, horn, choir, saw lead),
   heard when it takes the lead or takes over: who's driving, by timbre.
7. **A home motif.** Four notes that are undertone's own, voiced per style, for its own moments.

**One experiment.** When something has waited on you for a long time (a permission prompt past five
minutes), the ostinato drops into 7/8: it stumbles forward until you answer. Strong, maybe too strong.

**First build, my pick:** Far shore with intensity tiers. It needs no samples (the Synth engine is
strongest at exactly this sound), the arpeggio-as-activity is the clearest new way to hear the room, and
the tiers are the base that Deep field, the build and release, and the DJ transitions all need.

## Sources

Mass Effect: [1] ocremix.org/info/Composer_Interview:_Wall_of_Sound · [2] squareenixmusic.com/features/interviews/samhulick.shtml ·
[3] composerfocus.com/the-music-of-mass-effect · [4] thegamer.com (Jack Wall interview) · [5] audiogang.org (Jack Wall interview) ·
[6] en.wikipedia.org/wiki/Mass_Effect_(video_game) · [7] vgmonline.net/masseffect · [8] hooktheory.com (Vigil, crowd-sourced) ·
[9] ocremix.org/remix/OCR04712 · [10] ocremix.org/remix/OCR02157 · [11] kotaku.com/tracing-the-musical-saga-of-mass-effect-5923741 ·
[12] squareenixmusic.com (ME2 review) · [14] mcvuk.com (Wwise words) · [15] soundonsound.com (Mass Effect 3) ·
[16] complex.com (ME3 composers interview) · [17] thequietus.com (Clint Mansell interview) · [18] vgmonline.net/masseffect3 ·
[21] mcvuk.com (Mass Effect Andromeda audio)

Stellaris: [S1] Steam, Dev Diary #27 Music & Sound (store.steampowered.com/news/app/281990/view/3819571572131175484) ·
[S2] x.com/composerandreas (snippet) · [S3] vinyl.stellaris.com · [S4] stellaris.paradoxwikis.com/Complete_Soundtrack ·
[S5] Steam, The Music of Utopia · [S6] discogs.com/release/16127479 · [S7] vgmonline.net/stellaris-original-soundtrack ·
[S8] emaginarock.fr (Stellaris, Andreas Waldetoft) · [S9] Steam, Leviathans music and sound · [S10][S11] chordu.com (automated chord detection) ·
[S12-14] songbpm.com (automated tempos; they disagree) · [S16] Steam, patch 1.5 notes (music player) · [S17] steamcommunity.com discussion ·
[S21] stellaris.paradoxwikis.com/Effects (set_crisis_sound) · [S22] steamcommunity.com discussion (crisis sound) ·
[S23] forum.paradoxplaza.com Dev Diary #82, Synthetic Dawn music (snippet) · [S24] tvtropes.org (snippet) · [S25] Apple Music, The Machine Age ·
[S26] Steam, Dev Diary #424, Nomads · [S27] x.com/composerandreas (snippet)

---

# Your job

You are a game-music director and sound designer reviewing this plan. You only have this document;
don't read any files. Be concrete and opinionated, and disagree where you should.

1. What's missing: from what makes the Stellaris and Mass Effect soundtracks work, what does this plan
   miss that would matter for undertone? (Technique, not trivia.)
2. Attack the ideas: which of the numbered ideas won't hold up over hours of focused background
   listening, or won't carry real information, or will be hard to make sound good in Tone.js? Say why,
   and what you'd do instead.
3. Your own: up to three ideas of your own that fit the constraints.
4. First build: if you could build one thing first, what is it and why? Include a concrete sound recipe
   (oscillators, filters, envelopes, rates, registers) for its signature sound.

Rules: under 700 words. No melodies or themes from the games. End with one line: "Reviewed from this
document only."
