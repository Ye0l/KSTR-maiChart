import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import type { EntryGenerator, RequestHandler } from './$types';
import { listCharts, root } from '#lib/server/charts.ts';

export const prerender = true;

// Charts are addressed by catalog position, so static file names never carry the repository's special characters.
export const entries: EntryGenerator = async () => (await listCharts()).map((_, index) => ({ index: String(index) }));

export const GET: RequestHandler = async ({ params }) => {
	const song = (await listCharts())[Number(params.index)];
	if (!song) error(404, '차트를 찾을 수 없습니다.');
	return new Response(await readFile(resolve(root, song.id), 'utf8'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
