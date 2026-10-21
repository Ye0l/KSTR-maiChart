import { clamp } from './geometry.ts';
import { noteColor, type DisplayNote } from './presentation.ts';

export type Press = { time: number; button: string; color: string };
export type PressMark = Press & { strength: number };

// The flash every press gets, even with no afterimage; matches the note fade after a hit.
const flash = .18;
export const trailOptions = Array.from({ length: 18 }, (_, i) => i - 1);
export const defaultTrail = 4;
export type TrailUnit = 'notes' | 'beats';
export const trailUnits: [TrailUnit, string][] = [['notes', '노트'], ['beats', '비트']];

// Moments a button must be down for a perfect: TAP, HOLD start, star head, and where each SLIDE finishes.
export function pressMoments(notes: DisplayNote[]): Press[] {
	const end = (note: DisplayNote) => note.time + note.wait + note.duration;
	const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
	const presses: Press[] = [];
	for (const note of notes) {
		if (note.kind === 'tap' || note.kind === 'hold' || note.kind === 'star') {
			presses.push({ time: note.time, button: note.position, color: noteColor(note) });
		} else if (note.kind === 'slide') {
			const button = String(note.segments.at(-1)!.end);
			// A SLIDE with per-segment timings is split into parts; only the last part's end is judged.
			const continued = notes.some((next) => next.kind === 'slide' && next !== note && next.wait === 0 && next.position === button && near(next.time, end(note)));
			if (!continued) presses.push({ time: end(note), button, color: noteColor(note) });
		}
	}
	return presses.sort((a, b) => a.time - b.time);
}

const beatAt = (tempo: { time: number; bpm: number }[], at: number) => 60 / (tempo.findLast((entry) => entry.time <= at) ?? tempo[0]).bpm;

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
