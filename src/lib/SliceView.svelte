<script lang="ts">
	import { onMount } from 'svelte';
	import { clamp, pathData, position, star } from './geometry.ts';
	import { handPath, sliceIndex, sliceInstants, sliceLabel, sliceSlot, slotFrame, squash, type SliceNote } from './slices.ts';

	let { notes, time, tempo, count, length }: {
		notes: SliceNote[]; time: number; tempo: { time: number; bpm: number }[]; count: number; length: number;
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
	const slices = $derived(sliceInstants(notes, tempo, length));
	const current = $derived(sliceIndex(tempo, time, length));
	// Back slices first so the nearer, larger discs sit in front; the slice just finished slides out below.
	const shown = $derived.by(() => {
		const list = [];
		for (let index = current + count; index >= current - 1; index--) {
			const slot = sliceSlot(index, tempo, time, length);
			if (slot <= -1 || slot >= count) continue;
			const fade = slot < 0 ? 1 + slot : (1 - .12 * slot) * clamp(count - slot);
			const instants = slices.get(index) ?? [];
			list.push({ index, slot, fade, instants, frame: slotFrame(slot, viewHeight, count), notes: instants.reduce((sum, instant) => sum + instant.items.length, 0) });
		}
		return list;
	});
	const plane = (frame: { rx: number; y: number }) => {
		const k = frame.rx / 292;
		return `matrix(${k} 0 0 ${k * squash} ${300 - 300 * k} ${frame.y - 300 * k * squash})`;
	};
	// Earlier instants in a slice are brighter so the order reads at a glance; hit ones dim.
	const instantOpacity = (instants: { time: number }[], i: number) => {
		if (instants[i].time < time - .05) return .22;
		return instants.length > 1 ? 1 - .55 * i / (instants.length - 1) : 1;
	};
</script>

<div class="frame">
<svg bind:this={canvas} viewBox={`0 0 600 ${viewHeight}`} role="img" aria-label="시간 단면 차트 재생 화면" data-view="slice">
	{#each shown as { index, slot, fade, instants, frame, notes: total } (index)}
		<g class="slice" data-index={index} data-slot={slot} data-notes={total} opacity={fade}>
			<g transform={plane(frame)}>
				<!-- Discs stay unfilled so no slice hides the one behind it. -->
				<circle cx="300" cy="300" r="254" fill="#8790a7" fill-opacity=".04" stroke="#8790a7" stroke-width="3" vector-effect="non-scaling-stroke" />
				<circle cx="300" cy="300" r="20" fill="none" stroke="#46526b" stroke-width="1" vector-effect="non-scaling-stroke" />
				{#each buttons as button}
					{@const target = position(button)}
					<circle cx={target.x} cy={target.y} r="16" fill="#2a3246" />
					<text x={target.x} y={target.y + 6} text-anchor="middle" fill="#9da9be" font-size="18" font-weight="700">{button}</text>
				{/each}
				{#each instants as instant, i}
					{#each instant.items.filter((item) => item.kind === 'slide') as item}
						{#each item.note.paths as points}
							<path d={pathData(points)} fill="none" stroke={item.color} stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" opacity={.55 * instantOpacity(instants, i)} />
						{/each}
					{/each}
				{/each}
				{#each handPath(instants, position) as line}
					<line class="hand-path" x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke="#dbe3f3" stroke-width="5" stroke-linecap="round" opacity={.55 * instantOpacity(instants, line.order)} />
				{/each}
				{#each instants as instant, i}
					<g class="instant" data-time={instant.time} opacity={instantOpacity(instants, i)}>
						{#each instant.items as item}
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
				{/each}
			</g>
			<text class="label" x="10" y={frame.y - 2}>{sliceLabel(index, length)}</text>
			<text class="label count" x="10" y={frame.y + 13}>{total ? `${total}노트` : '쉼'}</text>
		</g>
	{/each}
	<text x="300" y={viewHeight - 10} text-anchor="middle" fill="#9da9be" font-size="12">TIME SLICE · 맨 아래 = 지금 구간 · 선 = 순서대로 손 이동(진할수록 먼저)</text>
</svg>
</div>

<style>
	.frame { width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; place-items: center; container-type: size; }
	/* Slices stack vertically, so keep the canvas at least portrait-shaped. */
	svg { display: block; width: 100%; height: 100%; max-width: 75cqh; min-width: 0; min-height: 0; }
	.label { fill: #c8d2e6; font: 600 13px system-ui, sans-serif; }
	.label.count { fill: #75819b; font-weight: 400; font-size: 11px; }
</style>
