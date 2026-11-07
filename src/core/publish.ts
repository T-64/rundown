// Uploads go through Spotify's own open-source CLI, save-to-spotify
// (https://github.com/spotify/save-to-spotify). We never talk to Spotify's
// APIs directly here, and never send Spotify data to the model.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Use save-to-spotify from PATH if it's installed. Otherwise fall back to the
// copy that ships inside Spotify's desktop app on macOS (same open-source CLI,
// signed by Spotify), so people who have Spotify installed needn't add anything.
const BUNDLED = [
	'/Applications/Spotify.app/Contents/MacOS/save-to-spotify',
	'/Applications/Studio by Spotify Labs.app/Contents/MacOS/save-to-spotify',
];

function findBin(): string {
	if (process.env.SAVE_TO_SPOTIFY_BIN) return process.env.SAVE_TO_SPOTIFY_BIN;
	try {
		return execFileSync('/usr/bin/which', ['save-to-spotify'], { encoding: 'utf8' }).trim();
	} catch {
		return BUNDLED.find((p) => existsSync(p)) ?? 'save-to-spotify';
	}
}

export const BIN = findBin();

async function sts(args: string[], timeoutMs = 10 * 60_000) {
	try {
		const { stdout } = await run(BIN, ['--json', ...args], {
			timeout: timeoutMs,
			maxBuffer: 10_000_000,
			env: { ...process.env, SAVE_TO_SPOTIFY_NO_UPDATE_CHECK: '1' },
		});
		return JSON.parse(stdout || '{}');
	} catch (err: any) {
		if (err.code === 'ENOENT') {
			throw new Error('save-to-spotify is not installed. See https://github.com/spotify/save-to-spotify#install');
		}
		const msg = (() => {
			try {
				return JSON.parse(err.stdout).error;
			} catch {
				return err.stderr?.trim() || err.message;
			}
		})();
		throw new Error(`save-to-spotify ${args[0]}: ${msg}`);
	}
}

export async function loggedIn(): Promise<boolean> {
	try {
		const s = await sts(['auth', 'status'], 20_000);
		return s.authenticated === true;
	} catch {
		return false;
	}
}

// The CLI's JSON field names aren't all documented, so look for the likely ones.
function pick(o: any, ...keys: string[]): string | undefined {
	for (const k of keys) {
		const v = k.split('.').reduce((a, p) => a?.[p], o);
		if (typeof v === 'string' && v) return v;
	}
	return undefined;
}

export interface Uploaded {
	episodeUri: string;
	episodeId: string;
	showId?: string;
}

export async function upload(opts: {
	file: string;
	title: string;
	summary: string;
	language: string;
	showId?: string;
	newShow?: string;
	image?: string;
}): Promise<Uploaded> {
	const args = ['upload', opts.file, '--title', opts.title, '--summary', opts.summary, '--language', opts.language];
	if (opts.showId) args.push('--show-id', opts.showId);
	else if (opts.newShow) args.push('--new-show', opts.newShow);
	if (opts.image) args.push('--image', opts.image);
	const out = await sts(args);
	const episodeUri = pick(out, 'episode_uri', 'episode.uri', 'uri');
	if (!episodeUri) throw new Error(`Upload finished but no episode URI in: ${JSON.stringify(out)}`);
	return {
		episodeUri,
		episodeId: pick(out, 'episode_id', 'episode.id') ?? episodeUri.split(':').pop()!,
		showId: pick(out, 'show_id', 'show.id', 'show_uri', 'show.uri'),
	};
}

export async function waitReady(episodeId: string) {
	await sts(['episodes', 'status', episodeId, '--wait=8m'], 9 * 60_000);
}

export async function setTimeline(episodeId: string, file: string) {
	await sts(['timeline', 'set', '--episode-id', episodeId, '--from-file', file]);
}
