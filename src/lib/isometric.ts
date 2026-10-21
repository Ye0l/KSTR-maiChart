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
