import { clamp, distance, slidePath, type Point } from './geometry.ts';
import type { Segment } from './simai.ts';
import { noteColor, type DisplayNote } from './presentation.ts';

export type Press = { time: number; button: string; color: string };
export type PressMark = Press & { strength: number };

// The flash every press gets, even with no afterimage; matches the note fade after a hit.
const flash = .18;
export const trailOptions = Array.from({ length: 18 }, (_, i) => i - 1);
export const defaultTrail = 4;
export type TrailUnit = 'notes' | 'beats';
export const trailUnits: [TrailUnit, string][] = [['notes', '노트'], ['beats', '비트']];

// A SLIDE with per-segment timings is split into parts; only the part that finishes the chain is judged.
export function finishesChain(note: DisplayNote, notes: DisplayNote[]) {
	const end = note.time + note.wait + note.duration;
	const button = String(note.segments.at(-1)!.end);
	return !notes.some((next) => next.kind === 'slide' && next !== note && next.wait === 0 && next.position === button && Math.abs(next.time - end) < 1e-6);
}

// Share of a slide's time left after its perfect moment, per shape, from MajdataPlay's measured tables
// (github.com/LingFeng-bbben/MajdataPlay, Utils/SlideTables.cs, GPL-3.0). Keys use the end position counted from the
// start (1 = same button); mirrored shapes share their counterpart's value.
const remainders: Record<string, number> = {
	line3: .182, line4: .19, line5: .152, line6: .19, line7: .182,
	circle1: .058, circle2: .465, circle3: .233, circle4: .155, circle5: .116, circle6: .093, circle7: .078, circle8: .066,
	v1: .185, v2: .15, v3: .158, v4: .158, v6: .158, v7: .158, v8: .154,
	ppqq1: .065, ppqq2: .086, ppqq3: .157, ppqq4: .065, ppqq5: .065, ppqq6: .067, ppqq7: .079, ppqq8: .0626,
	pq1: .095, pq2: .112, pq3: .125, pq4: .139, pq5: .16, pq6: .08, pq7: .084, pq8: .0895,
	L2: .1, L3: .104, L4: .098, L5: .105, s: .13, wifi: .16287
};

export function slideTable({ shape, start, end, middle }: Segment) {
	const relative = (from: number, to: number) => (to - from + 8) % 8 + 1;
	const mirror = (key: number) => key === 1 || key === 5 ? key : 10 - key;
	const upper = [7, 8, 1, 2].includes(start);
	const to = relative(start, end);
	switch (shape) {
		case '-': return `line${to}`;
		case '>': return `circle${upper ? to : mirror(to)}`;
		case '<': return `circle${upper ? mirror(to) : to}`;
		case '^': return `circle${to < 5 ? to : mirror(to)}`;
		case 'v': return `v${to}`;
		case 'pp': return `ppqq${to}`;
		case 'qq': return `ppqq${mirror(to)}`;
		case 'p': return `pq${to}`;
		case 'q': return `pq${mirror(to)}`;
		case 's': case 'z': return 's';
		case 'w': return 'wifi';
		case 'V': return `L${relative(start, middle!) === 7 ? to : mirror(to)}`;
		default: return '';
	}
}

const pathLength = (points: Point[]) => points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);

// The game judges a SLIDE the moment its star enters the last sensor area, and its perfect moment is a fixed share of
// the slide before the star finishes; the result only shows once the star is gone, so touching at the end is late.
// In a chain written with one duration the last part gets its share of the time by length, as its arrows do in game.
export function slideJudgeTime(note: DisplayNote) {
	const last = note.segments.at(-1)!;
	const lengths = note.segments.map((segment) => pathLength(slidePath(segment)[0]));
	const total = lengths.reduce((sum, value) => sum + value, 0);
	const lastTime = note.duration * (total ? lengths.at(-1)! / total : 1);
	return note.time + note.wait + note.duration - lastTime * (remainders[slideTable(last)] ?? 0);
}

// Moments a button must be down for a perfect: TAP, HOLD start, star head, and where each SLIDE is judged.
export function pressMoments(notes: DisplayNote[]): Press[] {
	const presses: Press[] = [];
	for (const note of notes) {
		if (note.kind === 'tap' || note.kind === 'hold' || note.kind === 'star') {
			presses.push({ time: note.time, button: note.position, color: noteColor(note) });
		} else if (note.kind === 'slide' && finishesChain(note, notes)) {
			presses.push({ time: slideJudgeTime(note), button: String(note.segments.at(-1)!.end), color: noteColor(note) });
		}
	}
	return presses.sort((a, b) => a.time - b.time);
}

export const beatAt = (tempo: { time: number; bpm: number }[], at: number) => 60 / (tempo.findLast((entry) => entry.time <= at) ?? tempo[0]).bpm;

// The newest press on each button, lingering for `trail` beats or for the last `trail` press moments; -1 shows nothing.
// Counting notes keeps the afterimage uneven on purpose: a short one means the hand had to move fast.
export function pressMarks(presses: Press[], time: number, tempo: { time: number; bpm: number }[], trail: number, unit: TrailUnit = 'beats'): PressMark[] {
	if (trail < 0) return [];
	let done = presses.length;
	for (let i = 0; i < presses.length; i++) if (presses[i].time > time) { done = i; break; }
	const latest = new Map<string, PressMark>();
	if (unit === 'notes') {
		// Walk back from now; presses at the same instant are one moment, so a chord counts once.
		const moments: number[] = [];
		for (let i = done - 1; i >= 0; i--) {
			const press = presses[i];
			if (!moments.length || Math.abs(moments.at(-1)! - press.time) > 1e-6) {
				if (moments.length === Math.max(1, trail)) break;
				moments.push(press.time);
			}
			if (latest.has(press.button)) continue;
			const strength = trail === 0 ? clamp(1 - (time - press.time) / flash) : (trail - moments.length + 1) / trail;
			if (strength > 0) latest.set(press.button, { ...press, strength });
		}
		return [...latest.values()];
	}
	for (const press of presses.slice(0, done)) {
		const span = Math.max(flash, trail * beatAt(tempo, press.time));
		const strength = clamp(1 - (time - press.time) / span);
		if (strength > 0) latest.set(press.button, { ...press, strength });
	}
	return [...latest.values()];
}
