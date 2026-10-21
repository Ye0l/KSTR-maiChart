import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, basename } from 'node:path';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const root = resolve('Maichart-Converts');
async function listCharts() {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries.filter((entry) => entry.isFile() && entry.name === 'maidata.txt').map((entry) => {
		const id = relative(root, resolve(entry.parentPath, entry.name));
		return { id, title: basename(dirname(id)).replace(/^(\d+)_/, '$1 · ').replace(/_DX$/, ' [DX]') };
	}).sort((a, b) => a.title.localeCompare(b.title, 'ja', { numeric: true }));
}

export const load: PageServerLoad = async ({ url }) => {
	const songs = await listCharts();
	if (!songs.length) error(404, 'Maichart-Converts에 maidata.txt가 없습니다.');
	const selected = url.searchParams.get('chart') ?? songs.find((song) => song.id.includes('10021_'))?.id ?? songs[0].id;
	// Only paths discovered in the chart repository may be read.
	if (!songs.some((song) => song.id === selected)) error(404, '차트를 찾을 수 없습니다.');
	return { songs, selected, text: await readFile(resolve(root, selected), 'utf8') };
};
