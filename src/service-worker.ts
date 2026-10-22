/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { assets, immutable, prerendered } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;
// Manifest paths are relative to the base path, which is the folder the worker is served from.
const base = new URL(sw.registration.scope).pathname.replace(/\/$/, '');
const full = (path: string) => `${base}/${path.replace(/^\//, '')}`;
const shellCache = `shell-${version}`;
const chartCache = `charts-${version}`;
const chartPrefix = `${base}/charts/`;
// The app shell is cached up front; the 1800-odd chart files are cached as they are opened, so the install stays small.
const shell = [...immutable, ...assets, ...prerendered].map(({ path }) => full(path)).filter((path) => !path.startsWith(chartPrefix));
const page = `${base}/`;

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(shellCache).then((cache) => cache.addAll(shell)));
});

// A new version takes over once every open copy of the app has closed, so a running page never loses its chunks.
sw.addEventListener('activate', (event) => {
	event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== shellCache && key !== chartCache).map((key) => caches.delete(key)))));
});

async function cached(cacheName: string, request: Request | string) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;
	// Every route is the same prerendered shell; ?chart= is read in the browser.
	if (event.request.mode === 'navigate' && (url.pathname === page || url.pathname === base)) {
		event.respondWith(caches.match(page).then((hit) => hit ?? fetch(event.request)));
	} else if (url.pathname.startsWith(chartPrefix)) {
		event.respondWith(cached(chartCache, event.request));
	} else if (shell.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(event.request)));
	}
});
