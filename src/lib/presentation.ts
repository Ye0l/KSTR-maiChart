import type { Note } from './simai.ts';

export type DisplayNote = Note & { simultaneous: boolean };

export function markSimultaneous(notes: Note[]): DisplayNote[] {
	const counts = new Map<number, number>();
	// Group input onsets, not HOLD tails or SLIDE tracks; tolerate floating-point timing drift.
	const onset = (note: Note) => Math.round(note.time * 1e6);
	for (const note of notes) {
		if (note.kind !== 'slide') counts.set(onset(note), (counts.get(onset(note)) ?? 0) + 1);
	}
	return notes.map((note) => ({ ...note, simultaneous: note.kind !== 'slide' && (counts.get(onset(note)) ?? 0) > 1 }));
}

export function noteColor(note: DisplayNote): string {
	if (note.break) return '#ff9a35';
	if (note.simultaneous) return '#ffdb4d';
	if (note.kind === 'slide' || note.kind === 'star') return '#57dfff';
	if (note.kind.startsWith('touch')) return '#75edb0';
	return '#ff68b7';
}
