import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, basename } from 'node:path';
import { readMaidata } from '../simai.ts';

export const root = resolve('Maichart-Converts');
const coverRoot = resolve('SaltMeta/covers');

// The id modulo 10000 drops the SD/DX/宴 prefix and gives the shared SaltMeta cover number.
function coverId(dir: string) {
	const number = Number(dir.match(/^(\d+)_/)?.[1]);
	return Number.isFinite(number) ? String(number % 10000).padStart(6, '0') : undefined;
}

async function scan() {
	const covers = new Set(await readdir(coverRoot).catch(() => []));
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const songs = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name === 'maidata.txt').map(async (entry) => {
		const id = relative(root, resolve(entry.parentPath, entry.name));
		const text = await readFile(resolve(root, id), 'utf8');
		// Only the header matters here; chart bodies follow the first &inote_ field.
		const body = text.search(/^&inote_/m);
		const fields = readMaidata(body < 0 ? text : text.slice(0, body));
		const levels = ['1', '2', '3', '4', '5', '6'].flatMap((level) => fields[`lv_${level}`] ? [[level, fields[`lv_${level}`]] as [string, string]] : []);
		const dir = basename(dirname(id));
		const cover = coverId(dir);
		return { id, title: dir.replace(/^(\d+)_/, '$1 · ').replace(/_DX$/, ' [DX]'), version: fields.version ?? '', levels, cover: cover && covers.has(`${cover}.png`) ? cover : null };
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
