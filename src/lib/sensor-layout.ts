// Traced from the supplied official skin: circle center (960, 534), radius 482px.
// Coordinates below are relative to that center; only the display scale is normalized.
export const sensorScale = 254 / 482;
export const sensorOutlines = {
	B: [[60, -279], [156, -240], [156, -164], [129, -137], [57, -137], [8, -188], [8, -225]],
	E: [[0, -380], [72, -308], [0, -236], [-72, -308]]
} satisfies Record<string, number[][]>;

// The inner edge of an A sensor, from its border with D(n) round to D(n+1); both ends sit on the skin's rim (r 482).
export const aSensorEdge = [[70, -477], [56, -336], [84, -308], [156, -280], [204, -280], [287, -387]];

export function sensorPoint(x: number, y: number, index: number) {
	const angle = (index - 1) * Math.PI / 4;
	return {
		x: 300 + (x * Math.cos(angle) - y * Math.sin(angle)) * sensorScale,
		y: 300 + (x * Math.sin(angle) + y * Math.cos(angle)) * sensorScale
	};
}

export function sensorCenter(family: 'B' | 'E', index: number) {
	return family === 'B' ? sensorPoint(85, -205, index) : sensorPoint(0, -308, index);
}

export function sensorPolygon(family: 'B' | 'E', index: number) {
	return sensorOutlines[family].map(([x, y]) => sensorPoint(x, y, index));
}

// A sensors run out past the rim, so the edge is closed by an arc beyond it; star paths ending on a button stay inside.
export function aSensorPolygon(index: number) {
	const [last, first] = [aSensorEdge.at(-1)!, aSensorEdge[0]];
	const from = Math.atan2(last[1], last[0]);
	const to = Math.atan2(first[1], first[0]);
	const arc = Array.from({ length: 9 }, (_, i) => {
		const angle = from + (to - from) * i / 8;
		return [560 * Math.cos(angle), 560 * Math.sin(angle)];
	});
	return [...aSensorEdge, ...arc].map(([x, y]) => sensorPoint(x, y, index));
}
