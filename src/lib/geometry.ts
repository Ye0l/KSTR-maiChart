import spatial from '../../simai_spatial_reference/spatial_reference.json' with { type: 'json' };
import type { Segment } from './simai.ts';
import { sensorCenter } from './sensor-layout.ts';

export type Point = { x: number; y: number };
const center = { x: 300, y: 300 };
const buttons = spatial.buttonPositions as Record<string, Point>;
const sensors = spatial.sensorPositions as Record<string, Point | { aliasOf: string }>;
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function position(id: string): Point {
	if (buttons[id]) return buttons[id];
	const measured = /^([BE])([1-8])$/.exec(id);
	if (measured) return sensorCenter(measured[1] as 'B' | 'E', Number(measured[2]));
	const sensor = sensors[id];
	if (!sensor) throw new Error(`알 수 없는 위치: ${id}`);
	return 'aliasOf' in sensor ? position(sensor.aliasOf) : sensor;
}

function arc(origin: Point, radius: number, start: number, angle: number) {
	return Array.from({ length: 65 }, (_, i) => ({
		x: origin.x + radius * Math.cos(start + angle * i / 64),
		y: origin.y + radius * Math.sin(start + angle * i / 64)
	}));
}

// shortcut: curves are visual approximations, replace with verified geometry for game-exact playback.
export function slidePath(segment: Segment): Point[][] {
	const a = position(String(segment.start));
	const b = position(String(segment.end));
	const angle = Math.atan2(a.y - 300, a.x - 300);
	const delta = (segment.end - segment.start + 8) % 8;
	const shape = segment.shape;
	if (shape === '-') return [[a, b]];
	if (shape === 'v') return [[a, center, b]];
	if (shape === 'V') return [[a, position(String(segment.middle)), b]];
	if (['^', '<', '>'].includes(shape)) {
		let steps = delta > 4 ? delta - 8 : delta;
		if (shape !== '^') {
			const upper = [1, 2, 7, 8].includes(segment.start);
			const clockwise = shape === '>' ? upper : !upper;
			steps = clockwise ? (delta || 8) : -((8 - delta) || 8);
		}
		const points = arc(center, distance(a, center), angle, steps * Math.PI / 4);
		points[0] = a;
		points[points.length - 1] = b;
		return [points];
	}
	if (shape === 'w') {
		return [-1, 0, 1].map((offset) => [a, position(String((segment.end - 1 + offset + 8) % 8 + 1))]);
	}
	if (shape === 's' || shape === 'z') {
		const sign = shape === 's' ? 1 : -1;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return [[a, { x: a.x + dx / 3 - dy * .23 * sign, y: a.y + dy / 3 + dx * .23 * sign },
			{ x: a.x + dx * 2 / 3 + dy * .23 * sign, y: a.y + dy * 2 / 3 - dx * .23 * sign }, b]];
	}
	const sign = shape.startsWith('p') ? -1 : 1;
	const doubled = shape.length === 2;
	const origin = doubled ? { x: 300 - Math.sin(angle) * 85 * sign, y: 300 + Math.cos(angle) * 85 * sign } : center;
	const radius = doubled ? 145 : 105;
	const begin = Math.atan2(a.y - origin.y, a.x - origin.x) + sign * .7;
	const finish = Math.atan2(b.y - origin.y, b.x - origin.x) - sign * .7;
	let sweep = ((sign * (finish - begin) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	if (sweep < Math.PI) sweep += 2 * Math.PI;
	return [[a, ...arc(origin, radius, begin, sign * sweep), b]];
}

export function trace(points: Point[], progress: number) {
	if (progress >= 1) return { point: points.at(-1)!, rest: [points.at(-1)!] };
	const lengths = points.slice(1).map((point, i) => distance(points[i], point));
	let remaining = lengths.reduce((sum, value) => sum + value, 0) * clamp(progress);
	for (let i = 0; i < lengths.length; i++) {
		if (remaining <= lengths[i] && lengths[i] > 0) {
			const point = mix(points[i], points[i + 1], remaining / lengths[i]);
			return { point, rest: [point, ...points.slice(i + 1)] };
		}
		remaining -= lengths[i];
	}
	return { point: points.at(-1)!, rest: [points.at(-1)!] };
}

export const pathData = (points: Point[]) => points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
export const star = (point: Point, radius = 17) => Array.from({ length: 10 }, (_, i) => {
	const angle = -Math.PI / 2 + i * Math.PI / 5;
	const r = i % 2 ? radius * .45 : radius;
	return `${point.x + Math.cos(angle) * r},${point.y + Math.sin(angle) * r}`;
}).join(' ');

// Arrows sit at fixed arc-length spots so they stay put and vanish as the star passes them.
const chevronCache = new WeakMap<Point[], { at: number; x: number; y: number; angle: number }[]>();
export function chevrons(points: Point[], progress: number, spacing = 24) {
	let all = chevronCache.get(points);
	if (!all) chevronCache.set(points, all = placeChevrons(points, spacing));
	const consumed = clamp(progress);
	return all.filter((arrow) => arrow.at >= consumed);
}

function placeChevrons(points: Point[], spacing: number) {
	const lengths = points.slice(1).map((point, i) => distance(points[i], point));
	const total = lengths.reduce((sum, value) => sum + value, 0);
	const count = Math.max(1, Math.floor(total / spacing));
	const arrows: { at: number; x: number; y: number; angle: number }[] = [];
	let segment = 0;
	let before = 0;
	for (let n = 0; n < count; n++) {
		const at = total * (n + .5) / count;
		while (segment < lengths.length - 1 && before + lengths[segment] < at) before += lengths[segment++];
		const a = points[segment];
		const b = points[segment + 1];
		const point = mix(a, b, lengths[segment] ? (at - before) / lengths[segment] : 0);
		arrows.push({ at: at / total, ...point, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI });
	}
	return arrows;
}
