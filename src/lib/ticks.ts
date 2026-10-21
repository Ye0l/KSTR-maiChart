// Chart times in [from, to), once per instant: a chord ticks once. `times` must be sorted.
export function dueTicks(times: number[], from: number, to: number) {
	const due: number[] = [];
	for (const at of times) {
		if (at >= to) break;
		if (at >= from && (!due.length || at - due.at(-1)! > 1e-6)) due.push(at);
	}
	return due;
}

// Ticks are scheduled a little ahead on the audio clock, so they land on time whatever the frame rate.
const lookahead = .15;

export function createTicker() {
	let context: AudioContext | undefined;
	let sources: OscillatorNode[] = [];
	let until: number | undefined;
	let last = { time: 0, rate: 1 };

	function click(at: number) {
		const osc = context!.createOscillator();
		const gain = context!.createGain();
		osc.frequency.value = 1760;
		gain.gain.setValueAtTime(.35, at);
		gain.gain.exponentialRampToValueAtTime(.001, at + .04);
		osc.connect(gain).connect(context!.destination);
		osc.start(at);
		osc.stop(at + .05);
		osc.onended = () => { sources = sources.filter((source) => source !== osc); };
		sources.push(osc);
	}

	return {
		// Browsers only start audio from a user gesture, so call this from one.
		unlock() {
			context ??= new AudioContext();
			if (context.state === 'suspended') void context.resume();
		},
		stop() {
			for (const source of sources) source.stop();
			sources = [];
			until = undefined;
		},
		update(times: number[], time: number, rate: number) {
			if (!context || context.state !== 'running') return;
			// A seek or rate change invalidates what was queued.
			if (until !== undefined && (rate !== last.rate || time < last.time || time - last.time > .5)) this.stop();
			last = { time, rate };
			const from = until ?? time;
			const to = time + lookahead * rate;
			for (const at of dueTicks(times, from, to)) click(context.currentTime + Math.max(0, at - time) / rate);
			until = Math.max(from, to);
		}
	};
}
