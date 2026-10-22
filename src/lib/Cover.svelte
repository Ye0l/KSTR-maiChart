<script lang="ts">
	import { asset } from '$app/paths';

	let { cover, size, alt = '' }: { cover: string; size: number; alt?: string } = $props();

	// Covers are generated before dev/build, so their names are outside SvelteKit's static-asset type union.
	const coverUrl = (ext: 'webp' | 'jpg') => asset(`covers/${cover}.${ext}` as Parameters<typeof asset>[0]);
</script>

<picture>
	<source srcset={coverUrl('webp')} type="image/webp" />
	<img src={coverUrl('jpg')} {alt} width={size} height={size} loading="lazy" decoding="async" />
</picture>

<style>
	picture { display: contents; }
	img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
