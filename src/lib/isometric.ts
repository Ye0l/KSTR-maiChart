import { clamp, distance, trace, type Point } from './geometry.ts';

const horizontal = .64;
const vertical = horizontal / Math.sqrt(3);
const originY = 540 - 600 * vertical;
// The front rim must also start above the viewport, not just the back of the tilted plane.
export const dropDistance = (sceneHeight = 720) => sceneHeight - 180 + 254 * Math.SQRT2 * vertical + 24;
export const planeTransform = (height = 0, sceneHeight = 720) => `matrix(${horizontal} ${vertical} ${-horizontal} ${vertical} 300 ${originY + (sceneHeight - 720) - height})`;
export const fallHeight = (at: number, time: number, approach: number, sceneHeight = 720) => Math.max(0, (at - time) / approach * dropDistance(sceneHeight));
export const depthOpacity = (point: Point) => point.x + point.y < 600 ? .45 : 1;

export function project(point: Point, height = 0, sceneHeight = 720): Point {
	return { x: 300 + horizontal * (point.x - point.y), y: originY + (sceneHeight - 720) + vertical * (point.x + point.y) - height };
}

// Lift the same arc-length interpolation used by the game view onto the time axis.
export function projectSlide(points: Point[], start: number, duration: number, time: number, approach: number, sceneHeight = 720) {
	const progress = duration > 0 ? clamp((time - start) / duration) : Number(time >= start);
	const rest = trace(points, progress).rest;
	const lengths = rest.slice(1).map((point, index) => distance(rest[index], point));
	const total = lengths.reduce((sum, value) => sum + value, 0);
	let travelled = 0;
	return rest.map((point, index) => {
		if (index > 0) travelled += lengths[index - 1];
		const at = start + duration * (progress + (1 - progress) * (total ? travelled / total : 0));
		return project(point, fallHeight(at, time, approach, sceneHeight), sceneHeight);
	});
}

// Beat onsets in (from, to]; each BPM section restarts its grid at the change, as the chart does.
export function beatsBetween(tempo: { time: number; bpm: number }[], from: number, to: number) {
	const beats: { time: number; downbeat: boolean }[] = [];
	tempo.forEach(({ time: start, bpm }, index) => {
		const end = Math.min(to, tempo[index + 1]?.time ?? Infinity);
		const beat = 60 / bpm;
		for (let n = Math.max(0, Math.floor((from - start) / beat)); start + n * beat <= end; n++) {
			const at = start + n * beat;
			if (at > from && at < (tempo[index + 1]?.time ?? Infinity)) beats.push({ time: at, downbeat: n % 4 === 0 });
		}
	});
	return beats;
}

// Arc pieces spanning one button sector (±45°) on each side of a point, weighted 1 at the point and 0 at the neighbours.
const sectorArcs = new Map<string, { d: string; weight: number }[]>();
export function sectorArc(point: Point, pieces = 12) {
	const key = `${point.x},${point.y},${pieces}`;
	const cached = sectorArcs.get(key);
	if (cached) return cached;
	const angle = Math.atan2(point.y - 300, point.x - 300);
	const at = (theta: number) => `${300 + 254 * Math.cos(theta)},${300 + 254 * Math.sin(theta)}`;
	const arcs = Array.from({ length: pieces }, (_, i) => {
		const a = angle + (i / pieces * 2 - 1) * Math.PI / 4;
		const b = angle + ((i + 1) / pieces * 2 - 1) * Math.PI / 4;
		return { d: `M${at(a)} A254,254 0 0 1 ${at(b)}`, weight: 1 - Math.abs((i + .5) / pieces * 2 - 1) };
	});
	sectorArcs.set(key, arcs);
	return arcs;
}
