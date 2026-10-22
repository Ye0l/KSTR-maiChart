// SaltMeta ships PNG covers; browsers get WebP with a JPEG fallback. Run before dev/build.
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const source = 'SaltMeta/covers';
const target = 'static/covers';
const concurrency = 8;

const files = await readdir(source).catch(() => {
	console.warn(`${source}가 없어 자켓 변환을 건너뜁니다.`);
	process.exit(0);
});

async function convert(args) {
	return new Promise((resolve, reject) => {
		const child = spawn('convert', args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let error = '';
		child.stderr.on('data', (chunk) => { error += chunk; });
		child.on('error', (cause) => reject(new Error(`ImageMagick(convert)를 실행할 수 없습니다: ${cause.message}`)));
		child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `convert exited with ${code}`)));
	});
}

const stale = async (file) => {
	const input = join(source, file);
	const webp = join(target, `${file.slice(0, -4)}.webp`);
	const jpeg = join(target, `${file.slice(0, -4)}.jpg`);
	const sourceStat = await stat(input);
	const [webpStat, jpegStat] = await Promise.all([stat(webp).catch(() => null), stat(jpeg).catch(() => null)]);
	if (webpStat?.mtimeMs >= sourceStat.mtimeMs && jpegStat?.mtimeMs >= sourceStat.mtimeMs) return;
	return async () => {
		await convert([input, '-quality', '82', '-strip', webp]);
		await convert([input, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-quality', '82', '-strip', jpeg]);
	};
};

await mkdir(target, { recursive: true });
const pending = await Promise.all(files.filter((file) => file.endsWith('.png')).map(stale));
const jobs = pending.filter(Boolean);
let next = 0;
async function worker() {
	while (next < jobs.length) await jobs[next++]();
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (jobs.length) console.log(`자켓 ${jobs.length}개를 WebP/JPEG로 변환했습니다.`);
