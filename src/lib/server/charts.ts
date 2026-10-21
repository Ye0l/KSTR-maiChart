import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, basename } from 'node:path';
import { readMaidata } from '../simai.ts';

export const root = resolve('Maichart-Converts');
// Utage charts are novelty remixes, so they get a version of their own instead of their release version.
export const utageVersion = '宴会場';
const utage = (id: string) => id.split(/[\\/]/)[0] === utageVersion;

async function scan() {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const songs = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name === 'maidata.txt').map(async (entry) => {
		const id = relative(root, resolve(entry.parentPath, entry.name));
		const text = await readFile(resolve(root, id), 'utf8');
		// Only the header matters here; chart bodies follow the first &inote_ field.
		const body = text.search(/^&inote_/m);
		const fields = readMaidata(body < 0 ? text : text.slice(0, body));
		// Difficulty 7 is the Utage (宴) chart.
		const levels = ['1', '2', '3', '4', '5', '6', '7'].flatMap((level) => fields[`lv_${level}`] ? [[level, fields[`lv_${level}`]] as [string, string]] : []);
		const designers = [...new Set(levels.map(([level]) => fields[`des_${level}`]?.trim()).concat(fields.des?.trim()).filter((name): name is string => !!name))];
		const bpm = Number(fields.wholebpm);
		return {
			id, title: basename(dirname(id)).replace(/^(\d+)_/, '$1 · ').replace(/_DX$/, ' [DX]'), version: utage(id) ? utageVersion : fields.version ?? '', levels,
			artist: fields.artist ?? '', bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined, designers
		};
	}));
	return songs.sort((a, b) => a.title.localeCompare(b.title, 'ja', { numeric: true }));
}

// The chart repository is a read-only submodule, so one scan serves the whole process.
let catalog: ReturnType<typeof scan> | undefined;
export function listCharts() {
	catalog ??= scan().catch((error) => {
		catalog = undefined;
		throw error;
	});
	return catalog;
}
