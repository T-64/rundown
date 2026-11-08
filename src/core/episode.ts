// The two steps an agent calls:
//   gather()   -> everything needed to write today's script
//   produce()  -> script in, audio + chapters + upload out

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EPISODES_DIR, loadPrefs, loadState, saveState, type Prefs } from './config.ts';
import { recent, record } from './history.ts';
import { headlines, weather, type Headline, type Weather } from './sources.ts';
import { concat, duration, speak, toMp3 } from './audio.ts';
import { findShow, setTimeline, upload, waitReady } from './publish.ts';

export interface Segment {
	title: string;
	text: string;
	links?: string[];
}

export interface Script {
	title: string;
	summary: string;
	segments: Segment[];
}

export interface Material {
	date: string;
	prefs: Omit<Prefs, 'ttsCommand'>;
	weather?: Weather;
	headlines: Headline[];
	recentEpisodes: string;
	problems: string[];
}

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

export async function gather(): Promise<Material> {
	const prefs = loadPrefs();
	const problems: string[] = [];
	const [w, h] = await Promise.allSettled([weather(prefs.city), headlines(prefs.feeds)]);
	if (w.status === 'rejected') problems.push(`weather: ${w.reason?.message ?? w.reason}`);
	if (h.status === 'rejected') problems.push(`headlines: ${h.reason?.message ?? h.reason}`);
	const { ttsCommand: _omit, ...shown } = prefs;
	return {
		date: today(),
		prefs: shown,
		weather: w.status === 'fulfilled' ? w.value : undefined,
		headlines: h.status === 'fulfilled' ? h.value : [],
		recentEpisodes: recent(),
		problems,
	};
}

export function validate(s: Script): string[] {
	const errs: string[] = [];
	if (!s.title?.trim()) errs.push('title is empty');
	if (!s.segments?.length) errs.push('no segments');
	s.segments?.forEach((seg, i) => {
		if (!seg.title?.trim()) errs.push(`segment ${i + 1} has no title`);
		if (!seg.text?.trim()) errs.push(`segment ${i + 1} has no text`);
		for (const l of seg.links ?? []) if (!/^https?:\/\//.test(l)) errs.push(`segment ${i + 1}: not a URL: ${l}`);
	});
	return errs;
}

export interface Produced {
	dir: string;
	mp3: string;
	durationMs: number;
	chapters: { title: string; startMs: number }[];
	timelineFile: string;
	episodeUri?: string;
}

type Progress = (msg: string) => void;

// Chapters at each segment start, and source links shown during the segment
// they belong to. Companion items may not overlap, so links are laid out one
// after another and dropped if they don't fit inside their segment.
export function timeline(segments: Segment[], starts: number[], lengths: number[]) {
	const items: object[] = [];
	if (segments.length >= 2) {
		segments.forEach((s, i) => items.push({ chapter: { title: s.title, start_time_ms: starts[i] } }));
	}
	const LINK_MS = 15_000;
	const MIN_MS = 4_000;
	segments.forEach((s, i) => {
		const end = starts[i] + lengths[i] - 200;
		let t = starts[i] + 500;
		for (const url of s.links ?? []) {
			const d = Math.min(LINK_MS, end - t);
			if (d < MIN_MS) break;
			items.push({ link: { start_time_ms: t, duration_ms: d, url } });
			t += d + 300;
		}
	});
	return { items };
}

export async function produce(
	script: Script,
	opts: { publish: boolean; record?: boolean; onProgress?: Progress; signal?: AbortSignal },
): Promise<Produced> {
	const errs = validate(script);
	if (errs.length) throw new Error(`Script problems:\n- ${errs.join('\n- ')}`);
	const prefs = loadPrefs();
	const say = opts.onProgress ?? (() => {});
	const dir = join(EPISODES_DIR, `${today()}-${Date.now().toString(36)}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'script.json'), JSON.stringify(script, null, 2));

	const tts = { engine: prefs.tts, voice: prefs.voice, command: prefs.ttsCommand };
	const files: string[] = [];
	const lengths: number[] = [];
	for (const [i, seg] of script.segments.entries()) {
		opts.signal?.throwIfAborted();
		say(`Voicing ${i + 1}/${script.segments.length}: ${seg.title}`);
		const f = await speak(seg.text, dir, `seg-${String(i + 1).padStart(2, '0')}`, tts);
		files.push(f);
		lengths.push(await duration(f));
	}

	const GAP = 400;
	const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b + GAP, 0));
	say('Joining segments');
	const wav = join(dir, 'episode.wav');
	await concat(files, wav, GAP, dir);
	const mp3 = join(dir, 'episode.mp3');
	await toMp3(wav, mp3);
	const timelineFile = join(dir, 'timeline.json');
	writeFileSync(timelineFile, JSON.stringify(timeline(script.segments, starts, lengths), null, 2));

	const result: Produced = {
		dir,
		mp3,
		durationMs: await duration(mp3),
		chapters: script.segments.map((s, i) => ({ title: s.title, startMs: starts[i] })),
		timelineFile,
	};

	if (opts.publish) {
		const state = loadState();
		// Reuse the show if it already exists, even if state.json was lost.
		const showId = state.showId ?? (await findShow(prefs.show));
		say('Uploading with save-to-spotify');
		const up = await upload({
			file: mp3,
			title: script.title,
			summary: script.summary,
			language: prefs.language,
			showId,
			newShow: showId ? undefined : prefs.show,
		});
		const saved = showId ?? up.showId ?? (await findShow(prefs.show));
		if (saved && saved !== state.showId) saveState({ ...state, showId: saved });
		say('Waiting for Spotify to process the episode');
		await waitReady(up.episodeId);
		say('Adding chapters and links');
		await setTimeline(up.episodeId, timelineFile);
		result.episodeUri = up.episodeUri;
	}

	if (opts.record !== false) record({
		date: today(),
		title: script.title,
		uri: result.episodeUri,
		segments: script.segments.map((s) => s.title),
		links: script.segments.flatMap((s) => s.links ?? []),
	});
	return result;
}
