<script lang="ts">
	import { onMount } from 'svelte';
	import SensorLayout from './SensorLayout.svelte';
	import { chevrons, clamp, distance, pathData, position, star, trace, type Point } from './geometry.ts';
	import { noteColor, type DisplayNote } from './presentation.ts';
	import { beatsBetween, dropDistance, fallHeight, planeTransform, project, projectSlide, sectorArc, timeOpacity } from './isometric.ts';
	import type { PressMark } from './press.ts';

	let { notes, time, noteSpeed, touchSpeed, tempo, marks }: {
		notes: (DisplayNote & { paths: Point[][] })[]; time: number; noteSpeed: number; touchSpeed: number;
		tempo: { time: number; bpm: number }[]; marks: PressMark[];
	} = $props();
	const buttons = Array.from({ length: 8 }, (_, i) => String(i + 1));
	let canvas: SVGSVGElement | undefined;
	let viewport = $state({ width: 600, height: 720 });
	const viewHeight = $derived(Math.max(360, 600 * viewport.height / viewport.width));
	const drop = $derived(dropDistance(viewHeight));
	const plane = (lift = 0) => planeTransform(lift, viewHeight);
	const projectPoint = (point: Point, lift = 0) => project(point, lift, viewHeight);
	onMount(() => {
		if (!canvas) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
				viewport = { width: entry.contentRect.width, height: entry.contentRect.height };
			}
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	});
	const approach = (note: DisplayNote) => 2 / (note.kind.startsWith('touch') ? touchSpeed : noteSpeed);
	const height = (at: number, note: DisplayNote) => fallHeight(at, time, approach(note), viewHeight);
	const visible = $derived(notes.filter((note) => note.time - approach(note) <= time && time <= note.time + note.wait + note.duration + .18));
	const heads = $derived(visible.filter((note) => note.kind !== 'slide').sort((a, b) => projectPoint(position(a.position)).y - projectPoint(position(b.position)).y));
	const guides = $derived.by(() => {
		const byHeight = new Map<number, { lead: DisplayNote; notes: DisplayNote[] }>();
		for (const note of heads) {
			const lift = height(note.time, note);
			const guide = byHeight.get(lift);
			if (!guide) byHeight.set(lift, { lead: note, notes: [note] });
			else {
				guide.notes.push(note);
				if (note.break) guide.lead = note;
			}
		}
		// The center sensors have no direction, so only off-center notes thicken their sector.
		return [...byHeight].map(([lift, { lead, notes }]) => ({
			lift, color: noteColor(lead), notes: notes.filter((note) => distance(position(note.position), { x: 300, y: 300 }) > 60)
		}));
	});
	// Beat rungs share the button-note fall rate so they move with the notes they measure.
	const rungs = $derived(beatsBetween(tempo, time, time + 2 / noteSpeed).map((beat) => ({ ...beat, lift: fallHeight(beat.time, time, 2 / noteSpeed, viewHeight) })));
	const pending = $derived(heads.filter((note) => time < note.time));
	const leads = $derived.by(() => {
		const nearest = new Map<string, DisplayNote>();
		for (const note of pending) {
			if (!nearest.has(note.position) || note.time < nearest.get(note.position)!.time) nearest.set(note.position, note);
		}
		return [...nearest.values()];
	});
</script>

<div class="frame">
<svg bind:this={canvas} viewBox={`0 0 600 ${viewHeight}`} role="img" aria-label="Isometric 차트 재생 화면" data-view="isometric">
	<defs><clipPath id="iso-scene"><rect x="0" y="10" width="600" height={viewHeight - 30} /></clipPath></defs>
	<g clip-path="url(#iso-scene)">
		<g transform={plane()} data-plane="isometric">
			<circle cx="300" cy="300" r="292" fill="#161b27" stroke="#424b60" stroke-width="8" />
			<circle cx="300" cy="300" r="254" fill="#0d1019" stroke="#8790a7" stroke-width="2" />
			<SensorLayout quiet />
			{#each buttons as button}
				{@const target = position(button)}
				<circle cx={target.x} cy={target.y} r="15" fill="#3a4560" stroke="#8790a7" stroke-width="1.5" />
				<text x={target.x} y={target.y + 5} text-anchor="middle" fill="#e1e6f0" font-size="15" font-weight="700">{button}</text>
			{/each}
			{#each marks as mark}
				{@const target = position(mark.button)}
				<circle class="press-mark" data-button={mark.button} cx={target.x} cy={target.y} r="30" fill={mark.color} fill-opacity=".3" stroke={mark.color} stroke-width="4" opacity={mark.strength} pointer-events="none" />
			{/each}
		</g>
		<!-- Landing marks converge on the spot a note will hit. -->
		<g class="landing" transform={plane()}>
			{#each pending as note}
				{@const target = position(note.position)}
				{@const arriving = clamp(1 - (note.time - time) / approach(note))}
				<circle cx={target.x} cy={target.y} r="15" fill={noteColor(note)} opacity={.06 + .3 * arriving} />
				<circle cx={target.x} cy={target.y} r={36 - 20 * arriving} fill="none" stroke={noteColor(note)} stroke-width="3" opacity={.2 + .6 * arriving} />
			{/each}
		</g>
		{#each buttons as button}
			{@const base = projectPoint(position(button))}
			{@const top = projectPoint(position(button), drop)}
			<line x1={top.x} y1={top.y} x2={base.x} y2={base.y} stroke="#46526b" stroke-dasharray="2 8" opacity=".25" />
		{/each}
		{#each leads as note}
			{@const target = position(note.position)}
			{@const base = projectPoint(target)}
			{@const lift = height(note.time, note)}
			{@const head = projectPoint(target, lift)}
			<line class="lead" x1={base.x} y1={base.y} x2={head.x} y2={head.y} stroke={noteColor(note)} stroke-width="2" opacity={.5 * timeOpacity(lift, viewHeight)} />
		{/each}
		{#each rungs as rung}
			<circle class="beat-rung" cx="300" cy="300" r="254" transform={plane(rung.lift)} fill="none" stroke="#9fb0d0" stroke-width="1" vector-effect="non-scaling-stroke" opacity={rung.downbeat ? .24 : .1} pointer-events="none" />
		{/each}
		{#each guides as guide}
			<circle class="timing-ring" data-height={guide.lift} cx="300" cy="300" r="254" transform={plane(guide.lift)} fill="none" stroke={guide.color} stroke-width="1" vector-effect="non-scaling-stroke" opacity={.3 * timeOpacity(guide.lift, viewHeight)} pointer-events="none" />
			<g class="timing-sectors" transform={plane(guide.lift)} opacity={timeOpacity(guide.lift, viewHeight)} pointer-events="none">
				{#each guide.notes as note}
					{@const fade = time > note.time && !(note.duration > 0 && time < note.time + note.duration) ? clamp(1 - (time - note.time) / .18) : 1}
					{#each sectorArc(position(note.position)) as piece}
						<path d={piece.d} fill="none" stroke={noteColor(note)} stroke-width={1 + 6 * piece.weight} opacity={(.3 + .7 * piece.weight) * fade} vector-effect="non-scaling-stroke" />
					{/each}
				{/each}
			</g>
		{/each}
		{#each visible.filter((note) => note.kind === 'slide') as note}
			{@const start = note.time + note.wait}
			{@const finish = start + note.duration}
			{@const progress = note.duration ? clamp((time - start) / note.duration) : Number(time >= start)}
			<g data-kind="slide" data-time={note.time} data-position={note.position}>
				{#each note.paths as points}
					{@const marker = trace(points, progress).point}
					{@const waitingHead = projectPoint(points[0], height(note.time, note))}
					{@const waitingTail = projectPoint(points[0], height(start, note))}
					<path class="slide-ground" d={pathData(points)} transform={plane()} fill="none" stroke={noteColor(note)} stroke-width="2" opacity=".15" />
					<!-- The board track carries the maimai-style arrows; the lifted curve is only a faint timing hint. -->
					<g class="slide-track" transform={plane()} fill="none" stroke={noteColor(note)} stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity={time < note.time ? .4 : .95}>
						{#each chevrons(points, progress) as arrow}
							<path d="M-6,-9 L4,0 L-6,9" transform={`translate(${arrow.x},${arrow.y}) rotate(${arrow.angle})`} />
						{/each}
					</g>
					{#if time < start}
						<line x1={waitingHead.x} y1={waitingHead.y} x2={waitingTail.x} y2={waitingTail.y} stroke={noteColor(note)} stroke-dasharray="3 5" opacity=".3" />
					{/if}
					<path class="slide-time" d={pathData(projectSlide(points, start, note.duration, time, approach(note), viewHeight))} fill="none" stroke={noteColor(note)} stroke-width="1.5" opacity=".35" />
					{#if time >= note.time && time <= finish}
						<polygon points={star(marker, 20)} transform={plane()} fill={noteColor(note)} stroke="white" stroke-width="2" />
					{/if}
				{/each}
			</g>
		{/each}
		{#each heads as note}
			{@const target = position(note.position)}
			{@const lift = height(note.time, note)}
			{@const head = projectPoint(target, lift)}
			{@const tail = projectPoint(target, height(note.time + note.duration, note))}
			{@const touch = note.kind.startsWith('touch')}
			{@const hit = time >= note.time}
			{@const holding = note.duration > 0 && hit && time < note.time + note.duration}
			<g data-kind={note.kind} data-time={note.time} data-position={note.position} data-height={lift} opacity={hit && !holding ? clamp(1 - (time - note.time) / .18) : timeOpacity(lift, viewHeight)}>
				{#if note.duration > 0}
					<line class="hold-body" x1={head.x} y1={head.y} x2={tail.x} y2={tail.y} stroke={noteColor(note)} stroke-width="14" opacity=".45" />
					<g transform={plane(height(note.time + note.duration, note))}>
						<circle cx={target.x} cy={target.y} r="14" fill="#101522" stroke={noteColor(note)} stroke-width="4" />
					</g>
				{/if}
				<g class="note-plane" transform={plane(lift)}>
					{#if note.kind === 'star'}
						<polygon points={star(target, 18)} fill={noteColor(note)} stroke={note.ex ? 'white' : '#102b43'} stroke-width="3" />
					{:else}
						<circle class="note-disc" cx={target.x} cy={target.y} r={touch ? 20 : holding ? 18 : 14} fill="#101522" stroke={noteColor(note)} stroke-width={touch ? 4 : 6} />
						{#if touch}
							<circle cx={target.x} cy={target.y} r="7" fill={noteColor(note)} />
						{/if}
						{#if note.ex}<circle cx={target.x} cy={target.y} r="19" fill="none" stroke="white" stroke-width="2" />{/if}
					{/if}
					{#if hit && note.firework}
						<circle cx={target.x} cy={target.y} r={25 + clamp((time - note.time) / .18) * 30} fill="none" stroke="#ffdb4d" stroke-dasharray="3 6" stroke-width="5" />
					{/if}
				</g>
			</g>
		{/each}
	</g>
	<text x="300" y={viewHeight - 10} text-anchor="middle" fill="#9da9be" font-size="12">ISOMETRIC · 높이 = 판정까지 남은 시간</text>
</svg>
</div>

<style>
	/* Cap the width against the height so wide panels still leave a fall column above the board. */
	.frame { width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; place-items: center; container-type: size; }
	svg { display: block; width: 100%; height: 100%; max-width: 90cqh; min-width: 0; min-height: 0; }
</style>
