// Your Spotify account, through the public Web API.
//
// You register your own app at developer.spotify.com (free, needs Premium in
// development mode) and log in once with `rundown spotify-login`. That uses
// the Authorization Code flow with PKCE, so there is no client secret: only
// the app's Client ID, which isn't secret. Tokens are kept in
// ~/.rundown/spotify.json, readable only by you, and refreshed as needed.
//
// Paths follow the February 2026 changes for development-mode apps
// (/me/playlists, /playlists/{id}/items, search limit 10).

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { HOME, ensureHome, loadPrefs } from './config.ts';

const TOKEN_FILE = join(HOME, 'spotify.json');
const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';
export const REDIRECT_PORT = Number(process.env.RUNDOWN_SPOTIFY_PORT ?? 8888);
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

const SCOPES = [
	'user-top-read',
	'user-read-recently-played',
	'user-library-read',
	'playlist-read-private',
	'playlist-read-collaborative',
	'playlist-modify-private',
	'playlist-modify-public',
	'user-read-playback-state',
	'user-read-currently-playing',
];

interface Tokens {
	clientId: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	scope: string;
}

export function clientId() {
	return process.env.SPOTIFY_CLIENT_ID ?? loadPrefs().spotifyClientId;
}

function readTokens(): Tokens | undefined {
	if (!existsSync(TOKEN_FILE)) return undefined;
	try {
		return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
	} catch {
		return undefined;
	}
}

function writeTokens(t: Tokens) {
	ensureHome();
	writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
	chmodSync(TOKEN_FILE, 0o600);
}

export const connected = () => Boolean(readTokens()?.refresh_token);

async function tokenRequest(body: Record<string, string>) {
	const res = await fetch(`${ACCOUNTS}/api/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body),
	});
	const data = (await res.json()) as any;
	if (!res.ok) throw new Error(`Spotify login failed: ${data.error_description ?? data.error ?? res.status}`);
	return data as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

const b64url = (b: Buffer) => b.toString('base64url');

// One-time login. Opens the browser, waits for Spotify to redirect back to
// 127.0.0.1, and stores the tokens. `say` is where to print instructions.
export async function login(say: (msg: string) => void = console.log) {
	const id = clientId();
	if (!id)
		throw new Error(
			'No Spotify Client ID. Create an app at https://developer.spotify.com/dashboard, ' +
				`add ${REDIRECT_URI} as a redirect URI, and put spotifyClientId: <id> in ~/.rundown/preferences.md`,
		);
	const verifier = b64url(randomBytes(48));
	const challenge = b64url(createHash('sha256').update(verifier).digest());
	const state = b64url(randomBytes(12));
	const url =
		`${ACCOUNTS}/authorize?` +
		new URLSearchParams({
			client_id: id,
			response_type: 'code',
			redirect_uri: REDIRECT_URI,
			code_challenge_method: 'S256',
			code_challenge: challenge,
			scope: SCOPES.join(' '),
			state,
		});

	const code = await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			const u = new URL(req.url ?? '/', REDIRECT_URI);
			if (u.pathname !== '/callback') return void res.writeHead(404).end();
			const err = u.searchParams.get('error');
			const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
			res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end(ok ? 'rundown is connected to Spotify. You can close this tab.' : `Login failed: ${err ?? 'state mismatch'}`);
			server.close();
			clearTimeout(timer);
			ok ? resolve(u.searchParams.get('code')!) : reject(new Error(`Spotify login failed: ${err ?? 'state mismatch'}`));
		});
		const timer = setTimeout(() => {
			server.close();
			reject(new Error('Timed out waiting for the Spotify login (5 minutes)'));
		}, 5 * 60_000);
		server.on('error', reject);
		server.listen(REDIRECT_PORT, '127.0.0.1', () => {
			say(`Opening Spotify to log in. If nothing opens, visit:\n${url}`);
			const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
			execFile(opener, [url], () => {});
		});
	});

	const t = await tokenRequest({
		grant_type: 'authorization_code',
		code,
		redirect_uri: REDIRECT_URI,
		client_id: id,
		code_verifier: verifier,
	});
	writeTokens({
		clientId: id,
		access_token: t.access_token,
		refresh_token: t.refresh_token!,
		expires_at: Date.now() + t.expires_in * 1000,
		scope: t.scope,
	});
	const me = await api('GET', '/me');
	return me.display_name ?? me.id;
}

async function accessToken() {
	const t = readTokens();
	if (!t?.refresh_token) throw new Error('Not connected to Spotify. Run `rundown spotify-login` (or /spotify-login in pi) first.');
	if (Date.now() < t.expires_at - 60_000) return t.access_token;
	const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId });
	writeTokens({
		...t,
		access_token: r.access_token,
		refresh_token: r.refresh_token ?? t.refresh_token,
		expires_at: Date.now() + r.expires_in * 1000,
		scope: r.scope ?? t.scope,
	});
	return r.access_token;
}

export async function api(method: string, path: string, body?: unknown, retry = true): Promise<any> {
	const res = await fetch(path.startsWith('http') ? path : API + path, {
		method,
		headers: {
			Authorization: `Bearer ${await accessToken()}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (res.status === 429 && retry) {
		const wait = Number(res.headers.get('Retry-After') ?? 2);
		await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
		return api(method, path, body, false);
	}
	if (res.status === 204) return undefined;
	const text = await res.text();
	const data = text ? JSON.parse(text) : undefined;
	if (!res.ok) throw new Error(`Spotify ${method} ${path}: ${res.status} ${data?.error?.message ?? text}`);
	return data;
}

// --- compact views for the model -------------------------------------------

const names = (xs?: { name: string }[]) => (xs ?? []).map((x) => x.name).join(', ');

function line(x: any): string {
	if (!x) return '(unavailable)';
	switch (x.type) {
		case 'track':
			return `${x.name} — ${names(x.artists)} (${x.album?.name ?? ''}) ${x.uri}`;
		case 'episode':
			return `${x.name} — ${x.show?.name ?? ''} ${x.uri}`;
		case 'artist':
			return `${x.name}${x.genres?.length ? ` [${x.genres.slice(0, 3).join(', ')}]` : ''} ${x.uri}`;
		case 'album':
			return `${x.name} — ${names(x.artists)} (${(x.release_date ?? '').slice(0, 4)}) ${x.uri}`;
		case 'show':
			return `${x.name} — ${x.publisher ?? ''} ${x.uri}`.replace(' —  ', ' ');
		case 'playlist':
			return `${x.name} (${x.items?.total ?? x.tracks?.total ?? '?'} items, by ${x.owner?.display_name ?? x.owner?.id}) ${x.uri}`;
		default:
			return `${x.name ?? x.id} ${x.uri ?? ''}`;
	}
}

const list = (title: string, xs: string[]) => (xs.length ? `${title}\n${xs.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : `${title}\n(none)`);

export type View =
	| 'top_tracks'
	| 'top_artists'
	| 'recently_played'
	| 'playlists'
	| 'saved_tracks'
	| 'saved_albums'
	| 'saved_shows'
	| 'now_playing';

export const VIEWS: View[] = [
	'top_tracks',
	'top_artists',
	'recently_played',
	'playlists',
	'saved_tracks',
	'saved_albums',
	'saved_shows',
	'now_playing',
];

export type Range = 'short_term' | 'medium_term' | 'long_term';

export async function library(view: View, opts: { range?: Range; limit?: number } = {}) {
	const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
	const range = opts.range ?? 'medium_term';
	const span = { short_term: 'last 4 weeks', medium_term: 'last 6 months', long_term: 'all time' }[range];
	switch (view) {
		case 'top_tracks': {
			const r = await api('GET', `/me/top/tracks?limit=${limit}&time_range=${range}`);
			return list(`Top tracks (${span})`, r.items.map(line));
		}
		case 'top_artists': {
			const r = await api('GET', `/me/top/artists?limit=${limit}&time_range=${range}`);
			return list(`Top artists (${span})`, r.items.map(line));
		}
		case 'recently_played': {
			const r = await api('GET', `/me/player/recently-played?limit=${limit}`);
			return list(
				'Recently played',
				r.items.map((i: any) => `${i.played_at.slice(0, 16).replace('T', ' ')}  ${line(i.track)}`),
			);
		}
		case 'playlists': {
			const r = await api('GET', `/me/playlists?limit=${limit}`);
			return list(`Playlists (${r.total} in total)`, r.items.filter(Boolean).map(line));
		}
		case 'saved_tracks': {
			const r = await api('GET', `/me/tracks?limit=${limit}`);
			return list(`Liked songs (${r.total} in total, newest first)`, r.items.map((i: any) => line(i.track)));
		}
		case 'saved_albums': {
			const r = await api('GET', `/me/albums?limit=${limit}`);
			return list(`Saved albums (${r.total} in total)`, r.items.map((i: any) => line(i.album)));
		}
		case 'saved_shows': {
			const r = await api('GET', `/me/shows?limit=${limit}`);
			return list(`Followed podcasts (${r.total} in total)`, r.items.map((i: any) => line(i.show)));
		}
		case 'now_playing': {
			const r = await api('GET', '/me/player/currently-playing?additional_types=episode');
			if (!r?.item) return 'Nothing is playing right now.';
			return `${r.is_playing ? 'Playing' : 'Paused'}: ${line(r.item)}`;
		}
	}
}

// Accepts an id, a spotify:playlist: URI or an open.spotify.com link.
export const playlistId = (s: string) => s.match(/playlist[:/]([A-Za-z0-9]+)/)?.[1] ?? s.trim();

export async function playlistItems(playlist: string, limit = 50) {
	const id = playlistId(playlist);
	const p = await api('GET', `/playlists/${id}?fields=name,owner(display_name,id),uri`);
	const r = await api('GET', `/playlists/${id}/items?limit=${Math.max(1, Math.min(limit, 50))}`);
	return list(`${p.name} (${r.total} items)`, r.items.map((i: any) => line(i.item ?? i.track)));
}

export type SearchType = 'track' | 'artist' | 'album' | 'playlist' | 'show' | 'episode';

export async function search(query: string, type: SearchType = 'track', limit = 10) {
	const q = new URLSearchParams({ q: query, type, limit: String(Math.max(1, Math.min(limit, 10))) });
	const r = await api('GET', `/search?${q}`);
	const items = (r[`${type}s`]?.items ?? []).filter(Boolean);
	return list(`Search "${query}" (${type})`, items.map(line));
}

export async function createPlaylist(name: string, uris: string[], opts: { description?: string; public?: boolean } = {}) {
	const p = await api('POST', '/me/playlists', {
		name,
		description: opts.description ?? '',
		public: opts.public ?? false,
	});
	const clean = uris.filter((u) => /^spotify:(track|episode):[A-Za-z0-9]+$/.test(u));
	for (let i = 0; i < clean.length; i += 100) {
		await api('POST', `/playlists/${p.id}/items`, { uris: clean.slice(i, i + 100) });
	}
	return { url: p.external_urls?.spotify as string, uri: p.uri as string, added: clean.length, skipped: uris.length - clean.length };
}
