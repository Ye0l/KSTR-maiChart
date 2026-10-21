import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseChart, readMaidata } from './simai.ts';
import { distance, position, slidePath, trace } from './geometry.ts';
import { sensorPolygon } from './sensor-layout.ts';
import { markSimultaneous, noteColor } from './presentation.ts';
import { pressMarks, pressMoments } from './press.ts';
import { beatsBetween, dropDistance, fallHeight, project, projectSlide, sectorArc, sectorSpan, timeOpacity } from './isometric.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('tempo records BPM changes and the beat grid restarts at each change', () => {
	const chart = parseChart('(120){4}1,(120)2,(60)3,4,E', 120, .5);
	assert.deepEqual(chart.tempo, [{ time: .5, bpm: 120 }, { time: 1.5, bpm: 60 }]);
	assert.deepEqual(beatsBetween(chart.tempo, .5, 3.5).map(beat => beat.time), [1, 1.5, 2.5, 3.5]);
	assert.deepEqual(beatsBetween(chart.tempo, 0, 2).filter(beat => beat.downbeat).map(beat => beat.time), [.5, 1.5]);
});

test('sector emphasis peaks at the note and fades out short of the neighbouring buttons', () => {
	const pieces = sectorArc(position('3'));
	assert.equal(pieces.length, 12);
	assert.ok(pieces[5].weight > .9 && pieces[6].weight > .9);
	assert.ok(pieces[0].weight < .1 && pieces[11].weight < .1);
	const ends = (d: string) => d.match(/-?[\d.]+,-?[\d.]+/g)!.map(pair => pair.split(',').map(Number));
	const [start] = ends(pieces[0].d);
	const end = ends(pieces[11].d).at(-1)!;
	for (const [x, y] of [start, end]) close(Math.hypot(x - 300, y - 300), 254);
	const angle = Math.atan2(position('3').y - 300, position('3').x - 300);
	assert.ok(sectorSpan < Math.PI / 4, 'sector stops before the neighbouring buttons');
	assert.ok(Math.abs(Math.atan2(start[1] - 300, start[0] - 300) - (angle - sectorSpan)) < 1e-3, 'sector starts toward button 2');
	assert.ok(Math.abs(Math.atan2(end[1] - 300, end[0] - 300) - (angle + sectorSpan)) < 1e-3, 'sector ends toward button 4');
});

test('isometric notes brighten as their hit nears, whatever lane they are in', () => {
	close(timeOpacity(2, 2), .35);
	close(timeOpacity(1, 2), .675);
	close(timeOpacity(0, 2), 1);
	close(timeOpacity(-1, 2), 1);
	close(timeOpacity(5, 2), .35);
});

test('isometric spawn starts above the top at every canvas height and sensor position', () => {
	for (const sceneHeight of [360, 720, 1600]) {
		const positions = ['C', ...['', 'A', 'B', 'D', 'E'].flatMap(prefix => Array.from({ length: 8 }, (_, i) => `${prefix}${i + 1}`))];
		for (const id of positions) {
			const target = position(id);
			const lift = fallHeight(1, 0, 1, sceneHeight);
			assert.ok(project(target, lift, sceneHeight).y < -20, `${id} must not pop in halfway down the canvas`);
			assert.deepEqual(project(target, fallHeight(1, 1, 1, sceneHeight), sceneHeight), project(target, 0, sceneHeight));
		}
		close(project({ x: 300, y: 300 }, 0, sceneHeight).y, sceneHeight - 180);
	}
	assert.ok(dropDistance(1600) > dropDistance(720));
});

test('isometric notes descend vertically onto the same tilted plane', () => {
	const target = position('1');
	assert.deepEqual(project({ x: 300, y: 300 }), { x: 300, y: 540 });
	const high = project(target, fallHeight(1, 0, 1));
	const low = project(target, fallHeight(1, .5, 1));
	close(high.x, low.x);
	close(low.y - high.y, dropDistance() / 2);
	assert.deepEqual(project(target, fallHeight(1, 1, 1)), project(target));
	assert.equal(fallHeight(1, 2, 1), 0);
	close(fallHeight(.25, 0, 2 / 6), dropDistance() * .75);
});

test('isometric SLIDE height follows path distance and the tracing interval', () => {
	const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }];
	const before = projectSlide(points, 10, 4, 10, 2);
	assert.deepEqual(before[0], project(points[0]));
	assert.deepEqual(before[1], project(points[1], dropDistance() / 2));
	assert.deepEqual(before[2], project(points[2], dropDistance() * 2));
	const during = projectSlide(points, 10, 4, 12, 2);
	assert.deepEqual(during[0], project({ x: 10, y: 10 }));
	assert.deepEqual(during.at(-1), project(points[2], dropDistance()));
	assert.deepEqual(projectSlide(points, 10, 4, 14, 2), [project(points[2])]);
	assert.ok(projectSlide(points, 10, 0, 10, 2).every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
	for (const shape of ['-', '^', '<', '>', 'v', 'p', 'q', 'pp', 'qq', 's', 'z', 'w', 'V']) {
		for (const path of slidePath({ shape, start: 1, end: 5, middle: 3 })) {
			assert.ok(projectSlide(path, .5, 1, .75, 2 / 6).every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), shape);
		}
	}
});

test('press moments cover TAP, HOLD start, star and SLIDE end but not TOUCH', () => {
	const chart = parseChart('(120){4}1,2h[4:1],3-5[4:1],B1/C,E', 120, 0);
	const presses = pressMoments(markSimultaneous(chart.notes));
	assert.deepEqual(presses.map(press => [press.time, press.button]), [[0, '1'], [.5, '2'], [1, '3'], [2, '5']]);
});

test('a SLIDE with per-segment timings is judged only where the chain finishes', () => {
	const chart = parseChart('(120){4}1-3[4:1]-5[4:1],E', 120, 0);
	assert.deepEqual(pressMoments(markSimultaneous(chart.notes)).map(press => [press.time, press.button]), [[0, '1'], [1.5, '5']]);
});

test('press highlights keep the newest press per button and fade over the chosen beats', () => {
	const tempo = [{ time: 0, bpm: 120 }];
	const presses = [{ time: 0, button: '1', color: 'a' }, { time: 1, button: '1', color: 'b' }, { time: 1, button: '2', color: 'c' }];
	assert.deepEqual(pressMarks(presses, 1, tempo, -1), []);
	assert.deepEqual(pressMarks(presses, 1, tempo, 4).map(mark => [mark.button, mark.color, mark.strength]), [['1', 'b', 1], ['2', 'c', 1]]);
	close(pressMarks(presses, 1.5, tempo, 4)[0].strength, .75);
	assert.deepEqual(pressMarks(presses, 3.1, tempo, 4), []);
	assert.deepEqual(pressMarks(presses, .99, tempo, 4).map(mark => mark.button), ['1'], 'future presses are not shown');
	assert.equal(pressMarks(presses, 1.1, tempo, 0).length, 2, 'zero beats still flashes on the hit');
	assert.deepEqual(pressMarks(presses, 1.2, tempo, 0), []);
});

test('counting notes keeps the last press moments, a chord counting once, however far apart they are', () => {
	const tempo = [{ time: 0, bpm: 120 }];
	const presses = [
		{ time: 0, button: '1', color: 'a' }, { time: 10, button: '2', color: 'b' }, { time: 10, button: '3', color: 'b' },
		{ time: 10.1, button: '4', color: 'c' }, { time: 10.2, button: '1', color: 'd' }
	];
	const marks = (time: number, trail: number) => pressMarks(presses, time, tempo, trail, 'notes').map(mark => [mark.button, mark.color, mark.strength]).sort();
	assert.deepEqual(marks(20, 4), [['1', 'd', 1], ['2', 'b', .5], ['3', 'b', .5], ['4', 'c', .75]], 'old presses stay until newer notes push them out');
	assert.deepEqual(marks(20, 2), [['1', 'd', 1], ['4', 'c', .5]]);
	assert.deepEqual(marks(5, 4), [['1', 'a', 1]]);
	const flash = marks(10.25, 0);
	assert.deepEqual(flash.map(([button]) => button), ['1'], 'zero notes only flashes the latest press');
	close(Number(flash[0][2]), 1 - .05 / .18);
	assert.deepEqual(marks(20, 0), []);
	assert.deepEqual(pressMarks(presses, 20, tempo, -1, 'notes'), []);
});

test('TAP/HOLD are pink, input chords yellow, and BREAK takes priority', () => {
	const notes = markSimultaneous(parseChart('(120){4}1,2h[4:1],3/4h[4:1],5b/6h[4:1],7bh[4:1]/8,E').notes);
	assert.deepEqual(notes.map(noteColor), ['#ff68b7', '#ff68b7', '#ffdb4d', '#ffdb4d', '#ff9a35', '#ffdb4d', '#ff9a35', '#ffdb4d']);
});

test('only input onsets count: no yellow from a slide track or an ongoing hold', () => {
	const notes = markSimultaneous(parseChart('(120){4}1-5[4:1],2h[1:1],3,4/5-1[4:1],E').notes);
	assert.equal(notes[0].kind, 'star');
	assert.equal(noteColor(notes[0]), '#57dfff');
	assert.equal(noteColor(notes[1]), '#57dfff');
	assert.equal(noteColor(notes[2]), '#ff68b7');
	assert.equal(noteColor(notes[3]), '#ff68b7');
	assert.equal(noteColor(notes[4]), '#ffdb4d');
	assert.equal(noteColor(notes[5]), '#ffdb4d');
	assert.equal(noteColor(notes[6]), '#57dfff');
});

test('official skin proportions and touch anchors share the same geometry', () => {
	assert.ok(Math.abs(position('E1').y - 137.693) < .001);
	assert.ok(Math.abs(position('B1').x - 344.793) < .001);
	assert.ok(Math.abs(position('B1').y - 191.971) < .001);
	assert.ok(Math.abs(sensorPolygon('E', 1)[0].y - 99.751) < .001);
	assert.equal(sensorPolygon('B', 1).length, 7);
	for (const family of ['B', 'E'] as const) {
		for (let index = 1; index <= 8; index++) {
			const polygon = sensorPolygon(family, index);
			const center = position(`${family}${index}`);
			for (let i = 0; i < polygon.length; i++) {
				const a = polygon[i];
				const b = polygon[(i + 1) % polygon.length];
				assert.ok((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x) > 0, 'touch anchor stays inside its polygon');
			}
			close(distance(center, { x: 300, y: 300 }), distance(position(`${family}1`), { x: 300, y: 300 }));
		}
	}
	assert.deepEqual(position('1'), { x: 397.2, y: 65.33 });
});
test('metadata, BPM changes, subdivision, simultaneous notes and rests', () => {
	const fields = readMaidata('\uFEFF&title=Test\n&inote_5=\n(120){4}1/8,,(240){8}2,\nE\n');
	assert.equal(fields.title, 'Test');
	const chart = parseChart(fields.inote_5);
	assert.equal(chart.warnings.length, 0);
	assert.deepEqual(chart.notes.map((note) => note.position), ['1', '8', '2']);
	close(chart.notes[2].time, 1);
});

test('hold, EX/BREAK, touch hold, offset, multi-slide and slide waiting time', () => {
	const chart = parseChart('(120){4}1bxh[4:3]/C1fh[2:1],1s5[4:1]*z5[4:1],E', 120, .2);
	assert.deepEqual(chart.warnings, []);
	assert.equal(chart.notes[0].ex, true);
	assert.equal(chart.notes[0].break, true);
	close(chart.notes[0].duration, 1.5);
	assert.equal(chart.notes[1].kind, 'touchHold');
	assert.equal(chart.notes[1].firework, true);
	const slides = chart.notes.filter((note) => note.kind === 'slide');
	assert.equal(slides.length, 2);
	close(slides[0].time, .7);
	close(slides[0].wait, .5);
	close(slides[0].duration, .5);
});

test('explicit seconds, local BPM and chained slides', () => {
	const chart = parseChart('(120){4}1h[#1.2],1-5[0.2##1.3],1-5[240#4:1],1-5-1[4:2],1-5[4:1]-1[4:1],E');
	assert.deepEqual(chart.warnings, []);
	close(chart.notes[0].duration, 1.2);
	const slides = chart.notes.filter((note) => note.kind === 'slide');
	close(slides[0].wait, .2);
	close(slides[0].duration, 1.3);
	close(slides[1].wait, .25);
	assert.equal(slides[2].segments.length, 2);
	close(slides[4].time, slides[3].time + slides[3].wait + slides[3].duration);
	close(slides[4].wait, 0);
});

test('bad notation is reported, not silently converted into a different note', () => {
	const chart = parseChart('(120){4}9,1h[0:1],1-5,1h[#],2,E');
	assert.equal(chart.warnings.length, 4);
	assert.equal(chart.notes.length, 1);
	close(chart.notes[0].time, 2);
});

test('zero-length holds in converted charts remain visible as instant holds', () => {
	const chart = parseChart('(120){4}1h[1:0]/C1h[#0],E');
	assert.deepEqual(chart.warnings, []);
	assert.equal(chart.notes.length, 2);
	assert.ok(chart.notes.every((note) => note.duration === 0));
});
test('all slide families have finite geometry and correct anchors', () => {
	for (const shape of ['-', '^', '<', '>', 'v', 'p', 'q', 'pp', 'qq', 's', 'z', 'w', 'V']) {
		const end = ['^', 'v'].includes(shape) ? 4 : 5;
		const paths = slidePath({ shape, start: 1, end, middle: 3 });
		assert.equal(paths.length, shape === 'w' ? 3 : 1);
		for (const points of paths) {
			assert.deepEqual(points[0], position('1'));
			assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
			assert.deepEqual(trace(points, 1).point, points.at(-1));
		}
		if (shape !== 'w') close(distance(paths[0].at(-1)!, position(String(end))), 0);
	}
	assert.deepEqual(position('C1'), position('C2'));
});

test('real Connect DX charts parse without unsupported notation', async () => {
	const fields = readMaidata(await readFile('Maichart-Converts/POPSアニメ/10021_コネクト_DX/maidata.txt', 'utf8'));
	for (const [key, value] of Object.entries(fields)) {
		if (!key.startsWith('inote_')) continue;
		const chart = parseChart(value, Number(fields.wholebpm));
		assert.deepEqual(chart.warnings, [], key);
		assert.ok(chart.notes.length > 0);
		assert.ok(chart.duration > 100);
	}
});

test('repository charts never produce non-finite timing or geometry', async (context) => {
	const entries = await readdir('Maichart-Converts', { recursive: true, withFileTypes: true });
	let charts = 0;
	let warnings = 0;
	const unsupported = new Set<string>();
	for (const entry of entries) {
		if (!entry.isFile() || entry.name !== 'maidata.txt') continue;
		const fields = readMaidata(await readFile(resolve(entry.parentPath, entry.name), 'utf8'));
		for (const [key, value] of Object.entries(fields)) {
			if (!key.startsWith('inote_') || !value) continue;
			const chart = parseChart(value, Number(fields.wholebpm), Number(fields.first ?? 0));
			charts++;
			warnings += chart.warnings.length;
			for (const warning of chart.warnings) unsupported.add(warning);
			assert.ok(Number.isFinite(chart.duration));
			for (const note of chart.notes) {
				assert.ok([note.time, note.wait, note.duration].every(Number.isFinite));
				position(note.position);
				for (const segment of note.segments) {
					assert.ok(slidePath(segment).flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
				}
			}
		}
	}
	assert.ok(charts > 0);
	context.diagnostic(`${charts} difficulty charts scanned; ${warnings} unsupported-notation warnings`);
	if (unsupported.size) context.diagnostic([...unsupported].slice(0, 12).join('\n'));
});
