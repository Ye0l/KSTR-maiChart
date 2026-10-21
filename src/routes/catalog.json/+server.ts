import { json } from '@sveltejs/kit';
import { listCharts } from '#lib/server/charts.ts';

export const prerender = true;

export const GET = async () => json(await listCharts());
