// Run with a dev server running: node --test tests/layout.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseChart, readMaidata } from '../src/lib/simai.ts';
import { position } from '../src/lib/geometry.ts';
import { markSimultaneous } from '../src/lib/presentation.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('collapsible layout, mobile overlay, tabs and playback', { timeout: 30000 }, async () => {
	const profile = await mkdtemp(join(tmpdir(), 'maichart-layout-'));
	// The window must cover the emulated 1280x800 viewport: Chrome drops synthetic input outside the real window.
	const browser = spawn(process.env.CHROMIUM ?? 'chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--window-size=1280,800', `--user-data-dir=${profile}`, process.env.VIEWER_URL ?? 'http://localhost:5173/']);
	let socket;
	try {
		const endpoint = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 10000);
			let log = '';
			browser.once('error', (error) => { clearTimeout(timer); reject(error); });
			browser.stderr.on('data', (chunk) => {
				log += chunk;
				const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
				if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
			});
		});
		const tabs = await fetch(`http://${endpoint.host}/json`).then((response) => response.json());
		socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
		await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
		let id = 0;
		const pending = new Map();
		const exceptions = [];
		socket.addEventListener('message', ({ data }) => {
			const message = JSON.parse(data);
			if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
			if (!message.id) return;
			const job = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) job.reject(message.error); else job.resolve(message.result);
		});
		const cdp = (method, params = {}) => new Promise((resolve, reject) => {
			const next = ++id;
			pending.set(next, { resolve, reject });
			socket.send(JSON.stringify({ id: next, method, params }));
		});
		const evaluate = async (expression) => {
			const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
			assert.equal(result.exceptionDetails, undefined);
			return result.result.value;
		};
		const click = async (selector) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(50); };
		const showViews = async (...ids) => {
			await evaluate(`(() => { document.querySelectorAll('.view-switch button[aria-pressed="true"]').forEach(button => button.click()); for (const id of ${JSON.stringify(ids)}) document.getElementById('view-' + id).click(); })()`);
			await sleep(80);
		};
		const bounds = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
		const checkFlatText = async () => {
			const metrics = await evaluate(`(() => { const svg = document.querySelector('svg[data-view="flat"]'); const m = svg.getScreenCTM(); return { sx: Math.hypot(m.a, m.b), sy: Math.hypot(m.c, m.d), font: parseFloat(getComputedStyle(svg.querySelector('.lane-label')).fontSize) * Math.hypot(m.a, m.b) }; })()`);
			assert.ok(Math.abs(metrics.sx - metrics.sy) < 1e-6, 'flat text scales uniformly');
			assert.ok(Math.abs(metrics.font - 16) < .1, 'flat lane labels stay readable across layouts');
		};
		const resize = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
		await cdp('Runtime.enable');
		await resize(1280, 800);
		for (let i = 0; i < 100 && !(await evaluate('!!document.querySelector("#pane-toggle")')); i++) await sleep(100);
		await sleep(800);
		assert.equal(await evaluate('!!document.querySelector("#pane-toggle")'), true, await evaluate('document.URL + document.body.innerText.slice(0, 800)'));
		const sensorIds = await evaluate('Array.from(document.querySelectorAll("svg [data-sensor]"), el => el.dataset.sensor).sort()');
		assert.deepEqual(sensorIds, ['C1', 'C2', ...['A', 'B', 'D', 'E'].flatMap(family => Array.from({ length: 8 }, (_, i) => `${family}${i + 1}`))].sort());
		assert.equal(await evaluate('document.querySelector("svg image")'), null, 'sensor layout uses vectors, not the reference image');
		assert.equal(await evaluate('document.querySelector("svg [data-sensor]").namespaceURI'), 'http://www.w3.org/2000/svg');
		for (const id of ['B1', 'B2', 'E1', 'E2']) {
			const label = await evaluate(`(() => { const el = document.querySelector('[data-sensor="${id}"] text'); return { x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')) }; })()`);
			assert.deepEqual(label, position(id), `${id} background and touch note anchor are aligned`);
		}
		const expanded = await bounds('section');
		await click('#pane-toggle');
		assert.ok((await bounds('section')).width > expanded.width, 'desktop panel releases space');
		await click('#pane-toggle');
		await click('#tab-info');
		assert.equal(await evaluate('document.querySelector("#panel-info").hidden'), false);
		await evaluate('document.querySelector("#tab-info").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))');
		assert.equal(await evaluate('document.activeElement.id'), 'tab-charts');
		const setValue = async (selector, value) => {
			await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
			await sleep(30);
		};
		const selectedSpeeds = (id = 'game') => evaluate(`[Number(document.getElementById('${id}-note-speed').value), Number(document.getElementById('${id}-touch-speed').value)]`);
		const reload = async () => { await cdp('Page.reload'); await sleep(1000); };
		assert.deepEqual(await selectedSpeeds(), [6, 6], 'game speeds default to 6');
		await showViews('game', 'flat', 'isometric');
		for (const id of ['flat', 'isometric']) assert.deepEqual(await selectedSpeeds(id), [2, 2], 'flat and isometric speeds default to 2');
		await showViews('game');
		await setValue('#game-note-speed', 6.25);
		await setValue('#game-touch-speed', 7.5);
		assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("maichart.speeds"))'), { game: { note: 6.25, touch: 7.5 }, flat: { note: 2, touch: 2 }, isometric: { note: 2, touch: 2 } });
		await reload();
		assert.deepEqual(await selectedSpeeds(), [6.25, 7.5], 'saved speeds survive a reload');
		await showViews('game', 'flat', 'isometric');
		await setValue('#flat-note-speed', 3);
		await setValue('#flat-touch-speed', 4);
		await setValue('#isometric-note-speed', 8);
		await setValue('#isometric-touch-speed', 9);
		await setValue('#playback-rate', 1.5);
		assert.deepEqual(await selectedSpeeds(), [6.25, 7.5]);
		assert.equal(await evaluate('document.querySelectorAll("#playback-rate").length'), 1, 'playback rate stays shared');
		await showViews('flat');
		assert.equal(await evaluate('document.querySelector("#playback-rate").value'), '1.5', 'view toggles keep the shared playback rate');
		await reload();
		await showViews('game', 'flat', 'isometric');
		assert.deepEqual(await selectedSpeeds(), [6.25, 7.5]);
		assert.deepEqual(await selectedSpeeds('flat'), [3, 4]);
		assert.deepEqual(await selectedSpeeds('isometric'), [8, 9]);
		await evaluate('localStorage.setItem("maichart.speeds", JSON.stringify({note: 5.25, touch: 6.75}))');
		await reload();
		await showViews('game', 'flat', 'isometric');
		for (const id of ['game', 'flat', 'isometric']) assert.deepEqual(await selectedSpeeds(id), [5.25, 6.75], 'old shared settings migrate to each view');
		for (const invalid of ['{"note":6.1,"touch":10.25}', '{']) {
			await evaluate(`localStorage.setItem('maichart.speeds', ${JSON.stringify(invalid)})`);
			await reload();
			assert.deepEqual(await selectedSpeeds(), [6, 6], 'invalid storage falls back to defaults');
		}
		for (const selector of ['#game-note-speed', '#game-touch-speed']) {
			assert.deepEqual(await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options, option => Number(option.value))`), Array.from({ length: 37 }, (_, i) => 1 + i * .25));
		}
		const fields = readMaidata(await readFile('Maichart-Converts/POPSアニメ/10021_コネクト_DX/maidata.txt', 'utf8'));
		const notes = parseChart(fields.inote_5, Number(fields.wholebpm)).notes;
		const firstTap = notes.find((note) => note.kind === 'tap');
		await setValue('#game-note-speed', 4);
		await setValue('.seek', firstTap.time - .25);
		const tapX = await evaluate('Number(document.querySelector(\'svg circle[stroke="#ff68b7"]\').getAttribute("cx"))');
		const tapTime = await evaluate('Number(document.querySelector(".seek").value)');
		const tapProgress = 1 - (firstTap.time - tapTime) / .5;
		assert.ok(Math.abs(tapX - (300 + (position(firstTap.position).x - 300) * (.18 + tapProgress * .82))) < 1e-6, '4× notes approach for 500ms');
		await setValue('#game-touch-speed', 10);
		assert.equal(await evaluate('Number(document.querySelector(\'svg circle[stroke="#ff68b7"]\').getAttribute("cx"))'), tapX, 'touch speed does not affect button notes');
		await setValue('#game-note-speed', 10);
		assert.equal(await evaluate('document.querySelectorAll(\'svg circle[stroke="#ff68b7"]\').length'), 0, '10× notes are hidden 250ms before hit');
		const firstTouch = notes.find((note) => note.kind.startsWith('touch'));
		await setValue('#game-touch-speed', 4);
		await setValue('.seek', firstTouch.time - .25);
		const touchTime = await evaluate('Number(document.querySelector(".seek").value)');
		const touchRadius = await evaluate('Number(document.querySelector(\'svg circle[stroke="#75edb0"]\').getAttribute("r"))');
		assert.ok(Math.abs(touchRadius - (34 - (1 - (firstTouch.time - touchTime) / .5) * 17)) < 1e-6, '4× touches approach for 500ms');
		await setValue('#game-note-speed', 1);
		assert.equal(await evaluate('Number(document.querySelector(\'svg circle[stroke="#75edb0"]\').getAttribute("r"))'), touchRadius, 'button speed does not affect touches');
		await setValue('#game-touch-speed', 10);
		assert.equal(await evaluate('document.querySelectorAll(\'svg circle[stroke="#75edb0"]\').length'), 0, '10× touches are hidden 250ms before hit');
		await setValue('#game-touch-speed', 1);
		await showViews('flat');
		await setValue('#flat-note-speed', 1);
		await setValue('#flat-touch-speed', 1);
		assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-lane]"), el => Number(el.textContent))'), [1, 2, 3, 4, 5, 6, 7, 8]);
		assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-lane]")).sort((a, b) => a.getAttribute("x") - b.getAttribute("x")).map(el => Number(el.textContent))'), [8, 7, 6, 5, 4, 3, 2, 1], 'flat lanes run 8 to 1 from the left');
		await checkFlatText();
		const noteSelector = (note) => `svg [data-kind="${note.kind}"][data-time="${note.time}"][data-position="${note.position}"]`;
		const attr = (selector, name) => evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute(${JSON.stringify(name)})`);
		const checkIsoSpawn = async () => {
			const frame = await evaluate(`(() => { const svg = document.querySelector('svg[data-view="isometric"]'); const r = svg.getBoundingClientRect(); const m = svg.querySelector('[data-plane="isometric"]').transform.baseVal.consolidate().matrix; return { height: svg.viewBox.baseVal.height, expected: Math.max(360, 600 * r.height / r.width), floor: m.b * 300 + m.d * 300 + m.f }; })()`);
			assert.ok(Math.abs(frame.height - frame.expected) < .01, 'isometric canvas follows its actual aspect ratio');
			assert.ok(Math.abs(frame.floor - (frame.height - 180)) < .01, 'isometric board stays at the bottom');
			await setValue('.seek', Math.ceil((firstTap.time - 2) * 100) / 100);
			const head = noteSelector(firstTap).replace('svg ', 'svg[data-view="isometric"] ') + ' .note-disc';
			const spawnY = await evaluate(`(() => { const disc = document.querySelector(${JSON.stringify(head)}); const m = disc.parentElement.transform.baseVal.consolidate().matrix; return m.b * Number(disc.getAttribute('cx')) + m.d * Number(disc.getAttribute('cy')) + m.f; })()`);
			assert.ok(spawnY < 10, 'notes enter above the viewport rather than appearing in the middle');
			return frame.height;
		};
		await setValue('.seek', firstTap.time - .4);
		const beforeY = Number(await attr(`${noteSelector(firstTap)} .note-head`, 'y'));
		await setValue('.seek', firstTap.time - .2);
		assert.ok(Number(await attr(`${noteSelector(firstTap)} .note-head`, 'y')) > beforeY, 'flat notes fall downward');
		assert.equal(Number(await attr(`${noteSelector(firstTap)} .note-head`, 'x')), 40 + (8.5 - Number(firstTap.position)) * 65 - 25);
		const displayNotes = markSimultaneous(notes);
		const examples = [
			[displayNotes.find(note => note.kind === 'hold' && !note.simultaneous && !note.break), '#ff68b7'],
			[displayNotes.find(note => note.kind === 'tap' && note.simultaneous && !note.break), '#ffdb4d'],
			[displayNotes.find(note => note.kind === 'tap' && note.break), '#ff9a35']
		];
		for (const [note, expected] of examples) {
			await setValue('.seek', note.time - .1);
			assert.equal(await attr(`${noteSelector(note)} .note-head`, 'fill'), expected);
			if (note.kind === 'hold') assert.ok(Number(await attr(`${noteSelector(note)} .hold-body`, 'height')) > 0);
			const unchangedTime = await evaluate('document.querySelector(".seek").value');
			await showViews('game');
			assert.equal(await evaluate('document.querySelector(".seek").value'), unchangedTime, 'switching views preserves the timeline');
			assert.equal(await attr(`${noteSelector(note)} circle`, 'stroke'), expected, 'both views share note colors');
			await showViews('flat');
		}
		const slide = notes.find(note => note.kind === 'slide');
		await setValue('.seek', slide.time + slide.wait + slide.duration / 2);
		const connection = (await attr(`${noteSelector(slide)} polyline`, 'points')).split(' ').map(point => point.split(',').map(Number));
		assert.equal(connection.length, 3);
		assert.equal(connection[0][0], 40 + (8.5 - slide.segments[0].start) * 65);
		assert.equal(connection[2][0], 40 + (8.5 - slide.segments.at(-1).end) * 65);
		assert.equal(await evaluate('document.querySelector("svg").outerHTML.includes("NaN")'), false);
		const isoTime = await evaluate('document.querySelector(".seek").value');
		await showViews('isometric');
		await setValue('#isometric-note-speed', 1);
		await setValue('#isometric-touch-speed', 1);
		assert.equal(await evaluate('document.querySelectorAll("svg[data-view]").length'), 1);
		assert.equal(await evaluate('document.querySelector(".seek").value'), isoTime);
		const singleIsoHeight = await checkIsoSpawn();
		await setValue('.seek', firstTap.time - .4);
		const high = Number(await attr(noteSelector(firstTap), 'data-height'));
		const farOpacity = Number(await attr(noteSelector(firstTap), 'opacity'));
		await setValue('.seek', firstTap.time - .2);
		assert.ok(Number(await attr(noteSelector(firstTap), 'data-height')) < high, 'isometric notes descend vertically');
		const nearOpacity = Number(await attr(noteSelector(firstTap), 'opacity'));
		assert.ok(farOpacity < nearOpacity && nearOpacity < 1, 'notes brighten as their hit nears in the rendered scene');
		const lift = await attr(noteSelector(firstTap), 'data-height');
		const ring = `svg .timing-ring[data-height="${lift}"]`;
		assert.equal(await attr(ring, 'transform'), await attr(`${noteSelector(firstTap)} .note-plane`, 'transform'), 'full-circle guide follows the note plane');
		assert.equal(await attr(ring, 'r'), '254');
		assert.equal(await attr(ring, 'stroke'), await attr(`${noteSelector(firstTap)} .note-disc`, 'stroke'), 'guide matches the note color');
		const ringHeights = await evaluate('Array.from(document.querySelectorAll(".timing-ring"), el => el.dataset.height)');
		assert.equal(new Set(ringHeights).size, ringHeights.length, 'same-height guides do not overlap');
		const matrices = await evaluate(`(() => {
			const read = selector => { const m = document.querySelector(selector).transform.baseVal.consolidate().matrix; return [m.a, m.b, m.c, m.d, m.e, m.f]; };
			return [read('[data-plane="isometric"]'), read(${JSON.stringify(`${noteSelector(firstTap)} .note-plane`)})];
		})()`);
		assert.deepEqual(matrices[0].slice(0, 5), matrices[1].slice(0, 5), 'note discs remain parallel to the tilted board');
		assert.ok(matrices[1][5] < matrices[0][5]);
		for (const [note, expected] of examples) {
			await setValue('.seek', note.time - .1);
			assert.equal(await attr(`${noteSelector(note)} .note-disc`, 'stroke'), expected, 'isometric shares the same colors');
			const guideHeight = await attr(noteSelector(note), 'data-height');
			assert.equal(await attr(`svg .timing-ring[data-height="${guideHeight}"]`, 'stroke'), expected, 'guide uses pink/yellow/BREAK colors');
			if (note.kind === 'hold') assert.ok(Number(await attr(`${noteSelector(note)} .hold-body`, 'y2')) < Number(await attr(`${noteSelector(note)} .hold-body`, 'y1')));
		}
		await setValue('.seek', firstTouch.time - .1);
		assert.equal(Number(await attr(`${noteSelector(firstTouch)} .note-disc`, 'cx')), position(firstTouch.position).x, 'isometric touch uses the calibrated sensor position');
		const curve = notes.find(note => note.kind === 'slide' && note.segments.some(segment => ['p', 'q', 'pp', 'qq'].includes(segment.shape)));
		await setValue('.seek', curve.time + curve.wait + curve.duration / 2);
		assert.ok((await attr(`${noteSelector(curve)} .slide-ground`, 'd')).match(/[ML]/g).length > 3, 'isometric retains the curved spatial path');
		assert.ok((await attr(`${noteSelector(curve)} .slide-time`, 'd')).match(/[ML]/g).length > 2, 'isometric projects the remaining curve through time');
		assert.equal(await evaluate('document.querySelector("svg").outerHTML.includes("NaN")'), false);
		const splitTime = await evaluate('document.querySelector(".seek").value');
		await showViews('game', 'flat', 'isometric');
		assert.equal(await evaluate('document.querySelectorAll("svg[data-view]").length'), 3);
		assert.equal(await evaluate('document.querySelector(".seek").value'), splitTime, 'simultaneous view keeps the shared timeline');
		const gameBounds = await bounds('svg[data-view="game"]');
		const flatBounds = await bounds('svg[data-view="flat"]');
		assert.ok(gameBounds.width > 0 && flatBounds.width > 0);
		assert.ok(gameBounds.x + gameBounds.width <= flatBounds.x, 'desktop views sit side by side');
		const isoBounds = await bounds('svg[data-view="isometric"]');
		assert.ok(flatBounds.x + flatBounds.width <= isoBounds.x && isoBounds.width > 0, 'isometric shares the desktop split');
		assert.ok(await checkIsoSpawn() > singleIsoHeight, 'taller isometric panels extend the note spawn column');
		await checkFlatText();
		await setValue('#game-note-speed', 1);
		await setValue('#flat-note-speed', 10);
		await setValue('#isometric-note-speed', 4);
		await setValue('.seek', firstTap.time - .25);
		const gameTap = noteSelector(firstTap).replace('svg ', 'svg[data-view="game"] ');
		const flatTap = noteSelector(firstTap).replace('svg ', 'svg[data-view="flat"] ');
		const isoTap = noteSelector(firstTap).replace('svg ', 'svg[data-view="isometric"] ');
		assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(gameTap)})`), true);
		assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(flatTap)})`), false, 'flat speed is independent of game speed');
		const isoLift = await attr(isoTap, 'data-height');
		await setValue('#flat-note-speed', 2);
		assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(flatTap)})`), true);
		assert.equal(await attr(isoTap, 'data-height'), isoLift, 'flat speed does not affect isometric height');
		const pressMarks = () => evaluate(`Array.from(document.querySelectorAll('svg[data-view] .press-mark'), el => el.closest('svg').dataset.view + ':' + el.dataset.button)`);
		await setValue('.seek', firstTap.time - .01);
		assert.ok(!(await pressMarks()).includes(`game:${firstTap.position}`), 'no press highlight before the hit');
		await setValue('.seek', firstTap.time);
		for (const id of ['game', 'flat', 'isometric']) assert.ok((await pressMarks()).includes(`${id}:${firstTap.position}`), `${id} highlights the button to press`);
		assert.equal(await evaluate('document.querySelector("#press-trail").value'), '4', 'press afterimage defaults to 4');
		assert.equal(await attr('#press-trail-notes', 'aria-checked'), 'true', 'press afterimage counts notes by default');
		await click('#press-trail-beats');
		for (const id of ['game', 'flat', 'isometric']) assert.ok((await pressMarks()).includes(`${id}:${firstTap.position}`), `${id} highlights in beat mode too`);
		await setValue('#press-trail', -1);
		assert.deepEqual(await pressMarks(), [], '-1 turns press highlights off');
		await reload();
		await showViews('game', 'flat', 'isometric');
		assert.equal(await evaluate('document.querySelector("#press-trail").value'), '-1', 'press afterimage setting survives a reload');
		assert.equal(await attr('#press-trail-beats', 'aria-checked'), 'true', 'press afterimage unit survives a reload');
		await setValue('#press-trail', 4);
		await click('#press-trail-notes');
		await showViews('flat');
		await click('#view-game');
		assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-panel]"), el => el.dataset.panel)'), ['flat', 'game'], 'views appear in activation order');
		await checkFlatText();
		await click('#view-flat');
		await click('#view-isometric');
		await click('#view-flat');
		assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-panel]"), el => el.dataset.panel)'), ['game', 'isometric', 'flat'], 'reenabled views append to the end');
		assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".view-speeds legend"), el => el.textContent)'), ['게임', 'Isometric', '평면', '누를 위치 강조'], 'speed controls follow viewer order');
		for (const id of ['game', 'isometric', 'flat']) await click('#view-' + id);
		assert.equal(await evaluate('document.querySelectorAll("[data-panel]").length'), 0);
		assert.match(await evaluate('document.querySelector("#chart-stage").textContent'), /표시할 뷰/);
		await showViews('game');
		await setValue('.seek', 0);
		await click('.controls button');
		await sleep(1100);
		await click('.player-toggle');
		assert.equal(await evaluate('document.querySelector("#player-content").hidden'), true);
		await click('.player-toggle');
		assert.match(await evaluate('document.querySelector("output").textContent'), /0:01/);
		await click('.controls button');
		await setValue('.seek', 10);
		const scrollBox = await bounds('.timeline-scroll');
		const wheel = async (deltaY) => {
			await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scrollBox.x + scrollBox.width / 2, y: scrollBox.y + scrollBox.height / 2, deltaX: 0, deltaY });
			await sleep(250);
		};
		await click('.controls button');
		await wheel(240);
		assert.equal(await evaluate('document.querySelector(".controls button").textContent'), '재생', 'manual wheel seeking pauses playback');
		const afterWheel = Number(await evaluate('document.querySelector(".seek").value'));
		assert.ok(afterWheel > 10.8 && afterWheel < 11.4, 'wheel distance advances proportionally');
		await wheel(960);
		const afterLargeWheel = Number(await evaluate('document.querySelector(".seek").value'));
		assert.ok(Math.abs(afterLargeWheel - afterWheel - 4) < .03, 'larger wheel distance advances farther');
		await wheel(-480);
		assert.ok(Math.abs(Number(await evaluate('document.querySelector(".seek").value')) - afterLargeWheel + 2) < .03, 'wheel up seeks backward');
		await wheel(-1000000);
		assert.equal(Number(await evaluate('document.querySelector(".seek").value')), 0, 'native scroll clamps to chart start');
		await wheel(1000000);
		assert.ok(Math.abs(Number(await evaluate('document.querySelector(".seek").value')) - Number(await evaluate('document.querySelector(".seek").max'))) < .01, 'native scroll clamps to chart end');
		const tap = async () => {
			for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: scrollBox.x + scrollBox.width / 2, y: scrollBox.y + scrollBox.height / 2, button: 'left', clickCount: 1 });
			await sleep(100);
		};
		await setValue('.seek', 10);
		await tap();
		assert.equal(await evaluate('document.querySelector(".controls button").textContent'), '일시정지', 'tapping the stage starts playback');
		await tap();
		assert.equal(await evaluate('document.querySelector(".controls button").textContent'), '재생', 'tapping the stage again pauses');
		await tap();
		const center = { x: scrollBox.x + scrollBox.width / 2, y: scrollBox.y + scrollBox.height / 2 };
		await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'left', clickCount: 1 });
		for (let step = 1; step <= 4; step++) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y + step * 60, button: 'left', buttons: 1 });
		await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y + 240, button: 'left', clickCount: 1 });
		await sleep(150);
		assert.equal(await evaluate('document.querySelector(".controls button").textContent'), '재생', 'dragging pauses and is not a tap');
		const afterDrag = Number(await evaluate('document.querySelector(".seek").value'));
		assert.ok(afterDrag > 10.9 && afterDrag < 11.3, 'a downward mouse drag of 240px seeks one second forward');
		for (const width of [360, 390, 720]) {
			await resize(width, 844);
			await sleep(50);
			if (await evaluate('document.querySelector("#pane-toggle").getAttribute("aria-expanded") === "true"')) await click('#pane-toggle');
			if (width === 390) {
				await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
				await setValue('.seek', 20);
				const box = await bounds('.timeline-scroll');
				const x = box.x + box.width / 2;
				const y = box.y + box.height * .25;
				await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
				for (let step = 1; step <= 6; step++) {
					await sleep(16);
					await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 40 }] });
				}
				const duringDrag = Number(await evaluate('document.querySelector(".seek").value'));
				assert.ok(duringDrag > 20.5, 'mobile downward drag seeks forward');
				await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
				await sleep(700);
				assert.ok(Number(await evaluate('document.querySelector(".seek").value')) > duringDrag + .1, 'fast flick retains native momentum after release');
				const nativeTime = await evaluate('(() => { const el = document.querySelector(".timeline-scroll"); return (el.scrollHeight - el.clientHeight - el.scrollTop) / 240; })()');
				assert.ok(Math.abs(Number(await evaluate('document.querySelector(".seek").value')) - nativeTime) < .02, 'chart follows native scrolling');
				await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
			}
			const closed = await bounds('section');
			await click('#pane-toggle');
			assert.deepEqual(await bounds('section'), closed, 'mobile panel overlays without moving the playfield');
			assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight'), false);
			await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
			assert.equal(await evaluate('document.activeElement.id'), 'pane-toggle');
			await click('#pane-toggle');
			await click('.backdrop');
			assert.equal(await evaluate('document.querySelector("#side-pane").hidden'), true);
			await showViews('flat');
			assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight'), false, 'flat view fits on mobile');
			await checkFlatText();
			await showViews('game', 'flat', 'isometric');
			assert.equal(await evaluate('document.querySelectorAll("svg[data-view]").length'), 3);
			const mobileGame = await bounds('svg[data-view="game"]');
			const mobileFlat = await bounds('svg[data-view="flat"]');
			assert.ok(mobileGame.height > 0 && mobileFlat.height > 0);
			assert.ok(mobileGame.y + mobileGame.height <= mobileFlat.y, 'mobile views stack vertically');
			const mobileIso = await bounds('svg[data-view="isometric"]');
			assert.ok(mobileFlat.y + mobileFlat.height <= mobileIso.y && mobileIso.height > 0, 'isometric stacks below the other mobile views');
			assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight'), false, 'both views fit on mobile');
			await checkFlatText();
			await showViews('game');
		}
		assert.deepEqual(exceptions, []);
	} finally {
		socket?.close();
		if (browser.pid && browser.exitCode === null && browser.signalCode === null) {
			const stopped = new Promise((resolve) => browser.once('exit', resolve));
			browser.kill();
			await stopped;
		}
		await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
});
