<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		difficultyColor, difficultyName, findSongs, isUtage, levelLabel, levelRank, slotOptions, sortKeys, versionName, versionRank,
		type Criteria, type Song
	} from './catalog.ts';

	let { songs, selected, open = $bindable(false), onpick }: {
		songs: Song[]; selected: string; open: boolean; onpick: (difficulty?: string) => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined;
	let grid: HTMLUListElement | undefined = $state();
	let sentinel: HTMLLIElement | undefined = $state();
	let searchInput: HTMLInputElement | undefined = $state();
	let criteria = $state<Criteria>({ search: '', level: '', version: '', slot: '', genre: '', kind: '', bpmMin: null, bpmMax: null, sort: 'title', desc: false });
	let moreFilters = $state(false);
	const versions = $derived([...new Set(songs.map((song) => song.version).filter(Boolean))].sort((a, b) => versionRank(a) - versionRank(b) || a.localeCompare(b)));
	const levels = $derived([...new Set(songs.flatMap((song) => song.levels.map(([, value]) => levelLabel(value))))].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b)));
	const genres = $derived([...new Set(songs.map((song) => song.genre))]);
	const found = $derived(findSongs(songs, criteria));
	const extraFilters = $derived(+!!criteria.slot + +!!criteria.genre + +!!criteria.kind + +(criteria.bpmMin != null) + +(criteria.bpmMax != null));
	const filtering = $derived(!!(criteria.search || criteria.level || criteria.version || extraFilters));
	function clearFilters() {
		criteria = { ...criteria, search: '', level: '', version: '', slot: '', genre: '', kind: '', bpmMin: null, bpmMax: null };
	}

	// Cards render in pages as the grid scrolls; 1800 songs at once would stall opening the picker.
	const page = 90;
	let limit = $state(page);
	$effect(() => {
		found;
		limit = page;
	});
	$effect(() => {
		if (!sentinel || !grid) return;
		const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) limit += page; }, { root: grid, rootMargin: '600px' });
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			void reveal();
		} else if (!open && dialog.open) dialog.close();
	});
	// Open on the current song, scrolled into view; the search box only takes focus where a keyboard is likely.
	async function reveal() {
		const index = found.findIndex((song) => song.id === selected);
		if (index >= limit) limit = index + page;
		await tick();
		grid?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
		if (matchMedia('(hover: hover)').matches) searchInput?.focus();
	}

	onMount(() => {
		try {
			const sort = JSON.parse(localStorage.getItem('maichart.sort') ?? '{}');
			if (sortKeys.some(([key]) => key === sort?.key)) criteria.sort = sort.key;
			criteria.desc = sort?.desc === true;
		} catch {
			// Invalid or inaccessible storage keeps the default order.
		}
	});
	$effect(() => {
		const sort = JSON.stringify({ key: criteria.sort, desc: criteria.desc });
		try {
			localStorage.setItem('maichart.sort', sort);
		} catch {
			// Storage may be blocked; the order still applies for this visit.
		}
	});

	// Stand-in jacket until thumbnails exist: a tint per genre and the title's first letter.
	const hue = (genre: string) => [...genre].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
</script>

<dialog bind:this={dialog} id="song-picker" class="picker" aria-labelledby="picker-title" onclose={() => open = false}>
	<header>
		<h2 id="picker-title">곡 선택</h2>
		<label class="search">
			<span class="sr-only">곡 검색</span>
			<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
			<input bind:this={searchInput} id="search" type="search" placeholder="곡명·ID·아티스트·보면 제작자" aria-label="곡 검색" autocomplete="off" bind:value={criteria.search} />
		</label>
		<button id="picker-close" class="close" aria-label="곡 선택 닫기" onclick={() => open = false}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
		</button>
	</header>
	<div class="toolbar">
		<div class="filters">
			<select aria-label="레벨 필터" bind:value={criteria.level}>
				<option value="">레벨 전체</option>
				{#each levels as level}<option value={level}>Lv {level}</option>{/each}
			</select>
			<select aria-label="버전 필터" bind:value={criteria.version}>
				<option value="">버전 전체</option>
				{#each versions as version}<option value={version}>{versionName(version)}</option>{/each}
			</select>
			<button id="more-filters" class="ghost" aria-expanded={moreFilters} aria-controls="extra-filters" onclick={() => moreFilters = !moreFilters}>
				상세 필터{extraFilters ? ` · ${extraFilters}` : ''} <span aria-hidden="true">{moreFilters ? '▴' : '▾'}</span>
			</button>
			<div id="extra-filters" class="extra" hidden={!moreFilters}>
				<select aria-label="난이도 필터" bind:value={criteria.slot}>
					<option value="">난이도 전체</option>
					{#each slotOptions as [slot, label]}<option value={slot}>{label}</option>{/each}
				</select>
				<select aria-label="장르 필터" bind:value={criteria.genre}>
					<option value="">장르 전체</option>
					{#each genres as genre}<option value={genre}>{genre}</option>{/each}
				</select>
				<select aria-label="채보 종류 필터" bind:value={criteria.kind}>
					<option value="">DX·스탠다드</option>
					<option value="dx">DX만</option>
					<option value="sd">스탠다드만</option>
				</select>
				<span class="bpm-range">
					<input type="number" inputmode="numeric" min="0" placeholder="BPM" aria-label="최소 BPM" bind:value={criteria.bpmMin} />
					<span>~</span>
					<input type="number" inputmode="numeric" min="0" placeholder="BPM" aria-label="최대 BPM" bind:value={criteria.bpmMax} />
				</span>
			</div>
		</div>
		<div class="count">
			<span>{found.length === songs.length ? `전체 ${songs.length}곡` : `${found.length} / ${songs.length}곡`}</span>
			{#if filtering}<button class="clear" onclick={clearFilters}>필터 해제</button>{/if}
			<select id="sort-key" aria-label="정렬 기준" bind:value={criteria.sort}>{#each sortKeys as [key, label]}<option value={key}>{label}순</option>{/each}</select>
			<button id="sort-direction" class="direction" title={criteria.desc ? '내림차순' : '오름차순'} aria-label={criteria.desc ? '내림차순' : '오름차순'} onclick={() => criteria.desc = !criteria.desc}>{criteria.desc ? '↓' : '↑'}</button>
		</div>
	</div>
	<ul class="songs" bind:this={grid} aria-label="곡 목록" data-sveltekit-preload-data="tap" data-sveltekit-noscroll>
		{#each found.slice(0, limit) as song (song.id)}
			{@const utage = isUtage(song.id)}
			{@const slots = song.levels.map(([slot]) => slot)}
			<li>
				<a href={`?chart=${encodeURIComponent(song.id)}`} aria-current={song.id === selected ? 'page' : undefined} onclick={() => { onpick(song.matches.at(-1)?.[0]); open = false; }}>
					<span class="jacket" style:--hue={hue(song.genre)} aria-hidden="true">{song.name.slice(0, 1)}</span>
					<span class="body">
						<span class="song-name">{song.name}</span>
						<span class="song-artist">{song.artist}</span>
						<span class="song-meta">{#if song.dx}<b class="dx">DX</b>{/if}{song.number ? `${song.number} · ` : ''}{song.genre}{#if song.bpm} · BPM {song.bpm}{/if}</span>
						<span class="song-levels">
							{#each song.levels as [level, value]}
								<b style:--difficulty={difficultyColor(level, utage)} class:dim={song.matches.length > 0 && !song.matches.some(([match]) => match === level)} title={difficultyName(level, utage, slots)}>{value}</b>
							{/each}
						</span>
					</span>
				</a>
			</li>
		{:else}
			<li class="empty">{criteria.search ? `“${criteria.search}”에 맞는 곡이 없습니다.` : '조건에 맞는 곡이 없습니다.'}</li>
		{/each}
		{#if limit < found.length}<li class="sentinel" bind:this={sentinel} aria-hidden="true"></li>{/if}
	</ul>
</dialog>

<style>
	.picker { width: 100vw; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; background: var(--bg); color: var(--text); }
	.picker[open] { display: flex; flex-direction: column; animation: picker-in .18s ease-out; }
	.picker::backdrop { background: #000a; }
	@keyframes picker-in { from { opacity: 0; transform: translateY(12px); } }
	@media (prefers-reduced-motion: reduce) { .picker[open] { animation: none; } }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	button, select, input { font: inherit; color: inherit; }
	button { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-3); font-size: 14px; }
	select { min-height: 38px; padding: 0 28px 0 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' fill='none' stroke='%23a0abc0' stroke-width='1.6'/%3E%3C/svg%3E") right 10px center / 10px no-repeat; appearance: none; font-size: 14px; }
	[hidden] { display: none !important; }

	header { display: flex; align-items: center; gap: 12px; padding: max(12px, env(safe-area-inset-top)) 16px 10px; border-bottom: 1px solid var(--border); background: var(--surface); }
	h2 { margin: 0; font-size: 17px; white-space: nowrap; }
	.search { position: relative; flex: 1; max-width: 720px; }
	.search svg { position: absolute; left: 14px; top: 50%; width: 20px; height: 20px; translate: 0 -50%; fill: none; stroke: var(--text-3); stroke-width: 2.2; stroke-linecap: round; pointer-events: none; }
	.search input { width: 100%; min-height: 48px; padding: 0 14px 0 44px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-2); font-size: 17px; }
	.search input::placeholder { color: var(--text-3); }
	.close { width: 44px; min-height: 44px; margin-left: auto; padding: 0; border-color: transparent; background: transparent; }
	.close svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }

	.toolbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
	.filters, .extra { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.ghost { border-color: transparent; background: transparent; color: var(--text-2); font-size: 13px; }
	.ghost[aria-expanded='true'] { color: var(--text); }
	.bpm-range { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); }
	.bpm-range input { width: 76px; min-height: 38px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-2); }
	.count { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 13px; }
	.count > span { margin-right: 6px; white-space: nowrap; }
	.clear { border-color: transparent; background: transparent; color: var(--accent); font-size: 13px; }
	.direction { width: 38px; padding: 0; }

	.songs { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); align-content: start; gap: 10px; margin: 0; padding: 14px 16px max(20px, env(safe-area-inset-bottom)); overflow-y: auto; overscroll-behavior: contain; list-style: none; }
	.songs a { display: flex; gap: 12px; height: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: inherit; text-decoration: none; }
	.songs a[aria-current='page'] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
	@media (hover: hover) { .songs a:hover { border-color: var(--border-strong); background: var(--surface-2); } }
	.jacket { flex: none; display: grid; place-items: center; width: 84px; aspect-ratio: 1; border-radius: 8px; background: linear-gradient(135deg, hsl(var(--hue) 45% 32%), hsl(calc(var(--hue) + 40) 50% 18%)); color: #ffffffcc; font-size: 30px; font-weight: 800; }
	.body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.song-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; }
	.song-artist, .song-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: 12px; }
	.song-artist { color: var(--text-2); }
	.dx { margin-right: 6px; padding: 0 4px; border-radius: 3px; background: #2a3a55; color: #ffd36b; font-size: 10px; }
	.song-levels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; padding-top: 4px; }
	.song-levels b { min-width: 34px; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--difficulty) 20%, transparent); color: var(--difficulty); font-size: 11.5px; line-height: 19px; text-align: center; font-variant-numeric: tabular-nums; }
	.song-levels b.dim { opacity: .35; }
	.empty { grid-column: 1 / -1; padding: 40px 10px; color: var(--text-3); text-align: center; }
	.sentinel { grid-column: 1 / -1; height: 1px; }

	@media (max-width: 720px) {
		header { gap: 8px; padding-inline: 10px; }
		h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
		.search input, select, .bpm-range input { font-size: 16px; }
		.toolbar { padding: 8px 10px; }
		.filters > select { flex: 1; }
		.count { width: 100%; }
		.count > span { margin-right: auto; }
		.songs { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 10px; }
		.jacket { width: 68px; font-size: 24px; }
	}
</style>
