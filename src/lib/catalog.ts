import type { listCharts } from './server/charts.ts';

export type CatalogSong = Awaited<ReturnType<typeof listCharts>>[number];

export const difficultyNames = ['EASY', 'BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER', 'UTAGE'];
export const difficultyColors = ['#4ea6ff', '#4cd964', '#ffc23d', '#ff6b81', '#b77cff', '#e9d4ff', '#ff7ad9'];
// Utage songs file their charts under slot 7, or under 2 and 3 for paired charts; none of them are BASIC etc.
export const isUtage = (id: string) => id.startsWith('宴会場/');
export const difficultyName = (level: string, utage: boolean, levels: string[]) =>
	utage ? (levels.length > 1 ? `UTAGE ${levels.indexOf(level) + 1}` : 'UTAGE') : difficultyNames[Number(level) - 1] ?? level;
export const difficultyColor = (level: string, utage: boolean) => difficultyColors[utage ? 6 : Number(level) - 1];
// Jacket placeholder tint: a stable hue per genre.
export const genreHue = (genre: string) => [...genre].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;

const versionOrder = ['', ' PLUS', ' GreeN', ' GreeN PLUS', ' ORANGE', ' ORANGE PLUS', ' PiNK', ' PiNK PLUS', ' MURASAKi', ' MURASAKi PLUS', ' MiLK', ' MiLK PLUS', ' FiNALE',
	' DX', ' DX PLUS', ' DX Splash', ' DX Splash PLUS', ' DX UNiVERSE', ' DX UNiVERSE PLUS', ' DX FESTiVAL', ' DX FESTiVAL PLUS', ' DX BUDDiES', ' DX BUDDiES PLUS',
	' DX PRiSM', ' DX PRiSM PLUS', ' DX CiRCLE', ' DX CiRCLE PLUS'].map((name) => `maimai${name}`);
// Utage (宴会場) charts are filed apart from the release versions, at the end.
export const versionRank = (version: string) => version === '宴会場' ? versionOrder.length + 1 : versionOrder.includes(version) ? versionOrder.indexOf(version) : versionOrder.length;
export const versionName = (version: string) => version.replace(/^maimai (?=.)/, '');

// Chart constants group the way the game shows them: x.0–x.6 is "x", x.7–x.9 is "x+"; a trailing "?" marks an estimate.
export const levelLabel = (value: string) => {
	const match = /^(\d+)(\+)?(?:\.(\d))?/.exec(value);
	if (!match) return value;
	return match[2] || Number(match[3] ?? 0) >= 7 ? `${match[1]}+` : match[1];
};
export const levelRank = (label: string) => parseFloat(label) + (label.endsWith('+') ? .5 : 0);

export function describeSong(song: CatalogSong) {
	const match = /^(\d+) · (.*?)( \[DX\])?$/.exec(song.title);
	return { ...song, name: song.name ?? match?.[2] ?? song.title, number: match?.[1], dx: !!match?.[3], genre: song.id.split('/')[0] };
}
export type Song = ReturnType<typeof describeSong>;

export type SortKey = 'title' | 'number' | 'version' | 'level' | 'bpm';
export const sortKeys: [SortKey, string][] = [['title', '이름'], ['number', '번호'], ['version', '버전'], ['level', '레벨'], ['bpm', 'BPM']];
export const slotOptions = [['2', 'BASIC'], ['3', 'ADVANCED'], ['4', 'EXPERT'], ['5', 'MASTER'], ['6', 'Re:MASTER'], ['7', 'UTAGE']];

export type Criteria = {
	search: string; level: string; version: string; slot: string; genre: string; kind: '' | 'dx' | 'sd';
	bpmMin: number | null; bpmMax: number | null; sort: SortKey; desc: boolean;
};

export function findSongs(songs: Song[], criteria: Criteria) {
	const { search, level, version, slot, genre, kind, bpmMin, bpmMax, sort, desc } = criteria;
	const query = search.trim().toLowerCase();
	const list = songs.flatMap((song) => {
		if (query && ![song.name, song.title, song.artist, ...song.designers].some((text) => text.toLowerCase().includes(query))) return [];
		if (version && song.version !== version) return [];
		if (genre && song.genre !== genre) return [];
		if (kind && song.dx !== (kind === 'dx')) return [];
		if ((bpmMin != null && !(song.bpm! >= bpmMin)) || (bpmMax != null && !(song.bpm! <= bpmMax))) return [];
		// Difficulty and level narrow which charts of the song count; Utage keeps its charts in slots 2/3 or 7.
		const charts = song.levels.filter(([at, value]) => (!slot || at === slot || (slot === '7' && isUtage(song.id))) && (!level || levelLabel(value) === level));
		if ((slot || level) && !charts.length) return [];
		const top = Math.max(-Infinity, ...charts.map(([, value]) => parseFloat(value)).filter(Number.isFinite));
		return [{ ...song, matches: slot || level ? charts : [], top }];
	});
	const value = (song: (typeof list)[number]) => sort === 'number' ? Number(song.number ?? Infinity) : sort === 'version' ? versionRank(song.version)
		: sort === 'level' ? song.top : sort === 'bpm' ? song.bpm ?? -Infinity : 0;
	if (sort === 'title') return desc ? list.reverse() : list;
	// Songs missing the sorted value go last either way; ties keep the name order.
	return list.sort((a, b) => {
		const [x, y] = [value(a), value(b)];
		if (!Number.isFinite(x) || !Number.isFinite(y)) return Number(!Number.isFinite(x)) - Number(!Number.isFinite(y));
		return desc ? y - x : x - y;
	});
}
