<script lang="ts">
	import { sensorCenter, sensorPoint, sensorPolygon, sensorScale } from './sensor-layout.ts';

	// Quiet mode keeps the outlines as faint context so notes stay the brightest layer.
	let { quiet = false }: { quiet?: boolean } = $props();

	const indices = Array.from({ length: 8 }, (_, i) => i + 1);
	const families = ['B', 'E'] as const;
	const points = (family: 'B' | 'E', index: number) => sensorPolygon(family, index).map(({ x, y }) => `${x},${y}`).join(' ');
</script>

<!-- Display outlines traced from the skin, not calibrated hardware hitboxes. -->
<g class="sensors" class:quiet aria-hidden="true" pointer-events="none">
	{#each indices as n}
		{@const a = sensorPoint(162, -391, n)}
		{@const d = sensorPoint(0, -440, n)}
		<g data-sensor={`A${n}`}>
			<path class="outer" d="M70,-477 L56,-336 L84,-308 L156,-280 L204,-280 L287,-387" transform={`translate(300,300) scale(${sensorScale}) rotate(${(n - 1) * 45})`} />
			<text x={a.x} y={a.y}>A{n}</text>
		</g>
		<g data-sensor={`D${n}`}><text x={d.x} y={d.y}>D{n}</text></g>
	{/each}
	{#each families as family}
		{#each indices as n}
			{@const label = sensorCenter(family, n)}
			<g data-sensor={`${family}${n}`}>
				<polygon points={points(family, n)} />
				<text x={label.x} y={label.y}>{family}{n}</text>
			</g>
		{/each}
	{/each}
	<!-- The official skin leaves the center open; keep only the sensor labels. -->
	<g data-sensor="C2"><text x="279" y="300">C2</text></g>
	<g data-sensor="C1"><text x="321" y="300">C1</text></g>
</g>

<style>
	.sensors { fill: #121824; stroke: #3c465a; stroke-width: 1.2; stroke-linejoin: round; }
	.outer { fill: none; stroke-dasharray: 2 5; stroke-width: 2; }
	.quiet { fill: #0f141f; stroke: #262e3f; }
	.quiet text { display: none; }
	text { fill: #707e97; stroke: none; font: 600 13px system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; }
</style>
