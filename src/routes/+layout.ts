import { resolve } from '$app/paths';
import type { LayoutLoad } from './$types';
import type { listCharts } from '#lib/server/charts.ts';

// A static shell: the catalog and charts are prerendered files fetched in the browser, so it runs on GitHub Pages.
export const prerender = true;
export const ssr = false;

// Kept out of the page load so switching charts does not refetch the whole catalog.
export const load: LayoutLoad = async ({ fetch }) => {
	const response = await fetch(resolve('/catalog.json'));
	return { songs: (await response.json()) as Awaited<ReturnType<typeof listCharts>> };
};
