<script lang="ts">
	import { onMount } from 'svelte';
	import { clamp, pathData, position, star } from './geometry.ts';
	import { beatAt } from './press.ts';
	import { gapLabel, sliceMoments, sliceProgress, slotFrame, squash, type SliceNote } from './slices.ts';

	let { notes, time, tempo, count }: {
		notes: SliceNote[]; time: number; tempo: { time: number; bpm: number }[]; count: number;
	} = $props();
	const buttons = Array.from({ length: 8 }, (_, i) => String(i + 1));
	let canvas: SVGSVGElement | undefined;
	let viewport = $state({ width: 600, height: 900 });
	const viewHeight = $derived(Math.max(480, 600 * viewport.height / viewport.width));
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
	const slices = $derived(sliceMoments(notes));
	const times = $derived(slices.map((slice) => slice.time));
	const progress = $derived(sliceProgress(times, time, tempo));
	// Back slices first so the nearer, larger discs sit in front.
	const shown = $derived.by(() => {
		const list = [];
		for (let i = Math.max(0, Math.floor(progress)); i < slices.length && i - progress < count; i++) {
			const slot = i - progress;
			const passed = time - slices[i].time;
			if (slot < 0 && passed > .18) continue;
			const fade = slot < 0 ? clamp(1 - passed / .18) : (1 - .12 * slot) * clamp(count - slot);
			const gap = i > 0 ? gapLabel(slices[i].time - slices[i - 1].time, 60 / beatAt(tempo, slices[i].time)) : undefined;
			list.push({ slice: slices[i], slot, fade, gap, frame: slotFrame(slot, viewHeight, count) });
		}
		return list.reverse();
	});
	const plane = (frame: { rx: number; ry: number; y: number }) => {
		const k = frame.rx / 292;
		return `matrix(${k} 0 0 ${k * squash} ${300 - 300 * k} ${frame.y - 300 * k * squash})`;
	};
</script>

<div class="frame">
<svg bind:this={canvas} viewBox={`0 0 600 ${viewHeight}`} role="img" aria-label="시간 단면 차트 재생 화면" data-view="slice">
	{#each shown as { slice, slot, fade, gap, frame } (slice.time)}
		<g class="slice" data-time={slice.time} data-slot={slot} opacity={fade}>
			<g transform={plane(frame)}>
				<!-- Discs stay unfilled so no slice hides the one behind it. -->
				<circle cx="300" cy="300" r="254" fill="#8790a7" fill-opacity=".04" stroke="#8790a7" stroke-width="3" vector-effect="non-scaling-stroke" />
				<circle cx="300" cy="300" r="20" fill="none" stroke="#46526b" stroke-width="1" vector-effect="non-scaling-stroke" />
				{#each buttons as button}
					{@const target = position(button)}
					<circle cx={target.x} cy={target.y} r="16" fill="#2a3246" />
					<text x={target.x} y={target.y + 6} text-anchor="middle" fill="#9da9be" font-size="18" font-weight="700">{button}</text>
				{/each}
				{#each slice.items.filter((item) => item.kind === 'slide') as item}
					{#each item.note.paths as points}
						<path d={pathData(points)} fill="none" stroke={item.color} stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" opacity=".55" />
					{/each}
				{/each}
				{#each slice.items as item}
					{@const target = position(item.position)}
					<g class="slice-note" data-kind={item.kind} data-position={item.position}>
						{#if item.kind === 'star'}
							<polygon points={star(target, 32)} fill={item.color} stroke={item.note.ex ? 'white' : '#102b43'} stroke-width="4" />
						{:else if item.kind === 'slide'}
							<polygon points={star(target, 32)} fill="#101522" stroke={item.color} stroke-width="7" />
						{:else if item.kind === 'touch' || item.kind === 'touchHold'}
							<circle cx={target.x} cy={target.y} r="26" fill="none" stroke={item.color} stroke-width="7" />
							<circle cx={target.x} cy={target.y} r="10" fill={item.color} />
							{#if item.kind === 'touchHold'}<circle cx={target.x} cy={target.y} r="36" fill="none" stroke={item.color} stroke-width="3" />{/if}
						{:else}
							<circle cx={target.x} cy={target.y} r="26" fill="#101522" stroke={item.color} stroke-width="10" />
							{#if item.kind === 'hold'}
								<circle cx={target.x} cy={target.y} r="38" fill="none" stroke={item.color} stroke-width="4" />
								<circle cx={target.x} cy={target.y} r="8" fill={item.color} />
							{/if}
						{/if}
						{#if item.note.ex && item.kind !== 'star'}<circle cx={target.x} cy={target.y} r="32" fill="none" stroke="white" stroke-width="3" />{/if}
					</g>
				{/each}
			</g>
			{#if gap}
				<text class="gap" x="10" y={frame.y - 2}>{gap.note || gap.ms}</text>
				{#if gap.note}<text class="gap ms" x="10" y={frame.y + 13}>{gap.ms}</text>{/if}
			{/if}
		</g>
	{/each}
	<text x="300" y={viewHeight - 10} text-anchor="middle" fill="#9da9be" font-size="12">TIME SLICE · 아래부터 다음 입력 순서 · 왼쪽 = 이전 단면과의 간격</text>
</svg>
</div>

<style>
	.frame { width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; place-items: center; container-type: size; }
	/* Slices stack vertically, so keep the canvas at least portrait-shaped. */
	svg { display: block; width: 100%; height: 100%; max-width: 75cqh; min-width: 0; min-height: 0; }
	.gap { fill: #c8d2e6; font: 600 13px system-ui, sans-serif; }
	.gap.ms { fill: #75819b; font-weight: 400; font-size: 11px; }
</style>
