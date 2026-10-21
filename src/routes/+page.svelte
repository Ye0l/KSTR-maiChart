<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { parseChart, readMaidata, type Note } from '#lib/simai.ts';
	import { chevrons, clamp, mix, position, slidePath, star, trace } from '#lib/geometry.ts';
	import SensorLayout from '#lib/SensorLayout.svelte';
	import FlatView from '#lib/FlatView.svelte';
	import IsometricView from '#lib/IsometricView.svelte';
	import SliceView from '#lib/SliceView.svelte';
	import { defaultSliceCount, defaultSliceLength, sliceCounts, sliceLengths } from '#lib/slices.ts';
	import { markSimultaneous, noteColor as color } from '#lib/presentation.ts';
	import { createTicker } from '#lib/ticks.ts';
	import { defaultTrail, pressMarks, pressMoments, trailOptions, trailUnits, type TrailUnit } from '#lib/press.ts';

	let { data }: { data: PageData } = $props();
	const names = ['EASY', 'BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'];
	const difficultyColors = ['#4ea6ff', '#4cd964', '#ffc23d', '#ff6b81', '#b77cff', '#e9d4ff'];
	const legend = [
		['#ff68b7', 'TAP / HOLD'], ['#ffdb4d', '동시입력'], ['#75edb0', 'TOUCH'],
		['#57dfff', 'SLIDE'], ['#ff9a35', 'BREAK (최우선)'], ['transparent', 'EX (흰 테두리)']
	];
	let difficulty = $state('5');
	let playing = $state(false);
	let time = $state(0);
	let rate = $state(1);
	type ViewId = 'game' | 'flat' | 'isometric' | 'slice';
	// The time slice view steps by note instants, so it has no approach speed.
	type SpeedView = Exclude<ViewId, 'slice'>;
	const viewLabels = { game: '게임', flat: '평면', isometric: 'Isometric', slice: '시간 단면' };
	const viewIds: ViewId[] = ['game', 'flat', 'isometric', 'slice'];
	const speedViews: SpeedView[] = ['game', 'flat', 'isometric'];
	let activeViews = $state<ViewId[]>(['game']);
	let viewSpeeds = $state({
		game: { note: 6, touch: 6 },
		flat: { note: 2, touch: 2 },
		isometric: { note: 2, touch: 2 }
	});
	let speedsLoaded = $state(false);
	let sliceCount = $state(defaultSliceCount);
	let sliceLength = $state(defaultSliceLength);
	// How long a press highlight lingers, in notes or beats; -1 turns it off, 0 keeps only the hit flash.
	let pressTrail = $state(defaultTrail);
	let pressTrailUnit = $state<TrailUnit>('notes');
	// A tick at every press moment, so the rhythm can be heard as well as seen.
	let ticks = $state(true);
	const ticker = createTicker();
	const speedKinds = [['note', '노트'], ['touch', '터치']] as const;
	const speeds = Array.from({ length: 37 }, (_, i) => 1 + i * .25);
	const approachTime = (note: Note) => 2 / (note.kind.startsWith('touch') ? viewSpeeds.game.touch : viewSpeeds.game.note);
	let search = $state('');
	let paneOpen = $state(true);
	let playerOpen = $state(true);
	let speedsOpen = $state(false);
	let paneTab = $state<'charts' | 'info'>('charts');
	function toggleView(id: ViewId) {
		activeViews = activeViews.includes(id) ? activeViews.filter(view => view !== id) : [...activeViews, id];
	}
	let timelineScroll: HTMLDivElement | undefined = $state();
	// Native scrolling provides touch momentum; 240px is one second.
	// The offset runs backwards (bottom = chart start) so a downward swipe pulls the falling notes forward.
	const pixelsPerSecond = 240;
	const scrollTopAt = (seconds: number) => (chart.duration - seconds) * pixelsPerSecond;
	let programmedScrollTop: number | undefined;
	// Last known scroll offset, so syncing never reads layout right after the views were mutated.
	let knownScrollTop = 0;
	// A press pauses at once so drags can seek; a press that barely moved is a tap that toggles playback.
	let press: { x: number; y: number; playing: boolean } | undefined;
	// Mouse and pen have no native drag-scroll; a held drag moves the timeline at the touch rate, grabbing the falling notes (down = forward).
	let drag = $state<{ y: number; top: number }>();

	function seekFromScroll(scroller: HTMLDivElement) {
		const top = scroller.scrollTop;
		knownScrollTop = top;
		if (programmedScrollTop !== undefined && Math.abs(top - programmedScrollTop) < 1) {
			programmedScrollTop = undefined;
			return;
		}
		programmedScrollTop = undefined;
		if (!playing) time = Math.max(0, Math.min(chart.duration, chart.duration - top / pixelsPerSecond));
	}

	// Wheel and keys keep their usual sense (down = forward), so they move the reversed offset themselves.
	function seekBy(seconds: number) {
		playing = false;
		time = Math.max(0, Math.min(chart.duration, time + seconds));
	}

	function seekKeys(event: KeyboardEvent & { currentTarget: HTMLElement }) {
		const page = event.currentTarget.clientHeight * .9 / pixelsPerSecond;
		const step = { ArrowDown: 40 / pixelsPerSecond, ArrowUp: -40 / pixelsPerSecond, PageDown: page, PageUp: -page, ' ': event.shiftKey ? -page : page }[event.key];
		if (step === undefined && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		if (event.key === 'Home') seekBy(-time);
		else if (event.key === 'End') seekBy(chart.duration - time);
		else seekBy(step!);
	}

	$effect(() => {
		if (!timelineScroll) return;
		// Registered by hand: the wheel must be cancelable, and Svelte attaches wheel handlers as passive.
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			// Ctrl+wheel is a trackpad pinch; it is blocked page-wide below and must not seek.
			if (event.ctrlKey) return;
			const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? timelineScroll!.clientHeight : 1;
			seekBy(event.deltaY * unit / pixelsPerSecond);
		};
		timelineScroll.addEventListener('wheel', wheel, { passive: false });
		return () => timelineScroll?.removeEventListener('wheel', wheel);
	});

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
	const presses = $derived(pressMoments(displayNotes));
	const tickTimes = $derived(presses.map((press) => press.time));
	const marks = $derived(pressMarks(presses, time, chart.tempo, pressTrail, pressTrailUnit));
	const visible = $derived(prepared.filter((note) => note.time - approachTime(note) <= time && time <= note.time + note.wait + note.duration + .18));
	const songs = $derived(data.songs.map((song) => {
		const match = /^(\d+) · (.*?)( \[DX\])?$/.exec(song.title);
		return { ...song, name: match?.[2] ?? song.title, number: match?.[1], dx: !!match?.[3], genre: song.id.split('/')[0] };
	}));
	const versionOrder = ['', ' PLUS', ' GreeN', ' GreeN PLUS', ' ORANGE', ' ORANGE PLUS', ' PiNK', ' PiNK PLUS', ' MURASAKi', ' MURASAKi PLUS', ' MiLK', ' MiLK PLUS', ' FiNALE',
		' DX', ' DX PLUS', ' DX Splash', ' DX Splash PLUS', ' DX UNiVERSE', ' DX UNiVERSE PLUS', ' DX FESTiVAL', ' DX FESTiVAL PLUS', ' DX BUDDiES', ' DX BUDDiES PLUS',
		' DX PRiSM', ' DX PRiSM PLUS', ' DX CiRCLE', ' DX CiRCLE PLUS'].map((name) => `maimai${name}`);
	const versionRank = (version: string) => versionOrder.includes(version) ? versionOrder.indexOf(version) : versionOrder.length;
	const versions = $derived([...new Set(data.songs.map((song) => song.version).filter(Boolean))].sort((a, b) => versionRank(a) - versionRank(b) || a.localeCompare(b)));
	// Chart constants group the way the game shows them: x.0–x.6 is "x", x.7–x.9 is "x+"; a trailing "?" marks an estimate.
	const levelLabel = (value: string) => {
		const match = /^(\d+)(\+)?(?:\.(\d))?/.exec(value);
		if (!match) return value;
		return match[2] || Number(match[3] ?? 0) >= 7 ? `${match[1]}+` : match[1];
	};
	const levelRank = (label: string) => parseFloat(label) + (label.endsWith('+') ? .5 : 0);
	const levelOptions = $derived([...new Set(data.songs.flatMap((song) => song.levels.map(([, value]) => levelLabel(value))))].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b)));
	let levelFilter = $state('');
	let versionFilter = $state('');
	const filteredSongs = $derived(songs.flatMap((song) => {
		if (!song.title.toLowerCase().includes(search.toLowerCase()) || (versionFilter && song.version !== versionFilter)) return [];
		const matches = levelFilter ? song.levels.filter(([, value]) => levelLabel(value) === levelFilter) : [];
		return levelFilter && !matches.length ? [] : [{ ...song, matches }];
	}));
	let songList: HTMLUListElement | undefined = $state();
	// Stack order keeps SLIDE and TOUCH apart; their note colors are too close to sit side by side.
	const densityKinds = [
		{ key: 'tap', label: 'TAP·HOLD', color: '#ff68b7' },
		{ key: 'slide', label: 'SLIDE', color: '#57dfff' },
		{ key: 'break', label: 'BREAK', color: '#ff9a35' },
		{ key: 'touch', label: 'TOUCH', color: '#75edb0' }
	] as const;
	type DensityKey = (typeof densityKinds)[number]['key'];
	const densityKind = (note: Note): DensityKey => note.break ? 'break' : note.kind.startsWith('touch') ? 'touch' : note.kind === 'slide' || note.kind === 'star' ? 'slide' : 'tap';
	const densityBins = 120;
	const density = $derived.by(() => {
		const size = chart.duration / densityBins;
		const bins = Array.from({ length: densityBins }, (_, i) => ({ start: i * size, total: 0, tap: 0, slide: 0, break: 0, touch: 0 }));
		for (const note of chart.notes) {
			const bin = bins[Math.max(0, Math.min(densityBins - 1, Math.floor(note.time / size)))];
			bin[densityKind(note)]++;
			bin.total++;
		}
		return { bins, size, peak: Math.max(1, ...bins.map((bin) => bin.total)) };
	});
	let densityHover = $state<number>();
	let densityDrag = false;
	function seekFromDensity(event: PointerEvent & { currentTarget: HTMLElement }) {
		const box = event.currentTarget.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
		densityHover = Math.min(densityBins - 1, Math.floor(ratio * densityBins));
		if (densityDrag) time = ratio * chart.duration;
	}
	// Scoped to the two elements that draw it: a custom property on a large subtree restyles all of it every frame.
	const progress = $derived(`${chart.duration ? time / chart.duration * 100 : 0}%`);
	const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

	$effect(() => {
		data.selected;
		activeDifficulty;
		playing = false;
		time = 0;
	});

	$effect(() => {
		if (!timelineScroll) return;
		const top = scrollTopAt(time);
		if (Math.abs(knownScrollTop - top) > 1) {
			timelineScroll.scrollTop = top;
			knownScrollTop = programmedScrollTop = top;
		}
	});

	$effect(() => {
		data.selected;
		if (!paneOpen || paneTab !== 'charts' || !songList) return;
		// Bring the open chart into view without scrolling the page itself.
		const item = songList.querySelector<HTMLElement>('[aria-current="page"]');
		if (item && (item.offsetTop < songList.scrollTop || item.offsetTop + item.offsetHeight > songList.scrollTop + songList.clientHeight)) {
			songList.scrollTop = item.offsetTop - (songList.clientHeight - item.offsetHeight) / 2;
		}
	});

	$effect(() => {
		if (!speedsLoaded) return;
		try {
			localStorage.setItem('maichart.speeds', JSON.stringify(viewSpeeds));
			localStorage.setItem('maichart.pressTrail', String(pressTrail));
			localStorage.setItem('maichart.pressTrailUnit', pressTrailUnit);
			localStorage.setItem('maichart.ticks', String(ticks));
			localStorage.setItem('maichart.sliceCount', String(sliceCount));
			localStorage.setItem('maichart.sliceLength', String(sliceLength));
		} catch {
			// Storage may be blocked; keep the current session usable.
		}
	});

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('maichart.speeds') ?? '{}');
			for (const id of speedViews) {
				// Preserve the previous shared settings when upgrading to per-view speeds.
				const settings = saved?.[id] ?? saved;
				if (speeds.includes(settings?.note)) viewSpeeds[id].note = settings.note;
				if (speeds.includes(settings?.touch)) viewSpeeds[id].touch = settings.touch;
			}
			const trail = Number(localStorage.getItem('maichart.pressTrail') ?? NaN);
			if (trailOptions.includes(trail)) pressTrail = trail;
			const unit = localStorage.getItem('maichart.pressTrailUnit');
			if (trailUnits.some(([value]) => value === unit)) pressTrailUnit = unit as TrailUnit;
			if (localStorage.getItem('maichart.ticks') === 'false') ticks = false;
			const slices = Number(localStorage.getItem('maichart.sliceCount'));
			if (sliceCounts.includes(slices)) sliceCount = slices;
			const beats = Number(localStorage.getItem('maichart.sliceLength'));
			if (sliceLengths.some(([value]) => value === beats)) sliceLength = beats;
		} catch {
			// Invalid or inaccessible storage falls back to the defaults.
		}
		speedsLoaded = true;
		if (window.matchMedia('(max-width: 720px)').matches) paneOpen = false;
		// Page zoom is blocked: the stage captures scrolling, so a zoomed page is very hard to zoom back out.
		// iOS Safari ignores user-scalable=no and fires gesture events; elsewhere a pinch arrives as Ctrl+wheel.
		const block = (event: Event) => event.preventDefault();
		const pinch = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
		for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, block);
		window.addEventListener('wheel', pinch, { passive: false });
		return () => {
			for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(type, block);
			window.removeEventListener('wheel', pinch);
		};
	});

	// The frame loop only runs while playing, so a paused viewer stays idle.
	$effect(() => {
		if (!playing) return;
		let frame: number;
		let previous: number | undefined;
		const tick = (now: number) => {
			if (previous !== undefined) time = Math.min(chart.duration, time + (now - previous) / 1000 * rate);
			previous = now;
			if (time >= chart.duration) playing = false;
			else frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	function stepSpeed(id: SpeedView, kind: 'note' | 'touch', delta: number) {
		viewSpeeds[id][kind] = Math.min(10, Math.max(1, viewSpeeds[id][kind] + delta));
	}

	$effect(() => {
		if (!ticks || !playing) ticker.stop();
		else ticker.update(tickTimes, time, rate);
	});
	$effect(() => () => ticker.stop());

	function toggle() {
		ticker.unlock();
		if (time >= chart.duration) time = 0;
		playing = !playing;
	}
</script>

<svelte:head>
	<title>{fields.title ?? 'maiChart'} · 차트 뷰어</title>
	<meta name="description" content="Simai 차트를 게임·평면·Isometric 뷰로 재생하는 뷰어" />
</svelte:head>

<svelte:window onkeydown={(event) => {
	if (event.key !== 'Escape') return;
	if (speedsOpen) {
		speedsOpen = false;
		document.getElementById('speeds-toggle')?.focus();
	} else if (paneOpen) {
		paneOpen = false;
		document.getElementById('pane-toggle')?.focus();
	}
}} />

<main>
	<nav aria-label="상단 내비게이터">
		<button id="pane-toggle" class="icon-button" title={paneOpen ? '패널 접기' : '곡 · 정보 패널'} aria-label={paneOpen ? '좌측 패널 접기' : '좌측 패널 펼치기'} aria-expanded={paneOpen} aria-controls="side-pane" onclick={() => paneOpen = !paneOpen}><span class="icon icon-panel"></span></button>
		<h1><span class="brand">mai</span>Chart</h1>
		<div class="now-playing">
			<span class="now-title">{fields.title}</span>
			{#if activeDifficulty}
				<span class="badge" style:--difficulty={difficultyColors[Number(activeDifficulty) - 1]}>{names[Number(activeDifficulty) - 1] ?? activeDifficulty} <b>{fields[`lv_${activeDifficulty}`] || '?'}</b></span>
			{/if}
		</div>
		<div class="view-switch" role="group" aria-label="뷰 형태">
			{#each viewIds as id}
				<button id={`view-${id}`} aria-pressed={activeViews.includes(id)} onclick={() => toggleView(id)}>{viewLabels[id]}{id === 'game' || id === 'flat' ? ' 뷰' : ''}</button>
			{/each}
		</div>
	</nav>
	<div class="workspace">
		{#if paneOpen}
			<button class="backdrop" aria-label="좌측 패널 닫기" onclick={() => paneOpen = false}></button>
		{/if}
		<aside id="side-pane" hidden={!paneOpen} aria-label="차트 패널">
			<div class="tabs" role="tablist" tabindex="-1" aria-label="패널 탭" onkeydown={tabKeys}>
				<button id="tab-charts" role="tab" aria-selected={paneTab === 'charts'} aria-controls="panel-charts" tabindex={paneTab === 'charts' ? 0 : -1} onclick={() => paneTab = 'charts'}>차트</button>
				<button id="tab-info" role="tab" aria-selected={paneTab === 'info'} aria-controls="panel-info" tabindex={paneTab === 'info' ? 0 : -1} onclick={() => paneTab = 'info'}>정보</button>
			</div>
			<div id="panel-charts" class="panel-content charts" role="tabpanel" aria-labelledby="tab-charts" hidden={paneTab !== 'charts'}>
				<div class="difficulties" role="group" aria-label="난이도">
					{#each difficulties as level}
						<button class="difficulty" style:--difficulty={difficultyColors[Number(level) - 1]} aria-pressed={level === activeDifficulty} onclick={() => difficulty = level}>
							<span>{names[Number(level) - 1] ?? level}</span><b>{fields[`lv_${level}`] || '?'}</b>
						</button>
					{/each}
				</div>
				<label class="search">
					<span class="icon icon-search"></span>
					<input id="search" type="search" placeholder="곡명 또는 ID 검색" aria-label="곡 검색" autocomplete="off" bind:value={search} />
				</label>
				<div class="filters">
					<select aria-label="레벨 필터" bind:value={levelFilter}>
						<option value="">레벨 전체</option>
						{#each levelOptions as level}<option value={level}>Lv {level}</option>{/each}
					</select>
					<select aria-label="버전 필터" bind:value={versionFilter}>
						<option value="">버전 전체</option>
						{#each versions as version}<option value={version}>{version.replace(/^maimai (?=.)/, '')}</option>{/each}
					</select>
				</div>
				<p class="count">
					{filteredSongs.length === songs.length ? `전체 ${songs.length}곡` : `${filteredSongs.length} / ${songs.length}곡`}
					{#if search || levelFilter || versionFilter}<button class="clear" onclick={() => { search = ''; levelFilter = ''; versionFilter = ''; }}>필터 해제</button>{/if}
				</p>
				<ul class="songs" bind:this={songList} aria-label="차트 목록" data-sveltekit-preload-data="tap" data-sveltekit-noscroll>
					{#each filteredSongs as song (song.id)}
						<li>
							<a href={`?chart=${encodeURIComponent(song.id)}`} aria-current={song.id === data.selected ? 'page' : undefined} onclick={() => { if (song.matches.length) difficulty = song.matches.at(-1)![0]; }}>
								<span class="song-name">{song.name}</span>
								<span class="song-meta">{#if song.dx}<b class="dx">DX</b>{/if}{song.number ? `${song.number} · ` : ''}{song.genre}</span>
								{#if song.matches.length}
									<span class="song-levels">{#each song.matches as [level, value]}<b style:--difficulty={difficultyColors[Number(level) - 1]}>{names[Number(level) - 1] ?? level} {value}</b>{/each}</span>
								{/if}
							</a>
						</li>
					{:else}
						<li class="empty-search">“{search}”에 맞는 곡이 없습니다.</li>
					{/each}
				</ul>
			</div>
			<div id="panel-info" class="panel-content" role="tabpanel" aria-labelledby="tab-info" tabindex="0" hidden={paneTab !== 'info'}>
				<h2>{fields.title}</h2>
				<p class="artist">{fields.artist}</p>
				<dl class="meta">
					{#if fields.genre}<div><dt>장르</dt><dd>{fields.genre}</dd></div>{/if}
					<div><dt>BPM</dt><dd>{fields.wholebpm ?? '—'}</dd></div>
					<div><dt>길이</dt><dd>{timestamp(chart.duration)}</dd></div>
					<div><dt>노트</dt><dd>{chart.notes.filter((note) => note.kind !== 'slide').length}</dd></div>
					{#if fields[`des_${activeDifficulty}`] && fields[`des_${activeDifficulty}`] !== '-'}<div><dt>채보</dt><dd>{fields[`des_${activeDifficulty}`]}</dd></div>{/if}
					{#if fields.version}<div><dt>버전</dt><dd>{fields.version}</dd></div>{/if}
				</dl>
				<h3>노트 색상</h3>
				<ul class="legend">
					{#each legend as [swatch, label]}<li><span class="swatch" style:--swatch={swatch}></span>{label}</li>{/each}
				</ul>
				{#if chart.warnings.length}
					<details>
						<summary>미지원 표기 {chart.warnings.length}종 (건너뜀)</summary>
						<ul>{#each chart.warnings as warning}<li>{warning}</li>{/each}</ul>
					</details>
				{/if}
				<p class="hint">음악 없이 틱 사운드로 자동 재생 · 슬라이드 경로는 근사 표시<br />플레이 화면에서 휠 또는 상하 스와이프로 탐색</p>
			</div>
		</aside>
		<section id="chart-stage" class:split={activeViews.length > 1} style:--view-count={Math.max(1, activeViews.length)} aria-label="플레이 화면">
			{#each activeViews as id (id)}
			<div class="viewer" data-panel={id}>
			{#if activeViews.length > 1}<span class="view-tag" aria-hidden="true">{viewLabels[id]}</span>{/if}
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
				{#each marks as mark}
					{@const target = position(mark.button)}
					<circle class="press-mark" data-button={mark.button} cx={target.x} cy={target.y} r="30" fill={mark.color} fill-opacity=".3" stroke={mark.color} stroke-width="4" opacity={mark.strength} pointer-events="none" />
				{/each}
				<!-- Tracks sit behind approaching notes. -->
				{#each visible.filter((note) => note.kind === 'slide') as note}
					{@const progress = note.duration ? clamp((time - note.time - note.wait) / note.duration) : Number(time >= note.time + note.wait)}
					{#each note.paths as points}
						{@const traced = trace(points, progress)}
						<g class="slide-track" fill="none" stroke={color(note)} stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity={time < note.time ? .35 : .9}>
							{#each chevrons(points, progress) as arrow}
								<path d="M-6,-9 L4,0 L-6,9" transform={`translate(${arrow.x},${arrow.y}) rotate(${arrow.angle})`} />
							{/each}
						</g>
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
				<FlatView notes={displayNotes} {time} {marks} noteSpeed={viewSpeeds.flat.note} touchSpeed={viewSpeeds.flat.touch} tempo={chart.tempo} />
			{/if}
			{#if id === 'slice'}
				<SliceView notes={prepared} {time} tempo={chart.tempo} count={sliceCount} length={sliceLength} />
			{/if}
			{#if id === 'isometric'}
				<IsometricView notes={prepared} {time} {marks} noteSpeed={viewSpeeds.isometric.note} touchSpeed={viewSpeeds.isometric.touch} tempo={chart.tempo} />
			{/if}
			</div>
			{/each}
			{#if !activeViews.length}<p class="empty">상단에서 표시할 뷰를 선택하세요.</p>{/if}
			<div class="timeline-scroll" class:dragging={drag} bind:this={timelineScroll} role="scrollbar" aria-controls="chart-stage" aria-orientation="vertical" aria-valuemin="0" aria-valuemax={chart.duration} aria-valuenow={time} aria-valuetext={timestamp(time)} tabindex="0" aria-label="휠, 드래그 또는 상하 스와이프(아래로 끌면 앞으로)로 재생 위치 탐색, 탭하여 재생·일시정지"
				onpointerdown={(event) => {
					press = { x: event.clientX, y: event.clientY, playing };
					playing = false;
					if (event.pointerType !== 'touch' && event.button === 0) {
						drag = { y: event.clientY, top: event.currentTarget.scrollTop };
						event.currentTarget.setPointerCapture(event.pointerId);
					}
				}}
				onpointermove={(event) => { if (drag) event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y); }}
				onpointerup={() => drag = undefined}
				onpointercancel={() => drag = undefined}
				onclick={(event) => {
					if (press && !press.playing && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 10) toggle();
					press = undefined;
				}}
				onkeydown={seekKeys}
				onscroll={(event) => seekFromScroll(event.currentTarget)}>
				<div class="timeline-content" style:height={`calc(100% + ${chart.duration * pixelsPerSecond}px)`}></div>
			</div>
		</section>
	</div>
	<footer aria-label="재생바" class:collapsed={!playerOpen} style:--progress={playerOpen ? undefined : progress}>
		<div id="player-content" hidden={!playerOpen}>
			<div class="timeline-bar">
				<!-- Pressing or dragging the graph seeks like the range below it. -->
				<div class="density" role="presentation"
					onpointerdown={(event) => { densityDrag = true; event.currentTarget.setPointerCapture(event.pointerId); seekFromDensity(event); }}
					onpointermove={seekFromDensity}
					onpointerup={() => { densityDrag = false; }}
					onpointercancel={() => { densityDrag = false; densityHover = undefined; }}
					onpointerleave={() => { if (!densityDrag) densityHover = undefined; }}>
					<svg viewBox={`0 0 ${densityBins} 100`} preserveAspectRatio="none" role="img" aria-label={`노트 밀도 그래프: 구간(${density.size.toFixed(1)}초)당 최대 ${density.peak}개`}>
						{#each density.bins as bin, i}
							{@const past = bin.start + density.size <= time}
							<g opacity={past || densityHover === i ? 1 : .55}>
								{#each densityKinds as kind, k}
									{@const below = densityKinds.slice(0, k).reduce((sum, other) => sum + bin[other.key], 0)}
									{#if bin[kind.key]}
										<rect x={i + .15} width=".7" y={100 - (below + bin[kind.key]) / density.peak * 100} height={Math.max(0, bin[kind.key] / density.peak * 100 - 3)} fill={kind.color} />
									{/if}
								{/each}
							</g>
						{/each}
						<line class="playhead" x1={time / density.size} x2={time / density.size} y1="0" y2="100" vector-effect="non-scaling-stroke" />
					</svg>
					{#if densityHover !== undefined}
						{@const bin = density.bins[densityHover]}
						<div class="density-tip" style:left={`${(densityHover + .5) / densityBins * 100}%`} style:translate={densityHover < densityBins * .15 ? '0' : densityHover > densityBins * .85 ? '-100%' : '-50%'}>
							<b>{timestamp(bin.start)}–{timestamp(bin.start + density.size)} · {bin.total}개</b>
							{#each densityKinds as kind}{#if bin[kind.key]}<span><i style:--swatch={kind.color}></i>{kind.label} {bin[kind.key]}</span>{/if}{/each}
						</div>
					{/if}
				</div>
				<input class="seek" style:--progress={progress} aria-label="재생 위치" type="range" min="0" max={chart.duration} step="0.01" bind:value={time} />
			</div>
			<div class="controls">
				<button class="play" title={playing ? '일시정지' : '재생'} onclick={toggle}><span class="icon" class:icon-play={!playing} class:icon-pause={playing}></span><span class="sr-only">{playing ? '일시정지' : '재생'}</span></button>
				<button class="icon-button" title="처음으로" onclick={() => { time = 0; playing = false; }}><span class="icon icon-restart"></span><span class="sr-only">처음</span></button>
				<button id="tick-toggle" class="icon-button" title={ticks ? '틱 사운드 끄기' : '틱 사운드 켜기'} aria-pressed={ticks} onclick={() => { ticker.unlock(); ticks = !ticks; }}><span class="icon" class:icon-sound={ticks} class:icon-mute={!ticks}></span><span class="sr-only">틱 사운드</span></button>
				<output>{timestamp(time)} <span>/ {timestamp(chart.duration)}</span></output>
				<ul class="density-legend" aria-label="밀도 그래프 범례">
					{#each densityKinds as kind}<li><i style:--swatch={kind.color}></i>{kind.label}</li>{/each}
				</ul>
				<label class="rate" for="playback-rate"><span>재생 속도</span>
					<select id="playback-rate" bind:value={rate}>{#each [.25, .5, .75, 1, 1.5, 2] as speed}<option value={speed}>{speed}×</option>{/each}</select>
				</label>
				<button id="speeds-toggle" class="speeds-toggle" aria-expanded={speedsOpen} aria-controls="speed-panel" onclick={() => speedsOpen = !speedsOpen}><span class="icon icon-sliders"></span>배속</button>
			</div>
			<div id="speed-panel" class="speed-panel" hidden={!speedsOpen}>
				<div class="speed-head"><b>노트 · 터치 배속</b><span>표시 시간 = 2000 / 배속 ms</span></div>
				{#each activeViews as id (id)}
					<fieldset class="view-speeds">
						<legend>{viewLabels[id]}</legend>
						{#if id === 'slice'}
							<div class="stepper">
								<label for="slice-count">단면 수</label>
								<button aria-label="단면 줄이기" disabled={sliceCount <= sliceCounts[0]} onclick={() => sliceCount--}>−</button>
								<select id="slice-count" bind:value={sliceCount}>{#each sliceCounts as option}<option value={option}>{option}</option>{/each}</select>
								<button aria-label="단면 늘리기" disabled={sliceCount >= sliceCounts.at(-1)!} onclick={() => sliceCount++}>+</button>
							</div>
							<div class="segmented four" role="radiogroup" aria-label="단면 길이">
								{#each sliceLengths as [beats, label]}
									<button id={`slice-length-${beats}`} role="radio" aria-checked={sliceLength === beats} onclick={() => sliceLength = beats}>{label}</button>
								{/each}
							</div>
						{:else}
						{#each speedKinds as [kind, label]}
							<div class="stepper">
								<label for={`${id}-${kind}-speed`}>{label}</label>
								<button aria-label={`${viewLabels[id]} ${label} 배속 낮추기`} disabled={viewSpeeds[id][kind] <= 1} onclick={() => stepSpeed(id, kind, -.25)}>−</button>
								<select id={`${id}-${kind}-speed`} bind:value={viewSpeeds[id][kind]}>{#each speeds as speed}<option value={speed}>{speed.toFixed(2)}</option>{/each}</select>
								<button aria-label={`${viewLabels[id]} ${label} 배속 높이기`} disabled={viewSpeeds[id][kind] >= 10} onclick={() => stepSpeed(id, kind, .25)}>+</button>
							</div>
						{/each}
						{/if}
					</fieldset>
				{:else}
					<p class="hint">표시 중인 뷰가 없습니다.</p>
				{/each}
				<fieldset class="view-speeds">
					<legend>누를 위치 강조</legend>
					<div class="stepper">
						<label for="press-trail">잔상</label>
						<button aria-label="잔상 줄이기" disabled={pressTrail <= trailOptions[0]} onclick={() => pressTrail--}>−</button>
						<select id="press-trail" bind:value={pressTrail}>{#each trailOptions as beats}<option value={beats}>{beats < 0 ? '없음' : beats}</option>{/each}</select>
						<button aria-label="잔상 늘리기" disabled={pressTrail >= trailOptions.at(-1)!} onclick={() => pressTrail++}>+</button>
					</div>
					<div class="segmented" role="radiogroup" aria-label="잔상 단위">
						{#each trailUnits as [unit, label]}
							<button id={`press-trail-${unit}`} role="radio" aria-checked={pressTrailUnit === unit} onclick={() => pressTrailUnit = unit}>{label}</button>
						{/each}
					</div>
				</fieldset>
			</div>
		</div>
		<button class="player-toggle icon-button" title={playerOpen ? '재생바 접기' : '재생바 펼치기'} aria-label={playerOpen ? '재생바 접기' : '재생바 펼치기'} aria-expanded={playerOpen} aria-controls="player-content" onclick={() => playerOpen = !playerOpen}><span class="icon" class:icon-down={playerOpen} class:icon-up={!playerOpen}></span></button>
	</footer>
</main>

<style>
	:global(:root) {
		color-scheme: dark;
		--bg: #070a11;
		--surface: #0d121c;
		--surface-2: #131a27;
		--surface-3: #1b2435;
		--border: #222c40;
		--border-strong: #34405a;
		--text: #e6ebf5;
		--text-2: #a0abc0;
		--text-3: #6c7892;
		--accent: #57dfff;
		--accent-ink: #03141c;
		--pink: #ff68b7;
		--radius: 10px;
		--tap: 40px;
	}
	:global(html) { touch-action: pan-x pan-y; }
	:global(body) { margin: 0; background: var(--bg); color: var(--text); font-family: 'Pretendard Variable', Pretendard, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }
	:global(*) { box-sizing: border-box; }
	[hidden] { display: none !important; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

	/* Controls */
	input, select, button { font: inherit; color: inherit; max-width: 100%; }
	button, select { touch-action: manipulation; }
	button { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-3); font-size: 14px; transition: background-color .15s, border-color .15s, color .15s; }
	button:disabled { opacity: .35; cursor: default; }
	select { min-height: 36px; padding: 0 28px 0 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%23a0abc0' stroke-width='1.6'/%3E%3C/svg%3E") right 10px center / 10px no-repeat; appearance: none; font-size: 14px; font-variant-numeric: tabular-nums; }
	@media (hover: hover) {
		button:not(:disabled):hover, select:hover { border-color: #4b5a7a; background-color: #233049; }
	}
	:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.icon { flex: none; width: 20px; height: 20px; background: currentColor; mask: var(--icon) center / contain no-repeat; }
	.icon-panel { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Crect x='3' y='4' width='18' height='16' rx='3'/%3E%3Cpath d='M9.5 4v16'/%3E%3C/svg%3E"); }
	.icon-search { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='6.5'/%3E%3Cpath d='m16 16 4.5 4.5'/%3E%3C/svg%3E"); }
	.icon-play { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L9.5 3.94A1 1 0 0 0 8 4.8Z'/%3E%3C/svg%3E"); }
	.icon-pause { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='5.5' y='4' width='4.5' height='16' rx='1.2'/%3E%3Crect x='14' y='4' width='4.5' height='16' rx='1.2'/%3E%3C/svg%3E"); }
	.icon-sound { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 9.5h3.5L12 5.5v13l-4.5-4H4z' fill='black'/%3E%3Cpath d='M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11'/%3E%3C/svg%3E"); }
	.icon-mute { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 9.5h3.5L12 5.5v13l-4.5-4H4z' fill='black'/%3E%3Cpath d='m16 9.5 5 5M21 9.5l-5 5'/%3E%3C/svg%3E"); }
	.icon-restart { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='4.5' y='5' width='3' height='14' rx='1'/%3E%3Cpath d='M19.5 5.9v12.2a1 1 0 0 1-1.55.83L9.2 12.83a1 1 0 0 1 0-1.66l8.75-6.1a1 1 0 0 1 1.55.83Z'/%3E%3C/svg%3E"); }
	.icon-sliders { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 7h9m4 0h3M4 17h3m4 0h9'/%3E%3Ccircle cx='15' cy='7' r='2.2'/%3E%3Ccircle cx='9' cy='17' r='2.2'/%3E%3C/svg%3E"); }
	.icon-down { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E"); }
	.icon-up { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 14.5 6-6 6 6'/%3E%3C/svg%3E"); }
	.icon-button { width: var(--tap); height: var(--tap); padding: 0; border-color: transparent; background: transparent; color: var(--text-2); }
	.icon-button[aria-expanded='true'] { color: var(--text); }
	.icon-button[aria-pressed='true'] { color: var(--accent); }

	/* Shell */
	main { height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
	nav { display: flex; align-items: center; gap: 8px 14px; min-height: 56px; padding: max(8px, env(safe-area-inset-top)) 14px 8px 8px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); }
	h1 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; }
	.brand { background: linear-gradient(100deg, var(--pink), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
	.now-playing { display: flex; align-items: center; gap: 10px; min-width: 0; padding-left: 14px; border-left: 1px solid var(--border); }
	.now-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
	.badge { flex: none; padding: 3px 8px; border: 1px solid color-mix(in srgb, var(--difficulty) 55%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--difficulty) 16%, transparent); color: var(--difficulty); font-size: 11px; font-weight: 700; letter-spacing: .03em; white-space: nowrap; }
	.badge b { color: var(--text); font-variant-numeric: tabular-nums; }
	.view-switch { display: flex; flex-shrink: 0; gap: 2px; margin-left: auto; padding: 3px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
	.view-switch button { min-height: 32px; padding: 0 12px; border-color: transparent; background: transparent; color: var(--text-2); font-size: 13px; font-weight: 600; }
	.view-switch button[aria-pressed='true'] { border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 16%, var(--surface-3)); color: var(--text); }
	.workspace { display: flex; position: relative; min-height: 0; }
	.backdrop { display: none; }

	/* Side pane */
	aside { flex: 0 0 320px; width: 320px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--surface); }
	.tabs { display: flex; gap: 4px; margin: 12px 12px 0; padding: 3px; border-radius: 10px; background: var(--surface-2); }
	.tabs button { flex: 1; min-height: 34px; border-color: transparent; background: transparent; color: var(--text-2); font-weight: 600; }
	.tabs button[aria-selected='true'] { background: var(--surface-3); border-color: var(--border-strong); color: var(--text); }
	.panel-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 12px 16px; }
	.charts { display: flex; flex-direction: column; gap: 10px; overflow: hidden; padding-bottom: 0; }
	.difficulties { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px; }
	.difficulty { flex-direction: column; align-items: flex-start; gap: 0; min-height: 46px; padding: 5px 10px; border-color: var(--border); border-left: 3px solid var(--difficulty); background: var(--surface-2); text-align: left; }
	.difficulty span { color: var(--text-2); font-size: 10.5px; font-weight: 700; letter-spacing: .04em; }
	.difficulty b { font-size: 16px; font-variant-numeric: tabular-nums; }
	.difficulty[aria-pressed='true'] { border-color: var(--difficulty); background: color-mix(in srgb, var(--difficulty) 18%, var(--surface-2)); }
	.difficulty[aria-pressed='true'] span { color: var(--difficulty); }
	.search { position: relative; display: block; margin-top: 4px; }
	.search .icon { position: absolute; left: 11px; top: 50%; width: 17px; height: 17px; translate: 0 -50%; color: var(--text-3); pointer-events: none; }
	.search input { width: 100%; min-height: 40px; padding: 0 12px 0 36px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface-2); font-size: 14px; }
	.search input::placeholder { color: var(--text-3); }
	.filters { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.filters select { width: 100%; }
	.count { display: flex; align-items: center; justify-content: space-between; min-height: 24px; margin: 0; color: var(--text-3); font-size: 12px; }
	.clear { min-height: 24px; padding: 0 8px; border-color: transparent; background: transparent; color: var(--accent); font-size: 12px; }
	.song-levels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
	.song-levels b { padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, var(--difficulty) 18%, transparent); color: var(--difficulty); font-size: 10.5px; line-height: 18px; }
	.songs { position: relative; flex: 1; min-height: 0; margin: 0 -12px; padding: 0 6px 12px; overflow-y: auto; overscroll-behavior: contain; list-style: none; }
	.songs li { content-visibility: auto; contain-intrinsic-size: auto 50px; }
	.songs a { display: grid; gap: 1px; padding: 8px 10px; border-radius: 8px; color: var(--text); text-decoration: none; }
	.songs a[aria-current='page'] { background: color-mix(in srgb, var(--accent) 14%, transparent); box-shadow: inset 3px 0 var(--accent); }
	@media (hover: hover) { .songs a:hover { background: var(--surface-3); } }
	.song-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
	.song-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: 11.5px; }
	.dx { margin-right: 6px; padding: 0 4px; border-radius: 3px; background: #2a3a55; color: #ffd36b; font-size: 10px; }
	.empty-search { padding: 20px 10px; color: var(--text-3); font-size: 13px; text-align: center; }
	h2 { margin: 2px 0 2px; font-size: 19px; line-height: 1.35; overflow-wrap: anywhere; }
	h3 { margin: 22px 0 8px; color: var(--text-3); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
	.artist { margin: 0; color: var(--text-2); font-size: 13px; }
	.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 16px 0 0; }
	.meta div { min-width: 0; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
	.meta dt { color: var(--text-3); font-size: 11px; }
	.meta dd { margin: 1px 0 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
	.legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--text-2); }
	.legend li { display: flex; align-items: center; gap: 8px; }
	.swatch { flex: none; width: 14px; height: 14px; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch) 30%, transparent); }
	.legend li:last-child .swatch { border: 2px solid white; box-shadow: none; }
	details { margin-top: 18px; padding: 10px 12px; border: 1px solid #5a3d1d; border-radius: 8px; background: #23180d; color: #ffbd78; font-size: 12px; overflow-wrap: anywhere; }
	summary { cursor: pointer; font-weight: 600; }
	details ul { margin: 8px 0 0; padding-left: 18px; max-height: 200px; overflow: auto; }
	.hint { margin: 18px 0 0; color: var(--text-3); font-size: 12px; line-height: 1.6; }

	/* Stage */
	section { position: relative; flex: 1; min-width: 0; min-height: 0; display: grid; place-items: center; padding: 16px; background: radial-gradient(ellipse at 50% 45%, #111827 0%, var(--bg) 70%); user-select: none; -webkit-user-select: none; }
	section.split { grid-template-columns: repeat(var(--view-count), minmax(0, 1fr)); gap: 12px; }
	.viewer { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; place-items: center; }
	.split .viewer { border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--surface) 60%, transparent); }
	.view-tag { position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: 999px; background: #0009; color: var(--text-2); font-size: 11px; font-weight: 600; }
	.empty { margin: 0; padding: 14px 18px; border: 1px dashed var(--border-strong); border-radius: var(--radius); color: var(--text-2); font-size: 14px; }
	.timeline-scroll { position: absolute; inset: 0; z-index: 1; overflow-y: scroll; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: none; }
	.timeline-scroll::-webkit-scrollbar { display: none; }
	@media (pointer: fine) { .timeline-scroll { cursor: grab; } .timeline-scroll.dragging { cursor: grabbing; } }
	.timeline-content { width: 1px; pointer-events: none; }
	svg { display: block; width: 100%; height: 100%; min-height: 0; }

	/* Player */
	footer { position: relative; z-index: 3; min-height: 36px; padding: 6px 14px max(8px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--surface); }
	footer.collapsed::before { content: ''; position: absolute; top: -1px; left: 0; width: var(--progress); height: 2px; background: var(--accent); }
	.player-toggle { position: absolute; top: 2px; right: 4px; width: 32px; height: 32px; min-height: 0; }
	.timeline-bar { width: calc(100% - 30px); }
	.density { position: relative; height: 30px; margin-top: 4px; cursor: pointer; touch-action: none; }
	.density svg { height: 100%; }
	.playhead { stroke: var(--text); stroke-width: 1.5; }
	.density-tip { position: absolute; bottom: calc(100% + 6px); z-index: 4; display: grid; gap: 2px; padding: 6px 9px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-2); box-shadow: 0 8px 24px #0009; font-size: 12px; white-space: nowrap; pointer-events: none; }
	.density-tip span, .density-legend li { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
	.density-tip i, .density-legend i { width: 8px; height: 8px; border-radius: 2px; background: var(--swatch); }
	.density-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0 auto 0 0; padding: 0 0 0 8px; list-style: none; font-size: 11.5px; }
	.seek { display: block; width: 100%; height: 22px; margin: 0; background: transparent; appearance: none; cursor: pointer; --track: linear-gradient(to right, var(--accent) var(--progress), var(--surface-3) var(--progress)); }
	.seek::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: var(--track); }
	.seek::-moz-range-track { height: 6px; border-radius: 3px; background: var(--track); }
	.seek::-webkit-slider-thumb { width: 16px; height: 16px; margin-top: -5px; border: 3px solid var(--accent); border-radius: 50%; background: #fff; appearance: none; }
	.seek::-moz-range-thumb { width: 10px; height: 10px; border: 3px solid var(--accent); border-radius: 50%; background: #fff; }
	.controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
	.play { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: var(--accent); color: var(--accent-ink); }
	@media (hover: hover) { .play:not(:disabled):hover { background: #8de9ff; } }
	.play .icon { width: 22px; height: 22px; }
	output { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
	output span { color: var(--text-3); font-weight: 500; }
	.rate { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; }
	.speeds-toggle[aria-expanded='true'] { border-color: var(--accent); color: var(--accent); }
	.speed-panel { position: absolute; right: 10px; bottom: calc(100% + 8px); width: min(360px, calc(100vw - 20px)); max-height: 60dvh; overflow-y: auto; display: grid; gap: 10px; padding: 14px; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--surface-2); box-shadow: 0 16px 40px #000a; }
	.speed-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; font-size: 13px; }
	.speed-head span { color: var(--text-3); font-size: 11.5px; }
	.view-speeds { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 8px 10px 10px; border: 1px solid var(--border); border-radius: 10px; }
	.view-speeds legend { padding-inline: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; }
	.stepper { display: grid; grid-template-columns: 1fr 40px 84px 40px; align-items: center; gap: 6px; font-size: 13px; }
	.stepper button { min-height: 36px; padding: 0; font-size: 18px; }
	.stepper select { text-align: center; }
	.segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.segmented.four { grid-template-columns: repeat(4, 1fr); }
	.segmented button { min-height: 32px; font-size: 13px; }
	.segmented button[aria-checked='true'] { border-color: var(--accent); color: var(--accent); }

	@media (max-width: 720px) {
		/* The pane opens as a bottom sheet here, so a sidebar glyph would mislead. */
		.icon-panel { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 6h11M4 11h11M4 16h6M19 4.5v11'/%3E%3Ccircle cx='16.5' cy='16' r='2.5'/%3E%3C/svg%3E"); }
		[aria-expanded='true'] > .icon-panel { --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E"); }
		:global(:root) { --tap: 44px; }
		nav { flex-wrap: wrap; gap: 4px 6px; padding-right: 10px; }
		h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
		.now-playing { flex: 1; padding-left: 0; border-left: 0; }
		.view-switch { order: 1; width: 100%; margin: 0 0 0 2px; }
		.view-switch button { flex: 1; min-height: 34px; padding-inline: 4px; }
		section { padding: 8px; }
		section.split { grid-template-columns: minmax(0, 1fr); grid-template-rows: repeat(var(--view-count), minmax(0, 1fr)); gap: 8px; }
		aside { position: absolute; bottom: 0; left: 0; z-index: 3; width: 100%; height: min(85%, 640px); padding-top: 14px; border: 1px solid var(--border-strong); border-bottom: 0; border-radius: 18px 18px 0 0; box-shadow: 0 -16px 48px #000b; animation: sheet-in .22s cubic-bezier(.2, .8, .2, 1); }
		aside::before { content: ''; position: absolute; top: 6px; left: 50%; width: 36px; height: 4px; translate: -50% 0; border-radius: 2px; background: var(--border-strong); }
		.tabs { margin-top: 6px; }
		.tabs button { min-height: 38px; }
		.backdrop { display: block; position: absolute; inset: 0; z-index: 2; width: 100%; max-width: none; border: 0; border-radius: 0; background: #000a; animation: fade-in .2s; }
		.search input, select { font-size: 16px; }
		.songs a { padding-block: 10px; }
		.song-name { font-size: 15px; }
		.density-legend { display: none; }
		output { margin-right: auto; }
		.rate span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
		.speeds-toggle { min-height: 40px; }
		.stepper { grid-template-columns: 1fr 44px 92px 44px; }
		.stepper button, .stepper select { min-height: 40px; }
	}
	@media (max-width: 360px) {
		.speeds-toggle { padding-inline: 10px; }
		output span { display: none; }
	}
	@keyframes sheet-in { from { translate: 0 40px; opacity: 0; } }
	@keyframes fade-in { from { opacity: 0; } }
	@media (prefers-reduced-motion: reduce) {
		aside, .backdrop { animation: none; }
	}
</style>
