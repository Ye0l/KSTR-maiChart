export type Segment = { shape: string; start: number; end: number; middle?: number };
export type Note = {
	kind: 'tap' | 'hold' | 'touch' | 'touchHold' | 'star' | 'slide';
	position: string;
	time: number;
	duration: number;
	wait: number;
	break: boolean;
	ex: boolean;
	firework: boolean;
	segments: Segment[];
};

export function readMaidata(text: string) {
	const fields: Record<string, string> = {};
	const matches = [...text.replace(/^\uFEFF/, '').matchAll(/^&([^=\r\n]+)=([\s\S]*?)(?=^&|$(?![\s\S]))/gm)];
	for (const match of matches) fields[match[1].trim()] = match[2].trim();
	return fields;
}

function positive(value: string, allowZero = false) {
	const number = Number(value);
	if (!value.trim() || !Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`잘못된 시간 값: ${value}`);
	return number;
}

function length(value: string, bpm: number): number {
	if (value.startsWith('#')) return positive(value.slice(1), true);
	const [division, count, extra] = value.split(':');
	if (!count || extra) throw new Error(`지원하지 않는 길이: ${value}`);
	return (240 / bpm) * positive(count, true) / positive(division);
}

function timing(value: string, bpm: number, slide: boolean) {
	if (value.includes('##')) {
		const [delay, duration, extra] = value.split('##');
		if (!slide || extra || !Number.isFinite(Number(delay)) || Number(delay) < 0) {
			throw new Error(`지원하지 않는 시간: ${value}`);
		}
		return { wait: Number(delay), duration: length(duration.includes(':') || duration.startsWith('#') ? duration : `#${duration}`, bpm) };
	}
	let localBpm = bpm;
	const override = value.match(/^(\d+(?:\.\d+)?)#(.+)$/);
	if (override) {
		localBpm = positive(override[1]);
		value = override[2];
	}
	return { wait: slide ? 60 / localBpm : 0, duration: length(value, localBpm) };
}

function parseToken(token: string, time: number, bpm: number): Note[] {
	const start = token.match(/^([1-8]|[ABDE][1-8]|C[12]?)([bxhf!?$@]*)/);
	if (!start) throw new Error(`지원하지 않는 노트: ${token}`);
	const position = start[1];
	const flags = start[2];
	let rest = token.slice(start[0].length);
	const base: Note = {
		kind: 'tap', position, time, duration: 0, wait: 0,
		break: flags.includes('b'), ex: flags.includes('x'), firework: flags.includes('f'), segments: []
	};
	if (/^[A-E]/.test(position)) {
		base.kind = flags.includes('h') ? 'touchHold' : 'touch';
	} else if (flags.includes('h')) base.kind = 'hold';
	if (base.kind === 'hold' || base.kind === 'touchHold') {
		const hold = rest.match(/^\[([^\]]+)\]$/);
		if (!hold) throw new Error(`HOLD 길이 누락: ${token}`);
		return [{ ...base, ...timing(hold[1], bpm, false) }];
	}
	if (!rest) return [base];
	if (!/^[1-8]$/.test(position)) throw new Error(`지원하지 않는 TOUCH: ${token}`);
	const notes: Note[] = flags.includes('?') ? [] : [{ ...base, kind: flags.includes('!') ? 'tap' : 'star' }];
	for (const branch of rest.split('*')) {
		let remaining = branch;
		let from = Number(position);
		const parts: { segment: Segment; timing?: string }[] = [];
		while (remaining) {
			const part = remaining.match(/^(pp|qq|[\-^<>vpqszwV])([1-8])([1-8])?([bx]*)?(?:\[([^\]]+)\])?([bx]*)/);
			if (!part) throw new Error(`지원하지 않는 SLIDE: ${token}`);
			const shape = part[1];
			if ((shape === 'V') !== Boolean(part[3])) throw new Error(`잘못된 SLIDE 끝점: ${token}`);
			const end = Number(shape === 'V' ? part[3] : part[2]);
			parts.push({ segment: { shape, start: from, end, ...(shape === 'V' ? { middle: Number(part[2]) } : {}) }, timing: part[5] });
			from = end;
			remaining = remaining.slice(part[0].length);
		}
		if (!parts.length || !parts.at(-1)?.timing) throw new Error(`SLIDE 길이 누락: ${token}`);
		if (parts.slice(0, -1).every((part) => !part.timing)) {
			const span = timing(parts.at(-1)!.timing!, bpm, true);
			notes.push({ ...base, kind: 'slide', ...span, break: /b/.test(branch), segments: parts.map((part) => part.segment) });
		} else {
			let cursor = time;
			for (const [index, part] of parts.entries()) {
				if (!part.timing) throw new Error(`혼합 SLIDE 길이: ${token}`);
				const span = timing(part.timing, bpm, true);
				const wait = index === 0 ? span.wait : 0;
				notes.push({ ...base, kind: 'slide', position: String(part.segment.start), time: cursor, duration: span.duration, wait, break: /b/.test(branch), segments: [part.segment] });
				cursor += wait + span.duration;
			}
		}
	}
	return notes;
}

export function parseChart(source: string, initialBpm = 120, offset = 0) {
	const notes: Note[] = [];
	const warnings = new Set<string>();
	let bpm = Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : 120;
	let division = 4;
	let time = Number.isFinite(offset) ? offset : 0;
	const clean = source.replace(/\/\/[^\r\n]*/g, '').replace(/\s/g, '');
	for (let cell of clean.split(',')) {
		try {
			while (/^[({]/.test(cell)) {
				const directive = cell.match(/^(?:\(([^)]+)\)|\{([^}]+)\})/);
				if (!directive) throw new Error(`불완전한 지시문: ${cell}`);
				if (directive[1]) bpm = positive(directive[1]);
				else division = positive(directive[2]);
				cell = cell.slice(directive[0].length);
			}
			if (cell === 'E') break;
			for (const token of cell.split('/').filter(Boolean)) {
				try {
					// Simai also permits simultaneous button taps written as e.g. 18.
					if (/^[1-8]{2,}$/.test(token)) {
						for (const button of token) notes.push(...parseToken(button, time, bpm));
					} else notes.push(...parseToken(token, time, bpm));
				} catch (error) {
					warnings.add(`${token}: ${(error as Error).message}`);
				}
			}
		} catch (error) {
			warnings.add((error as Error).message);
		}
		time += 240 / bpm / division;
	}
	notes.sort((a, b) => a.time - b.time);
	const duration = notes.reduce((end, note) => Math.max(end, note.time + note.wait + note.duration), time);
	return { notes, warnings: [...warnings], duration: Math.max(1, duration + 1) };
}
