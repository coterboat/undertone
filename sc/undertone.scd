// undertone: the SuperCollider engine.
//
// The bridge starts this with `sclang -D -u 57130 sc/undertone.scd` and sends it /ut/* OSC
// messages (bridge/server.mjs, toOsc). Each note message carries a delay in seconds; it
// becomes a synth scheduled that far ahead on the server, so timing stays tight.
// Replies (/ut/ready, /ut/pong) go back to the bridge on port 57131.

(
~bridge = NetAddr("127.0.0.1", 57131);
// Our own server on its own port, so it never collides with the SuperCollider IDE's
s = Server(\undertone, NetAddr("127.0.0.1", 57190));
Server.default = s;
s.options.numInputBusChannels = 0; // no microphone
s.options.numOutputBusChannels = 2;
s.options.memSize = 2 ** 17;
// The bridge passes [output device, input device]: an input device with no microphone,
// so booting never asks macOS for microphone access
~devices = thisProcess.argv;
if(~devices.size > 0 and: { ~devices[0].size > 0 }) { s.options.outDevice = ~devices[0] };
if(~devices.size > 1 and: { ~devices[1].size > 0 }) { s.options.inDevice = ~devices[1] };
s.latency = 0.05;

// A server left over from a run that didn't shut down cleanly: ask it to quit before booting
NetAddr("127.0.0.1", 57190).sendMsg('/quit');

fork { 0.5.wait; s.waitForBoot({

	// ------------------------------------------------------------ voices

	SynthDef(\utPad, { |out, verb, freq = 220, amp = 0.1, dur = 4, atk = 2, rel = 4, cutoff = 900|
		var env = EnvGen.kr(Env([0, 1, 1, 0], [atk, (dur - atk).max(0.05), rel], [2, 0, -3]), doneAction: 2);
		var sig = Mix([-0.08, 0, 0.08].collect { |d| Saw.ar(freq * d.midiratio) }) / 3;
		sig = sig + (SinOsc.ar(freq * 0.5) * 0.25);
		sig = RLPF.ar(sig, (cutoff * LFNoise2.kr(0.15).range(0.8, 1.2)).clip(200, 8000), 0.8);
		sig = Pan2.ar(sig, LFNoise2.kr(0.1).range(-0.5, 0.5)) * env * amp;
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.55);
	}).add;

	// The listening review of 10-7 (docs/listening/2026-10-07.md): what grated on SuperCollider was a wall
	// below 150 Hz. The bass's sub-octave is down to a hint (0.4 -> 0.12, nothing under 30 Hz), its tail
	// follows the note (it rang 0.4 s past each one, so off-beat house bass never stopped), and it ducks
	// under the kick, as on the Synth engine. Measured in an offline render of Afterhours: sub 26% -> 4%.
	SynthDef(\utBass, { |out, duck, freq = 55, amp = 0.3, dur = 0.5|
		var env = EnvGen.kr(Env.perc(0.008, dur + 0.12, curve: -3), doneAction: 2);
		var fenv = EnvGen.kr(Env.perc(0.005, 0.25)).range(1, 4);
		var sig = (LFTri.ar(freq) * 0.7) + (SinOsc.ar(freq * 0.5) * 0.12) + (Pulse.ar(freq, 0.4) * 0.15);
		sig = RLPF.ar(sig, (freq * 3 * fenv).clip(60, 2000), 0.6);
		sig = HPF.ar(sig, 30) * (1 - (In.kr(duck) * 0.6).clip(0, 0.6));
		Out.ar(out, Pan2.ar(sig * env * amp, 0));
	}).add;

	// FM electric piano with a little tremolo
	SynthDef(\utKeys, { |out, verb, echo, freq = 440, amp = 0.2, dur = 1|
		var env = EnvGen.kr(Env.perc(0.004, dur * 1.5 + 1.2, curve: -4), doneAction: 2);
		var menv = EnvGen.kr(Env.perc(0.001, 0.8, curve: -5));
		var mod = SinOsc.ar(freq * 2) * freq * (0.4 + (menv * 1.6));
		var sig = (SinOsc.ar(freq + mod) * 0.5) + (SinOsc.ar(freq * 1.003) * 0.35) + (SinOsc.ar(freq * 4.02) * menv * 0.08);
		sig = sig * (1 + (SinOsc.kr(4.3) * 0.18));
		sig = Pan2.ar(sig, Rand(-0.3, 0.3)) * env * amp;
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.3);
		Out.ar(echo, sig * 0.12);
	}).add;

	// Karplus-Strong string
	SynthDef(\utPluck, { |out, verb, echo, freq = 440, amp = 0.2, dur = 0.5|
		var sig = Pluck.ar(PinkNoise.ar(0.6), Impulse.kr(0), 0.05, freq.reciprocal, 2.5, 0.35);
		var life = EnvGen.kr(Env([1, 1, 0], [3, 0.05]), doneAction: 2);
		sig = LPF.ar(sig, 4000) + (SinOsc.ar(freq) * EnvGen.kr(Env.perc(0.001, 0.4)) * 0.15);
		sig = Pan2.ar(sig * life, Rand(-0.5, 0.5)) * amp;
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.25);
		Out.ar(echo, sig * 0.4);
	}).add;

	// Vibraphone-ish: three struck partials and a motor tremolo
	SynthDef(\utMallet, { |out, verb, echo, freq = 660, amp = 0.2, dur = 0.5|
		var ratios = [1, 3.98, 10.6], levels = [1, 0.3, 0.08], times = [2.0, 0.6, 0.15];
		var sig = Mix(ratios.collect { |r, i| SinOsc.ar(freq * r) * EnvGen.kr(Env.perc(0.001, times[i], curve: -5)) * levels[i] });
		var life = EnvGen.kr(Env([1, 1, 0], [2.1, 0.05]), doneAction: 2);
		sig = sig * (1 + (SinOsc.kr(5.5) * 0.25)) * life;
		sig = Pan2.ar(sig * 0.6, Rand(-0.4, 0.4)) * amp;
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.4);
		Out.ar(echo, sig * 0.15);
	}).add;

	// Bowed low strings
	SynthDef(\utCello, { |out, verb, freq = 110, amp = 0.15, dur = 1|
		var env = EnvGen.kr(Env([0, 1, 0.8, 0], [0.25, dur.max(0.2), 1.2], [2, 0, -3]), doneAction: 2);
		var vib = SinOsc.kr(5, 0, 0.004 * EnvGen.kr(Env([0, 0, 1], [0.3, 0.5])));
		var sig = Saw.ar(freq * (1 + vib)) + (Saw.ar(freq * 1.003) * 0.6);
		sig = RLPF.ar(sig, freq * 6, 0.7) * 0.35;
		sig = Pan2.ar(sig * env * amp, Rand(-0.2, 0.2));
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.5);
	}).add;

	// Inharmonic bell: commits, checklist steps, a fixed build
	SynthDef(\utBell, { |out, verb, echo, freq = 880, amp = 0.15, dur = 1|
		var ratios = [1, 2.0, 2.76, 5.4, 8.93], levels = [1, 0.5, 0.4, 0.2, 0.1], times = [3.5, 2.5, 2, 1.2, 0.6];
		var sig = Mix(ratios.collect { |r, i| SinOsc.ar(freq * r, Rand(0, 2pi)) * EnvGen.kr(Env.perc(0.002, times[i], curve: -4)) * levels[i] }) * 0.4;
		var life = EnvGen.kr(Env([1, 1, 0], [3.6, 0.05]), doneAction: 2);
		sig = Pan2.ar(sig * life * amp, Rand(-0.3, 0.3));
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.6);
		Out.ar(echo, sig * 0.25);
	}).add;

	// ------------------------------------------------------------ drums

	// The kick was most of that wall: a 42 Hz tail ringing 0.45 s, 7 dB over the bass. Now it ends at 48 Hz in
	// 0.3 s with a short knock for definition (Gemini: it "lacks transient"), nothing under 32 Hz, and it
	// tells the bass to step aside. Offline render: the same peak, 5 dB less energy, sub 65% -> 34%.
	SynthDef(\utKick, { |out, duck, amp = 0.8|
		var penv = EnvGen.kr(Env([220, 60, 48], [0.03, 0.22], [-4, -2]));
		var env = EnvGen.kr(Env.perc(0.002, 0.3, curve: -6), doneAction: 2);
		var knock = BPF.ar(WhiteNoise.ar, 2200, 0.8) * EnvGen.kr(Env.perc(0.0005, 0.012)) * 0.5;
		var sig = SinOsc.ar(penv) + (LPF.ar(WhiteNoise.ar, 1500) * EnvGen.kr(Env.perc(0.001, 0.01)) * 0.3) + knock;
		sig = HPF.ar(sig, 32);
		Out.kr(duck, EnvGen.kr(Env.perc(0.004, 0.18)));
		Out.ar(out, Pan2.ar((sig * env * amp * 0.75).tanh, 0));
	}).add;

	SynthDef(\utSnare, { |out, verb, amp = 0.5|
		var nenv = EnvGen.kr(Env.perc(0.002, 0.18, curve: -6), doneAction: 2);
		var tone = SinOsc.ar(EnvGen.kr(Env([240, 180], [0.05]))) * EnvGen.kr(Env.perc(0.001, 0.08)) * 0.5;
		var noise = BPF.ar(PinkNoise.ar(1.2), 1800, 0.9) * nenv;
		var sig = Pan2.ar((tone + noise) * amp, 0);
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.2);
	}).add;

	SynthDef(\utHat, { |out, amp = 0.3|
		var env = EnvGen.kr(Env.perc(0.001, 0.045, curve: -6), doneAction: 2);
		var sig = HPF.ar(WhiteNoise.ar, 7500) * env * amp * 0.5;
		Out.ar(out, Pan2.ar(sig, 0.15));
	}).add;

	SynthDef(\utTom, { |out, verb, freq = 70, amp = 0.8|
		var penv = EnvGen.kr(Env([freq * 2.2, freq, freq * 0.9], [0.05, 0.6], -4));
		var env = EnvGen.kr(Env.perc(0.003, 0.9, curve: -4), doneAction: 2);
		var sig = SinOsc.ar(penv) + (BPF.ar(PinkNoise.ar, 400, 1) * EnvGen.kr(Env.perc(0.001, 0.06)) * 0.5);
		sig = Pan2.ar((sig * env * amp).tanh, 0);
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.35);
	}).add;

	// ------------------------------------------------------------ held sounds

	// The sour note: glides on every chord change, released when the build is fixed
	SynthDef(\utSour, { |out, verb, freq = 370, amp = 0.11, gate = 1|
		var env = EnvGen.kr(Env.asr(1.1, 1, 1.4), gate, doneAction: 2);
		var f = Lag.kr(freq, 0.4);
		var sig = Saw.ar(f) + Saw.ar(f * 1.01);
		sig = BPF.ar(sig, 1500, 0.9) * (1 - SinOsc.kr(5.5).range(0, 0.55));
		sig = Pan2.ar(sig * env * amp, 0);
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.35);
	}).add;

	// Waiting on you: a pedal that swells with each open question
	SynthDef(\utDrone, { |out, verb, f1 = 55, f2 = 110, f3 = 165, level = 0|
		var lvl = Lag.kr(level, 3) * LFNoise2.kr(0.06).range(0.6, 1);
		var sig = (SinOsc.ar(Lag.kr(f1, 3)) * 0.6) + (SinOsc.ar(Lag.kr(f2, 3) * 0.997) * 0.3) + (LFTri.ar(Lag.kr(f3, 3) * 1.002) * 0.15);
		sig = Pan2.ar(LPF.ar(sig, 900) * lvl, 0);
		Out.ar(out, sig);
		Out.ar(verb, sig * 0.5);
	}).add;

	SynthDef(\utVinyl, { |out, amount = 0.25|
		var a = Lag.kr(amount, 0.4), crackle, hiss;
		crackle = BPF.ar(Dust2.ar(1 + (a * 5)), 2500, 1.5) * 0.15;
		hiss = LPF.ar(HPF.ar(PinkNoise.ar(0.006), 900), 5000);
		Out.ar(out, Pan2.ar((crackle + hiss) * a * 0.6, 0));
	}).add;

	// ------------------------------------------------------------ effects and master

	// A dotted eighth at the page's tempo (/ut/tempo); 0.55 s is one at Late shift's 82 bpm, for a page
	// that doesn't send it. Fixed, its repeats fell off the beat at every other tempo.
	SynthDef(\utEcho, { |in, out, verb, time = 0.55|
		var sig = In.ar(in, 2), t = Lag.kr(time, 0.5);
		var d = LPF.ar(CombL.ar(sig, 2, t, t * 6), 2600);
		Out.ar(out, d);
		Out.ar(verb, d * 0.4);
	}).add;

	SynthDef(\utVerb, { |in, out, room = 0.9, damp = 0.45|
		var sig = DelayN.ar(In.ar(in, 2), 0.05, 0.03);
		sig = FreeVerb2.ar(sig[0], sig[1], 1, room, damp) * 1.5;
		Out.ar(out, sig);
	}).add;

	// Tape wobble, a gentle compressor and a limiter; `level` is the page's volume and play/stop
	SynthDef(\utMaster, { |in, level = 0|
		var sig = In.ar(in, 2);
		sig = DelayC.ar(sig, 0.01, SinOsc.kr(0.32).range(0.003, 0.0045));
		sig = LPF.ar(sig, 11000);
		sig = Compander.ar(sig, sig, 0.3, 1, 0.5, 0.01, 0.2);
		sig = Limiter.ar(sig * Lag.kr(level, 0.5), 0.85, 0.02);
		Out.ar(0, sig);
	}).add;

	// Reports the master's peak and RMS to the bridge ten times a second (GET /sc/meter)
	SynthDef(\utMeter, {
		SendPeakRMS.kr(In.ar(0, 2), 10, 3, '/ut/peak');
	}).add;

	// The last 30 seconds of output, written round and round into a buffer, so a reaction on the
	// page can keep what you were just hearing (/ut/dump)
	SynthDef(\utRing, { |buf, phaseBus|
		var phase = Phasor.ar(0, 1, 0, BufFrames.kr(buf));
		BufWr.ar(In.ar(0, 2), buf, phase);
		Out.kr(phaseBus, A2K.kr(phase));
	}).add;

	~ringBuf = Buffer.alloc(s, (s.sampleRate ? 48000 * 30).asInteger, 2);
	~phaseBus = Bus.control(s, 1);
	~duckBus = Bus.control(s, 1); // the kick writes it, the bass reads it

	s.sync;

	~masterBus = Bus.audio(s, 2);
	~verbBus = Bus.audio(s, 2);
	~echoBus = Bus.audio(s, 2);
	~src = Group.head(s);
	~fx = Group.after(~src);
	~mg = Group.after(~fx);
	~echo = Synth(\utEcho, [\in, ~echoBus, \out, ~masterBus, \verb, ~verbBus], ~fx, \addToHead);
	~verb = Synth(\utVerb, [\in, ~verbBus, \out, ~masterBus], ~fx, \addToTail);
	~master = Synth(\utMaster, [\in, ~masterBus, \level, 0], ~mg);
	~drone = Synth(\utDrone, [\out, ~masterBus, \verb, ~verbBus], ~src);
	~meter = Synth(\utMeter, [], ~mg, \addAfter);
	~ring = Synth(\utRing, [\buf, ~ringBuf, \phaseBus, ~phaseBus], ~mg, \addAfter);
	~vinyl = Synth(\utVinyl, [\out, ~masterBus, \amount, 0.25], ~src);
	~cutoff = 900;
	~sour = nil;

	~at = { |delay, fn| s.makeBundle(delay.max(0.01), fn) };
	~fold = { |n, lo, hi| while { n < lo } { n = n + 12 }; while { n > hi } { n = n - 12 }; n };
	~voices = (keys: \utKeys, pluck: \utPluck, mallet: \utMallet, cello: \utCello);
	~gains = (keys: 0.22, pluck: 0.85, mallet: 0.18, cello: 0.36);
	// The Mix's "SuperCollider synths" slider (10-7, Alex: "the synths can be a bit loud"): it scales the
	// pad, bass and session voices as each note starts; drums, bells, the sour note, drone and vinyl keep theirs
	~synths = 1;

	// ------------------------------------------------------------ what the bridge sends

	OSCdef(\utPad, { |msg|
		var d = msg[1], v = msg[2], dur = msg[3], notes = msg.drop(5);
		~at.(d, { notes.do { |m| Synth(\utPad, [\out, ~masterBus, \verb, ~verbBus, \freq, m.midicps, \amp, v * 0.14 * ~synths, \dur, dur, \cutoff, ~cutoff], ~src) } });
	}, '/ut/pad');

	OSCdef(\utBass, { |msg|
		~at.(msg[1], { Synth(\utBass, [\out, ~masterBus, \duck, ~duckBus, \freq, msg[2].midicps, \dur, msg[3], \amp, msg[4] * 0.25 * ~synths], ~src) });
	}, '/ut/bass');

	OSCdef(\utVoice, { |msg|
		var t = msg[2].asSymbol;
		var def = ~voices[t] ? \utKeys, gain = ~gains[t] ? 0.2;
		~at.(msg[1], { Synth(def, [\out, ~masterBus, \verb, ~verbBus, \echo, ~echoBus, \freq, msg[3].midicps, \dur, msg[4], \amp, msg[5] * gain * ~synths], ~src) });
	}, '/ut/voice');

	OSCdef(\utDrum, { |msg|
		var kind = msg[2].asSymbol, v = msg[3], m = msg[4];
		~at.(msg[1], {
			switch(kind,
				\kick, { Synth(\utKick, [\out, ~masterBus, \duck, ~duckBus, \amp, v * 0.7], ~src) },
				\snare, { Synth(\utSnare, [\out, ~masterBus, \verb, ~verbBus, \amp, v * 0.5], ~src) },
				\hat, { Synth(\utHat, [\out, ~masterBus, \amp, v * 0.5], ~src) },
				\tom, { Synth(\utTom, [\out, ~masterBus, \verb, ~verbBus, \freq, (if(m > 0) { m } { 38 }).midicps, \amp, v * 0.7], ~src) },
				\rim, { Synth(\utSnare, [\out, ~masterBus, \verb, ~verbBus, \amp, v * 0.25], ~src) }
			);
		});
	}, '/ut/drum');

	OSCdef(\utBell, { |msg|
		~at.(msg[1], { Synth(\utBell, [\out, ~masterBus, \verb, ~verbBus, \echo, ~echoBus, \freq, msg[2].midicps, \dur, msg[3], \amp, msg[4] * 0.25], ~src) });
	}, '/ut/bell');

	OSCdef(\utSour, { |msg|
		var d = msg[1], state = msg[2].asSymbol, m = msg[3], to = msg[4], node;
		case
		{ state == \on } {
			if(~sour.notNil) { node = ~sour; ~at.(d, { node.set(\gate, 0) }) };
			~at.(d, { ~sour = Synth(\utSour, [\out, ~masterBus, \verb, ~verbBus, \freq, m.midicps], ~src) });
		}
		{ state == \move } { if(~sour.notNil) { node = ~sour; ~at.(d, { node.set(\freq, m.midicps) }) } }
		{ state == \off } {
			if(~sour.notNil) {
				node = ~sour;
				~sour = nil;
				~at.(d, { node.set(\freq, to.midicps) });
				~at.(d + 0.9, { node.set(\gate, 0) });
			};
		};
	}, '/ut/sour');

	OSCdef(\utDrone, { |msg|
		var lvl = msg[1], t = msg[2];
		~drone.set(\level, if(lvl > 0) { 0.02 + (0.05 * lvl) } { 0 },
			\f1, ~fold.(t, 38, 49).midicps, \f2, ~fold.(t, 50, 61).midicps, \f3, ~fold.(t + 7, 50, 61).midicps);
	}, '/ut/drone');

	OSCdef(\utTexture, { |msg| ~vinyl.set(\amount, msg[1]) }, '/ut/texture');
	OSCdef(\utEnergy, { |msg| ~cutoff = msg[3] * (0.75 + (msg[2] * 1.6)) }, '/ut/energy');
	OSCdef(\utTempo, { |msg| var t = 45 / msg[2].max(30); ~at.(msg[1], { ~echo.set(\time, t) }) }, '/ut/tempo');
	OSCdef(\utLevel, { |msg| ~master.set(\level, msg[1]) }, '/ut/level');
	OSCdef(\utSynths, { |msg| ~synths = msg[1].clip(0, 2) }, '/ut/synths');
	OSCdef(\utPeak, { |msg| ~bridge.sendMsg('/ut/peak', msg[3], msg[4], msg[5], msg[6]) }, '/ut/peak');
	OSCdef(\utPing, { ~bridge.sendMsg('/ut/pong') }, '/ut/ping');
	// Write the ring to a file and tell the bridge where its write head was
	OSCdef(\utDump, { |msg|
		var file = msg[1].asString;
		fork {
			var c = Condition.new, head = 0;
			~phaseBus.get({ |v| head = v; c.unhang });
			c.hang;
			~ringBuf.write(file, "wav", "int16");
			s.sync;
			~bridge.sendMsg('/ut/dumped', file, head.asFloat, ~ringBuf.numFrames.asFloat);
		};
	}, '/ut/dump');
	OSCdef(\utQuit, { s.quit; AppClock.sched(0.5, { 0.exit; nil }) }, '/ut/quit');

	~bridge.sendMsg('/ut/ready');
	"undertone: SuperCollider ready".postln;
}) };
)
