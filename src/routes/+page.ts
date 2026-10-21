import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch, parent }) => {
	const { songs } = await parent();
	if (!songs.length) error(404, 'Maichart-Converts에 maidata.txt가 없습니다.');
	const selected = url.searchParams.get('chart') ?? songs.find((song) => song.id.includes('10021_'))?.id ?? songs[0].id;
	// Only charts listed in the catalog may be read.
	const index = songs.findIndex((song) => song.id === selected);
	if (index < 0) error(404, '차트를 찾을 수 없습니다.');
	const response = await fetch(resolve('/charts/[index].txt', { index: String(index) }));
	if (!response.ok) error(response.status, '차트를 불러오지 못했습니다.');
	return { selected, text: await response.text() };
};
