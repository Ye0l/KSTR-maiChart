import type { Point } from './geometry.ts';
import { noteColor, type DisplayNote } from './presentation.ts';
import { finishesChain } from './press.ts';

type Tempo = { time: number; bpm: number }[];
export type SliceNote = DisplayNote & { paths: Point[][] };
// A SLIDE appears where it is judged: its end button, with its track drawn faintly on the same slice.
export type SliceItem = { kind: 'tap' | 'hold' | 'star' | 'slide' | 'touch' | 'touchHold'; position: string; color: string; note: SliceNote };
// Items judged at the same instant.
export type Instant = { time: number; items: SliceItem[] };

export const sliceCounts = [4, 5, 6];
export const defaultSliceCount = 5;
// How many beats one slice covers.
export const sliceLengths: [number, string][] = [[.5, '1/2박'], [1, '1박'], [2, '2박'], [4, '1마디']];
export const defaultSliceLength = 1;
// Each slot up the stack is this much smaller, so the slice being played dominates.
export const shrink = .8;
// Vertical squash of each disc; much rounder than the isometric board.
export const squash = .6;
// Seconds the stack takes to step down one slot when a slice ends.
export const shiftTime = .12;

// Continuous beat count since the chart's first tempo mark, following every BPM change.
export function beatPosition(tempo: Tempo, time: number) {
	if (time < tempo[0].time) return (time - tempo[0].time) * tempo[0].bpm / 60;
	let beats = 0;
	for (const [index, { time: start, bpm }] of tempo.entries()) {
		const end = tempo[index + 1]?.time ?? Infinity;
		beats += (Math.min(time, end) - start) * bpm / 60;
		if (time < end) break;
	}
	return beats;
}

export function timeAtBeat(tempo: Tempo, beat: number) {
	if (beat < 0) return tempo[0].time + beat * 60 / tempo[0].bpm;
	let beats = 0;
	for (const [index, { time: start, bpm }] of tempo.entries()) {
		const end = tempo[index + 1]?.time ?? Infinity;
		const span = (end - start) * bpm / 60;
		if (beat <= beats + span) return start + (beat - beats) * 60 / bpm;
		beats += span;
	}
	return Infinity;
}

// Index of the slice a time falls in; the tolerance keeps notes written on a boundary in the slice it opens.
export const sliceIndex = (tempo: Tempo, time: number, length: number) => Math.floor(beatPosition(tempo, time) / length + 1e-6);

// Every input instant, filed under the slice that holds it.
export function sliceInstants(notes: SliceNote[], tempo: Tempo, length: number) {
	const items: { time: number; item: SliceItem }[] = [];
	for (const note of notes) {
		const color = noteColor(note);
		if (note.kind === 'slide') {
			if (finishesChain(note, notes)) items.push({ time: note.time + note.wait + note.duration, item: { kind: 'slide', position: String(note.segments.at(-1)!.end), color, note } });
		} else items.push({ time: note.time, item: { kind: note.kind, position: note.position, color, note } });
	}
	items.sort((a, b) => a.time - b.time);
	const slices = new Map<number, Instant[]>();
	for (const { time, item } of items) {
		const index = sliceIndex(tempo, time, length);
		const instants = slices.get(index) ?? [];
		const last = instants.at(-1);
		if (last && time - last.time < 1e-6) last.items.push(item);
		else instants.push({ time, items: [item] });
		slices.set(index, instants);
	}
	return slices;
}

// Slot of slice `index` above the bottom (0 = the slice being played). The stack holds still within a slice and
// steps down over `shiftTime` when the next one starts, so a dense passage never makes it race.
export function sliceSlot(index: number, tempo: Tempo, time: number, length: number) {
	const current = sliceIndex(tempo, time, length);
	const settle = Math.min(1, (time - timeAtBeat(tempo, current * length)) / shiftTime);
	return index - current + (1 - settle) ** 2;
}

// Disc size and centre for a (fractional) slot; slot 0 is the bottom.
export function slotFrame(slot: number, sceneHeight: number, count: number) {
	const step = 1 + shrink;
	const stack = step * (1 - shrink ** (count - 1)) / (1 - shrink) + 1 + shrink ** (count - 1);
	const base = Math.min(250 * squash, (sceneHeight - 70) / stack);
	const scale = shrink ** Math.max(0, slot);
	const ry = base * scale;
	const y = sceneHeight - 40 - base - base * step * (1 - scale) / (1 - shrink);
	return { rx: ry / squash, ry, y, scale };
}

// Where a slice starts, as measure.beat in 4/4 (12.3 = third beat of measure 12), with a ½ for half-beat slices.
export function sliceLabel(index: number, length: number) {
	const beat = index * length;
	const whole = Math.floor(beat);
	return `${Math.floor(whole / 4) + 1}.${whole % 4 + 1}${beat - whole >= .5 ? '½' : ''}`;
}

// Each note of an instant joined to the nearest note of the instant before: the path a hand travels.
export function handPath(instants: Instant[], at: (id: string) => Point) {
	const lines: { from: Point; to: Point; order: number }[] = [];
	for (let i = 1; i < instants.length; i++) {
		const previous = instants[i - 1].items.map((item) => at(item.position));
		for (const item of instants[i].items) {
			const to = at(item.position);
			const from = previous.reduce((best, point) => Math.hypot(point.x - to.x, point.y - to.y) < Math.hypot(best.x - to.x, best.y - to.y) ? point : best);
			if (from.x !== to.x || from.y !== to.y) lines.push({ from, to, order: i });
		}
	}
	return lines;
}
