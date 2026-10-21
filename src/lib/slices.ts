import type { Point } from './geometry.ts';
import { noteColor, type DisplayNote } from './presentation.ts';
import { beatAt, finishesChain } from './press.ts';

type Tempo = { time: number; bpm: number }[];
export type SliceNote = DisplayNote & { paths: Point[][] };
// A SLIDE appears where it is judged: its end button, with its track drawn faintly on the same slice.
export type SliceItem = { kind: 'tap' | 'hold' | 'star' | 'slide' | 'touch' | 'touchHold'; position: string; color: string; note: SliceNote };
export type Slice = { time: number; items: SliceItem[] };

export const sliceCounts = [4, 5, 6];
export const defaultSliceCount = 5;
// Each slot up the stack is this much smaller, so the next instant to hit dominates.
export const shrink = .8;
// Vertical squash of each disc; much rounder than the isometric board.
export const squash = .6;

// Every input instant becomes one slice; notes at the same instant share it.
export function sliceMoments(notes: SliceNote[]): Slice[] {
	const items: { time: number; item: SliceItem }[] = [];
	for (const note of notes) {
		const color = noteColor(note);
		if (note.kind === 'slide') {
			if (finishesChain(note, notes)) items.push({ time: note.time + note.wait + note.duration, item: { kind: 'slide', position: String(note.segments.at(-1)!.end), color, note } });
		} else items.push({ time: note.time, item: { kind: note.kind, position: note.position, color, note } });
	}
	items.sort((a, b) => a.time - b.time);
	const slices: Slice[] = [];
	for (const { time, item } of items) {
		const last = slices.at(-1);
		if (last && time - last.time < 1e-6) last.items.push(item);
		else slices.push({ time, items: [item] });
	}
	return slices;
}

// Fractional count of instants already passed: slice i sits `i - progress` slots above the bottom.
// Between two instants the stack moves one slot, so dense passages scroll fast and rests slowly.
export function sliceProgress(times: number[], time: number, tempo: Tempo) {
	if (!times.length) return 0;
	let k = -1;
	while (k + 1 < times.length && times[k + 1] <= time) k++;
	if (k < 0) return -(times[0] - time) / beatAt(tempo, times[0]);
	if (k === times.length - 1) return k + Math.min(1, (time - times[k]) / beatAt(tempo, times[k]));
	return k + (time - times[k]) / (times[k + 1] - times[k]);
}

// Disc size and centre for a (fractional) slot; slot 0 is the bottom, where notes are hit.
export function slotFrame(slot: number, sceneHeight: number, count: number) {
	const step = 1 + shrink;
	const stack = step * (1 - shrink ** (count - 1)) / (1 - shrink) + 1 + shrink ** (count - 1);
	const base = Math.min(250 * squash, (sceneHeight - 70) / stack);
	const scale = shrink ** Math.max(0, slot);
	const ry = base * scale;
	const y = sceneHeight - 40 - base - base * step * (1 - scale) / (1 - shrink);
	return { rx: ry / squash, ry, y, scale };
}

// The gap before a slice as a note value (1/16 = a sixteenth) when it lands on a common grid, plus milliseconds.
export function gapLabel(gap: number, bpm: number) {
	const ms = `${Math.round(gap * 1000)}ms`;
	const measure = gap * bpm / 240;
	const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
	for (const division of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
		const count = Math.round(measure * division);
		if (count > 0 && Math.abs(measure * division - count) < .02) {
			const d = gcd(count, division);
			return { note: `${count / d}/${division / d}`, ms };
		}
	}
	return { note: '', ms };
}
