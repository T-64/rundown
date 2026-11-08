// Where rundown keeps its files, and the preferences format.
//
// Preferences live in one Markdown file so a person can open and edit it.
// The frontmatter holds settings; the body is free-form guidance for whoever
// writes the script (tone, things to skip, recurring segments).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

export const HOME = process.env.RUNDOWN_HOME ?? join(homedir(), '.rundown');
export const PREFS_FILE = join(HOME, 'preferences.md');
export const HISTORY_FILE = join(HOME, 'history.md');
export const STATE_FILE = join(HOME, 'state.json');
export const EPISODES_DIR = join(HOME, 'episodes');

export type Engine = 'say' | 'piper' | 'openai' | 'command';

export interface Prefs {
	show: string;
	city: string;
	language: string;
	minutes: number;
	feeds: string[];
	tts: Engine;
	// Voice per language code. Segments can switch language, e.g. a German
	// practice segment inside an English episode. "default" is the fallback.
	voices: Record<string, string>;
	// piper: where voice models live
	piperDir?: string;
	// openai: any OpenAI-compatible /v1/audio/speech server (OpenAI itself,
	// Kokoro-FastAPI, a Chatterbox or Qwen3-TTS server on your own GPU...).
	// The API key is read from the env var named here, never from this file.
	ttsUrl?: string;
	ttsModel?: string;
	ttsKeyEnv?: string;
	// command: any program; {in} is a text file, {out} where to write audio, {voice}
	ttsCommand?: string;
	autoPublish: boolean;
	// Client ID of your own app at developer.spotify.com, for reading your
	// library and making playlists. Not a secret (rundown uses PKCE).
	spotifyClientId?: string;
	notes: string;
}

export const DEFAULT_PREFS: Prefs = {
	show: 'Morning Rundown',
	city: 'Stuttgart',
	language: 'en',
	minutes: 5,
	feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml'],
	tts: process.platform === 'darwin' ? 'say' : 'piper',
	voices:
		process.platform === 'darwin'
			? { default: 'Samantha', de: 'Anna', zh: 'Tingting' }
			: { default: 'en_US-lessac-medium', de: 'de_DE-thorsten-medium', zh: 'zh_CN-huayan-medium' },
	autoPublish: false,
	notes: 'Calm and plain. No hype. Say where each story comes from.',
};

export const voiceFor = (p: Prefs, lang?: string) =>
	p.voices[lang ?? p.language] ?? p.voices[(lang ?? p.language).split('-')[0]] ?? p.voices.default;

export function ensureHome() {
	mkdirSync(EPISODES_DIR, { recursive: true });
}

export function loadPrefs(): Prefs {
	if (!existsSync(PREFS_FILE)) return { ...DEFAULT_PREFS };
	const raw = readFileSync(PREFS_FILE, 'utf8');
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	const front = (m ? parse(m[1]) : {}) ?? {};
	// Older files had a single `voice`
	const voices = { ...DEFAULT_PREFS.voices, ...(front.voice ? { default: front.voice } : {}), ...(front.voices ?? {}) };
	delete front.voice;
	return {
		...DEFAULT_PREFS,
		...front,
		voices,
		feeds: Array.isArray(front.feeds) ? front.feeds : DEFAULT_PREFS.feeds,
		notes: (m ? m[2] : raw).trim(),
	};
}

export function savePrefs(p: Prefs) {
	ensureHome();
	const { notes, ...front } = p;
	writeFileSync(PREFS_FILE, `---\n${stringify(front).trim()}\n---\n\n${notes.trim()}\n`);
}

interface State {
	showId?: string;
}

export function loadState(): State {
	try {
		return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
	} catch {
		return {};
	}
}

export function saveState(s: State) {
	ensureHome();
	writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}
