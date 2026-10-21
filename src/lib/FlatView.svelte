<script lang="ts">
	import { onMount } from 'svelte';
	import { noteColor, type DisplayNote } from './presentation.ts';
	import { clamp, star } from './geometry.ts';

	let { notes, time, noteSpeed, touchSpeed }: {
		notes: DisplayNote[]; time: number; noteSpeed: number; touchSpeed: number;
	} = $props();
	const lanes = Array.from({ length: 8 }, (_, i) => i + 1);
	let canvas: SVGSVGElement | undefined;
	let viewport = $state({ width: 600, height: 600 });
	const unit = $derived(600 / Math.max(1, viewport.width));
	const viewHeight = $derived(viewport.height * unit);
	const top = $derived(Math.min(24, viewport.height * .1) * unit);
	const hitY = $derived(Math.max(top + 16 * unit, viewHeight - 64 * unit));
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
	const x = (id: string) => 40 + ((id.startsWith('C') ? 4.5 : Number(id.at(-1))) - .5) * 65;
	const y = (at: number, note: DisplayNote) => hitY - (at - time) / approach(note) * (hitY - top);
	const visible = $derived(notes.filter((note) => note.time - approach(note) <= time && time <= note.time + note.wait + note.duration + .18));
</script>

<svg bind:this={canvas} viewBox={`0 0 600 ${viewHeight}`} style:--unit={unit} role="img" aria-label="평면 차트 재생 화면" data-view="flat">
	<defs><clipPath id="flat-playfield"><rect x="40" y={top} width="520" height={hitY - top + 8 * unit} /></clipPath></defs>
	<rect x="40" y={top} width="520" height={hitY - top + 8 * unit} fill="#0d1019" />
	{#each lanes as lane}
		<rect x={40 + (lane - 1) * 65} y={top} width="65" height={hitY - top + 8 * unit} fill={lane % 2 ? '#151c2a' : '#101622'} />
		<line x1={40 + (lane - 1) * 65} y1={top} x2={40 + (lane - 1) * 65} y2={hitY} stroke="#303a4e" />
		<text class="lane-label" x={x(String(lane))} y={hitY + 22 * unit} data-lane={lane}>{lane}</text>
	{/each}
	<line x1="40" y1={hitY} x2="560" y2={hitY} stroke="#bdc9df" stroke-width="3" />
	<g clip-path="url(#flat-playfield)">
		<!-- shortcut: SLIDE paths are reduced to start/wait/end, not spatial trajectories. -->
		{#each visible.filter((note) => note.kind === 'slide') as note}
			{@const start = note.segments[0].start}
			{@const end = note.segments.at(-1)!.end}
			{@const finish = note.time + note.wait + note.duration}
			<g data-kind="slide" data-time={note.time} data-position={note.position} data-end={end}>
				<polyline points={`${x(String(start))},${y(note.time, note)} ${x(String(start))},${y(note.time + note.wait, note)} ${x(String(end))},${y(finish, note)}`} fill="none" stroke={noteColor(note)} stroke-width="5" opacity=".7" />
				<circle cx={x(String(end))} cy={y(finish, note)} r="9" fill="#101522" stroke={noteColor(note)} stroke-width="3" />
			</g>
		{/each}
		{#each visible.filter((note) => note.kind !== 'slide') as note}
			{@const touch = note.kind.startsWith('touch')}
			{@const head = Math.min(hitY, y(note.time, note))}
			{@const tail = Math.min(hitY, y(note.time + note.duration, note))}
			{@const holding = note.duration > 0 && time >= note.time && time < note.time + note.duration}
			<g data-kind={note.kind} data-time={note.time} data-position={note.position} opacity={time > note.time && !holding ? clamp(1 - (time - note.time) / .18) : 1}>
				{#if note.duration > 0}
					<rect class="hold-body" x={x(note.position) - 16} y={tail} width="32" height={Math.max(0, head - tail)} fill={noteColor(note)} opacity=".45" />
					<rect x={x(note.position) - 24} y={tail - 4} width="48" height="8" rx="3" fill={noteColor(note)} />
				{/if}
				{#if note.kind === 'star'}
					<polygon points={star({ x: x(note.position), y: head }, 18)} fill={noteColor(note)} stroke={note.ex ? 'white' : '#102b43'} stroke-width="2" />
				{:else}
					<rect class="note-head" x={x(note.position) - 25} y={head - 7} width="50" height="14" rx={touch ? 7 : 3} fill={noteColor(note)} stroke={note.ex ? 'white' : '#101522'} stroke-width="2" />
				{/if}
				{#if touch}<text x={x(note.position)} y={head - 12 * unit}>{note.position}</text>{/if}
			</g>
		{/each}
	</g>
	<text x="300" y={hitY + 40 * unit}>SLIDE: 시작 → 끝</text>
	<text x="300" y={hitY + 56 * unit}>중앙 TOUCH: 4/5 사이</text>
</svg>

<style>
	svg { display: block; width: 100%; height: 100%; min-height: 0; }
	text { fill: #9da9be; font: calc(12px * var(--unit)) system-ui, sans-serif; text-anchor: middle; }
	.lane-label { fill: #e1e6f0; font-size: calc(16px * var(--unit)); font-weight: 600; }
</style>
