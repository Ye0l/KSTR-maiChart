<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { parseChart, readMaidata, type Note } from '#lib/simai.ts';
	import { clamp, mix, pathData, position, slidePath, star, trace } from '#lib/geometry.ts';
	import SensorLayout from '#lib/SensorLayout.svelte';
	import FlatView from '#lib/FlatView.svelte';
	import IsometricView from '#lib/IsometricView.svelte';
	import { markSimultaneous, noteColor as color } from '#lib/presentation.ts';

	let { data }: { data: PageData } = $props();
	const names = ['EASY', 'BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'];
	let difficulty = $state('5');
	let playing = $state(false);
	let time = $state(0);
	let rate = $state(1);
	type ViewId = 'game' | 'flat' | 'isometric';
	const viewLabels = { game: '게임', flat: '평면', isometric: 'Isometric' };
	const viewIds: ViewId[] = ['game', 'flat', 'isometric'];
	let activeViews = $state<ViewId[]>(['game']);
	let viewSpeeds = $state({
		game: { note: 6, touch: 6 },
		flat: { note: 6, touch: 6 },
		isometric: { note: 6, touch: 6 }
	});
	let speedsLoaded = $state(false);
	const speeds = Array.from({ length: 37 }, (_, i) => 1 + i * .25);
	const approachTime = (note: Note) => 2 / (note.kind.startsWith('touch') ? viewSpeeds.game.touch : viewSpeeds.game.note);
	let search = $state('');
	let paneOpen = $state(true);
	let playerOpen = $state(true);
	let paneTab = $state<'charts' | 'info'>('charts');
	function toggleView(id: ViewId) {
		activeViews = activeViews.includes(id) ? activeViews.filter(view => view !== id) : [...activeViews, id];
	}
	let timelineScroll: HTMLDivElement | undefined = $state();
	// Native scrolling provides wheel distance and touch momentum; 240px is one second.
	const pixelsPerSecond = 240;
	let programmedScrollTop: number | undefined;

	function seekFromScroll(scroller: HTMLDivElement) {
		const top = scroller.scrollTop;
		if (top === programmedScrollTop) {
			programmedScrollTop = undefined;
			return;
		}
		programmedScrollTop = undefined;
		if (!playing) time = Math.max(0, Math.min(chart.duration, top / pixelsPerSecond));
	}

	function tabKeys(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		paneTab = event.key === 'Home' ? 'charts' : event.key === 'End' ? 'info' : paneTab === 'charts' ? 'info' : 'charts';
		document.getElementById(`tab-${paneTab}`)?.focus();
	}
	const fields = $derived(readMaidata(data.text));
	const difficulties = $derived(Object.keys(fields).filter((key) => /^inote_\d+$/.test(key) && fields[key]).map((key) => key.slice(6)));
	const activeDifficulty = $derived(difficulties.includes(difficulty) ? difficulty : difficulties.at(-1) ?? '');
	const chart = $derived(parseChart(fields[`inote_${activeDifficulty}`] ?? '', Number(fields.wholebpm), Number(fields.first ?? 0)));
	const displayNotes = $derived(markSimultaneous(chart.notes));
	const prepared = $derived(displayNotes.map((note) => ({
		...note,
		paths: note.kind === 'slide' ? note.segments.reduce<ReturnType<typeof slidePath>>((paths, segment) => {
			const next = slidePath(segment);
			if (paths.length === 1 && next.length === 1) return [[...paths[0], ...next[0].slice(1)]];
			return [...paths, ...next];
		}, []) : []
	})));
	const visible = $derived(prepared.filter((note) => note.time - approachTime(note) <= time && time <= note.time + note.wait + note.duration + .18));
	const filteredSongs = $derived(data.songs.filter((song) => song.title.toLowerCase().includes(search.toLowerCase())));
	const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

	$effect(() => {
		data.selected;
		activeDifficulty;
		playing = false;
		time = 0;
	});

	$effect(() => {
		if (!timelineScroll) return;
		const top = time * pixelsPerSecond;
		if (Math.abs(timelineScroll.scrollTop - top) > 1) {
			timelineScroll.scrollTop = top;
			programmedScrollTop = timelineScroll.scrollTop;
		}
	});

	$effect(() => {
		if (!speedsLoaded) return;
		try {
			localStorage.setItem('maichart.speeds', JSON.stringify(viewSpeeds));
		} catch {
			// Storage may be blocked; keep the current session usable.
		}
	});

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('maichart.speeds') ?? '{}');
			for (const id of viewIds) {
				// Preserve the previous shared settings when upgrading to per-view speeds.
				const settings = saved?.[id] ?? saved;
				if (speeds.includes(settings?.note)) viewSpeeds[id].note = settings.note;
				if (speeds.includes(settings?.touch)) viewSpeeds[id].touch = settings.touch;
			}
		} catch {
			// Invalid or inaccessible storage falls back to the defaults.
		}
		speedsLoaded = true;
		if (window.matchMedia('(max-width: 720px)').matches) paneOpen = false;
		let frame: number;
		let previous = performance.now();
		const tick = (now: number) => {
			if (playing) {
				time = Math.min(chart.duration, time + (now - previous) / 1000 * rate);
				if (time >= chart.duration) playing = false;
			}
			previous = now;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	function toggle() {
		if (time >= chart.duration) time = 0;
		playing = !playing;
	}
</script>

<svelte:head>
	<title>{fields.title ?? 'maiChart'} · 차트 뷰어</title>
	<meta name="description" content="Simai 차트를 게임·평면·Isometric 뷰로 재생하는 뷰어" />
</svelte:head>

<svelte:window onkeydown={(event) => {
	if (event.key === 'Escape' && paneOpen) {
		paneOpen = false;
		document.getElementById('pane-toggle')?.focus();
	}
}} />

<main>
	<nav aria-label="상단 내비게이터">
		<h1>maiChart <small>viewer</small></h1>
		<span class="now-playing">{fields.title} · {names[Number(activeDifficulty) - 1]}</span>
		<div class="view-switch" role="group" aria-label="뷰 형태">
			{#each viewIds as id}
				<button id={`view-${id}`} aria-pressed={activeViews.includes(id)} onclick={() => toggleView(id)}>{viewLabels[id]}{id !== 'isometric' ? ' 뷰' : ''}</button>
			{/each}
		</div>
	</nav>
	<div class="workspace" class:pane-open={paneOpen}>
		<button id="pane-toggle" class="pane-toggle compact" aria-label={paneOpen ? '좌측 패널 접기' : '좌측 패널 펼치기'} aria-expanded={paneOpen} aria-controls="side-pane" onclick={() => paneOpen = !paneOpen}>{paneOpen ? '‹' : '☰'}</button>
		{#if paneOpen}
			<button class="backdrop" aria-label="좌측 패널 닫기" onclick={() => paneOpen = false}></button>
		{/if}
		<aside id="side-pane" hidden={!paneOpen} aria-label="차트 패널">
			<div class="tabs" role="tablist" tabindex="-1" aria-label="패널 탭" onkeydown={tabKeys}>
				<button id="tab-charts" role="tab" aria-selected={paneTab === 'charts'} aria-controls="panel-charts" tabindex={paneTab === 'charts' ? 0 : -1} onclick={() => paneTab = 'charts'}>차트</button>
				<button id="tab-info" role="tab" aria-selected={paneTab === 'info'} aria-controls="panel-info" tabindex={paneTab === 'info' ? 0 : -1} onclick={() => paneTab = 'info'}>정보</button>
			</div>
			<div id="panel-charts" class="panel-content" role="tabpanel" aria-labelledby="tab-charts" hidden={paneTab !== 'charts'}>
			<form method="GET">
				<label for="search">곡 검색</label>
				<input id="search" type="search" placeholder="곡명 또는 ID" bind:value={search} />
				<label for="chart">차트 ({filteredSongs.length})</label>
				<select id="chart" name="chart" size="12" value={data.selected}>
					{#each filteredSongs as song}
						<option value={song.id}>{song.title}</option>
					{/each}
				</select>
				<button type="submit">차트 열기</button>
			</form>
			<label for="difficulty">난이도</label>
			<select id="difficulty" value={activeDifficulty} onchange={(event) => difficulty = event.currentTarget.value}>
				{#each difficulties as level}
					<option value={level}>{names[Number(level) - 1] ?? level} · {fields[`lv_${level}`] ?? '?'}</option>
				{/each}
			</select>
			</div>
			<div id="panel-info" class="panel-content" role="tabpanel" aria-labelledby="tab-info" tabindex="0" hidden={paneTab !== 'info'}>
			<h2>{fields.title}</h2>
			<p>{fields.artist}</p>
			<p>BPM {fields.wholebpm ?? '—'} · {chart.notes.filter((note) => note.kind !== 'slide').length} notes</p>
			<p class="legend">분홍 TAP/HOLD · 노랑 동시입력<br />민트 TOUCH / 하늘 SLIDE<br />주황 BREAK (최우선) / 흰 테두리 EX</p>
			{#if chart.warnings.length}
				<details>
					<summary>미지원 표기 {chart.warnings.length}종 (건너뜀)</summary>
					<ul>{#each chart.warnings as warning}<li>{warning}</li>{/each}</ul>
				</details>
			{/if}
			<p>무음 자동 재생 · 슬라이드 경로는 근사 표시</p>
			</div>
		</aside>
		<section id="chart-stage" class:split={activeViews.length > 1} style:--view-count={Math.max(1, activeViews.length)} aria-label="플레이 화면">
			{#each activeViews as id (id)}
			<div class="viewer" data-panel={id}>
			{#if id === 'game'}
			<svg data-view="game" viewBox="0 0 600 600" role="img" aria-label={`${fields.title} 차트 재생 화면`}>
				<circle cx="300" cy="300" r="292" fill="#161b27" stroke="#424b60" stroke-width="8" />
				<circle cx="300" cy="300" r="254" fill="#0d1019" stroke="#8790a7" stroke-width="2" />
				<SensorLayout />
				{#each Array.from({ length: 8 }, (_, i) => String(i + 1)) as button}
					{@const target = position(button)}
					<circle cx={target.x} cy={target.y} r="13" fill="#31394d" />
					<text x={target.x} y={target.y + 5} text-anchor="middle" fill="#c8cfe0" font-size="14">{button}</text>
				{/each}
				<!-- Tracks sit behind approaching notes. -->
				{#each visible.filter((note) => note.kind === 'slide') as note}
					{@const progress = note.duration ? clamp((time - note.time - note.wait) / note.duration) : Number(time >= note.time + note.wait)}
					{#each note.paths as points}
						{@const traced = trace(points, progress)}
						<path d={pathData(traced.rest)} fill="none" stroke={color(note)} stroke-width="11" stroke-dasharray="3 12" opacity={time < note.time ? .35 : .85} />
						{#if time >= note.time && time <= note.time + note.wait + note.duration}
							<polygon points={star(traced.point, 20)} fill={color(note)} stroke="white" stroke-width="2" />
						{/if}
					{/each}
				{/each}
				{#each visible.filter((note) => note.kind !== 'slide') as note}
					{@const approach = approachTime(note)}
					{@const target = position(note.position)}
					{@const arriving = clamp(1 - (note.time - time) / approach)}
					{@const touch = note.kind.startsWith('touch')}
					{@const point = touch ? target : mix({ x: 300, y: 300 }, target, .18 + arriving * .82)}
					{@const hit = time >= note.time}
					{@const holding = note.duration > 0 && hit && time < note.time + note.duration}
					<g data-kind={note.kind} data-time={note.time} data-position={note.position} opacity={hit && !holding ? clamp(1 - (time - note.time) / .18) : .35 + arriving * .65}>
						{#if note.kind === 'hold'}
							{@const tail = mix({ x: 300, y: 300 }, target, .18 + clamp(1 - (note.time + note.duration - time) / approach) * .82)}
							<line x1={point.x} y1={point.y} x2={tail.x} y2={tail.y} stroke={color(note)} stroke-width="19" stroke-linecap="round" opacity=".5" />
						{/if}
						{#if touch}
							<circle cx={point.x} cy={point.y} r={34 - arriving * 17} fill="none" stroke={color(note)} stroke-width="3" />
							{#each [0, 90, 180, 270] as angle}
								<path d="M -6 -7 L 0 0 L 6 -7" transform={`translate(${point.x},${point.y}) rotate(${angle}) translate(0,${-32 + arriving * 22})`} fill="none" stroke={color(note)} stroke-width="3" />
							{/each}
							{#if note.kind === 'touchHold'}
								<circle cx={point.x} cy={point.y} r="10" fill={color(note)} />
								<circle cx={point.x} cy={point.y} r="23" fill="none" stroke={color(note)} stroke-width="5" pathLength="1" stroke-dasharray={`${note.duration ? 1 - clamp((time - note.time) / note.duration) : 0} 1`} transform={`rotate(-90 ${point.x} ${point.y})`} />
							{/if}
						{:else if note.kind === 'star'}
							<polygon points={star(point, 18)} fill={color(note)} stroke={note.ex ? 'white' : '#102b43'} stroke-width="3" />
						{:else}
							<circle cx={point.x} cy={point.y} r={holding ? 18 : 14} fill="#101522" stroke={color(note)} stroke-width="6" />
							{#if note.ex}<circle cx={point.x} cy={point.y} r="19" fill="none" stroke="white" stroke-width="2" />{/if}
						{/if}
						{#if hit && note.firework}
							<circle cx={point.x} cy={point.y} r={25 + clamp((time - note.time) / .18) * 30} fill="none" stroke="#ffdb4d" stroke-dasharray="3 6" stroke-width="5" />
						{/if}
					</g>
				{/each}
				<text x="300" y="589" text-anchor="middle" fill="#75819b" font-size="13">{playing ? 'AUTO PLAY' : 'PAUSED'}</text>
			</svg>
			{/if}
			{#if id === 'flat'}
				<FlatView notes={displayNotes} {time} noteSpeed={viewSpeeds.flat.note} touchSpeed={viewSpeeds.flat.touch} />
			{/if}
			{#if id === 'isometric'}
				<IsometricView notes={prepared} {time} noteSpeed={viewSpeeds.isometric.note} touchSpeed={viewSpeeds.isometric.touch} />
			{/if}
			</div>
			{/each}
			{#if !activeViews.length}<p>상단에서 표시할 뷰를 선택하세요.</p>{/if}
			<div class="timeline-scroll" bind:this={timelineScroll} role="scrollbar" aria-controls="chart-stage" aria-orientation="vertical" aria-valuemin="0" aria-valuemax={chart.duration} aria-valuenow={time} aria-valuetext={timestamp(time)} tabindex="0" aria-label="휠 또는 상하 스와이프로 재생 위치 탐색"
				onwheel={() => playing = false}
				onpointerdown={() => playing = false}
				onkeydown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) playing = false; }}
				onscroll={(event) => seekFromScroll(event.currentTarget)}>
				<div class="timeline-content" style:height={`calc(100% + ${chart.duration * pixelsPerSecond}px)`}></div>
			</div>
		</section>
	</div>
	<footer aria-label="재생바">
		<button class="player-toggle compact" aria-label={playerOpen ? '재생바 접기' : '재생바 펼치기'} aria-expanded={playerOpen} aria-controls="player-content" onclick={() => playerOpen = !playerOpen}>{playerOpen ? '⌄' : '⌃'}</button>
		<div id="player-content" hidden={!playerOpen}>
			<div class="controls">
				<button onclick={toggle}>{playing ? '일시정지' : '재생'}</button>
				<button onclick={() => { time = 0; playing = false; }}>처음</button>
				<output>{timestamp(time)} / {timestamp(chart.duration)}</output>
				<label for="playback-rate">재생 속도
					<select id="playback-rate" bind:value={rate}>{#each [.25, .5, .75, 1, 1.5, 2] as speed}<option value={speed}>{speed}×</option>{/each}</select>
				</label>
				{#each activeViews as id (id)}
					<fieldset class="view-speeds">
						<legend>{viewLabels[id]}</legend>
						<label for={`${id}-note-speed`}>노트 배속
							<select id={`${id}-note-speed`} bind:value={viewSpeeds[id].note}>{#each speeds as speed}<option value={speed}>{speed.toFixed(2)}</option>{/each}</select>
						</label>
						<label for={`${id}-touch-speed`}>터치 배속
							<select id={`${id}-touch-speed`} bind:value={viewSpeeds[id].touch}>{#each speeds as speed}<option value={speed}>{speed.toFixed(2)}</option>{/each}</select>
						</label>
					</fieldset>
				{/each}
			</div>
			<input class="seek" aria-label="재생 위치" type="range" min="0" max={chart.duration} step="0.01" bind:value={time} />
		</div>
	</footer>
</main>

<style>
	:global(body) { margin: 0; background: #090d14; color: #e1e6f0; font-family: system-ui, sans-serif; }
	:global(*) { box-sizing: border-box; }
	[hidden] { display: none !important; }
	main { height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
	nav { min-height: 54px; display: flex; align-items: center; gap: 24px; padding: 10px 18px; border-bottom: 1px solid #303a4e; background: #161d2b; }
	h1 { margin: 0; font-size: 21px; white-space: nowrap; }
	small, p { color: #9da9be; }
	.now-playing { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
	.view-switch { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
	.view-switch button { padding: 6px 10px; font-size: 13px; }
	.view-switch button[aria-pressed='true'] { background: #30415d; border-color: #78b5e6; }
	p { font-size: 13px; line-height: 1.6; }
	.workspace { display: flex; position: relative; min-height: 0; }
	aside { flex: 0 0 300px; width: 300px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #303a4e; background: #121927; }
	.tabs { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid #303a4e; }
	.tabs button { flex: 1; }
	.tabs button[aria-selected='true'] { background: #30415d; border-color: #78b5e6; }
	.panel-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px; }
	.pane-toggle { position: absolute; top: 10px; left: 10px; z-index: 4; }
	.pane-open .pane-toggle { left: 310px; }
	.compact { width: 32px; height: 32px; padding: 0; font-size: 20px; line-height: 1; }
	.backdrop { display: none; }
	form { display: grid; gap: 8px; margin-bottom: 18px; }
	label { font-size: 13px; }
	input, select, button { font: inherit; background: #1a2232; color: #e1e6f0; border: 1px solid #46526b; border-radius: 4px; padding: 8px; max-width: 100%; }
	button { cursor: pointer; }
	button:hover { background: #2b3a53; }
	:focus-visible { outline: 2px solid #78b5e6; outline-offset: 2px; }
	select { width: 100%; }
	select[size] { font-size: 13px; padding: 3px; }
	option { padding: 5px; }
	h2 { font-size: 18px; overflow-wrap: anywhere; }
	.legend { font-size: 12px; }
	details { font-size: 12px; color: #ffbd78; overflow-wrap: anywhere; }
	ul { padding-left: 18px; max-height: 200px; overflow: auto; }
	section { position: relative; flex: 1; min-width: 0; min-height: 0; display: grid; place-items: center; padding: 12px 48px; }
	section.split { grid-template-columns: repeat(var(--view-count), minmax(0, 1fr)); gap: 12px; padding-inline: 16px; }
	.viewer { width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; place-items: center; }
	.timeline-scroll { position: absolute; inset: 0; z-index: 1; overflow-y: scroll; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: none; }
	.timeline-scroll::-webkit-scrollbar { display: none; }
	.timeline-content { width: 1px; pointer-events: none; }
	svg { display: block; width: 100%; height: 100%; min-height: 0; }
	footer { position: relative; border-top: 1px solid #303a4e; background: #161d2b; min-height: 38px; padding: 8px 16px max(8px, env(safe-area-inset-bottom)); }
	.player-toggle { position: absolute; right: 10px; top: 3px; }
	.controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-right: 36px; }
	.controls label { display: flex; align-items: center; gap: 6px; }
	.controls select { width: auto; }
	.view-speeds { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; margin: 0; padding: 4px 8px 8px; border: 1px solid #303a4e; border-radius: 4px; }
	.view-speeds legend { padding-inline: 4px; font-size: 12px; color: #9da9be; }
	output { font-variant-numeric: tabular-nums; font-size: 13px; }
	.seek { width: 100%; margin-top: 10px; accent-color: #57dfff; }
	@media (max-width: 720px) {
		nav { gap: 6px 12px; padding-inline: 12px; flex-wrap: wrap; }
		.now-playing { flex: 1; }
		.view-switch { width: 100%; margin-left: 0; }
		.view-switch button { flex: 1; padding-inline: 5px; font-size: 12px; }
		h1 { font-size: 18px; }
		section { padding: 42px 8px 8px; }
		section.split { grid-template-columns: minmax(0, 1fr); grid-template-rows: repeat(var(--view-count), minmax(0, 1fr)); gap: 8px; padding-inline: 8px; }
		aside { position: absolute; bottom: 0; left: 0; width: 100%; max-height: calc(100% - 52px); z-index: 3; border: 1px solid #46526b; border-radius: 12px 12px 0 0; box-shadow: 0 -12px 40px #0008; }
		.pane-open .pane-toggle { left: 10px; }
		.backdrop { display: block; position: absolute; inset: 0; width: 100%; max-width: none; border: 0; border-radius: 0; background: #0007; z-index: 2; }
		.backdrop:hover { background: #0007; }
		select[size] { height: 180px; }
		footer { padding-inline: 10px; }
		.controls { gap: 8px; }
		.controls label { font-size: 12px; }
	}
</style>
