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

export interface Prefs {
	show: string;
	city: string;
	language: string;
	minutes: number;
	feeds: string[];
	tts: 'say' | 'command';
	voice?: string;
	ttsCommand?: string;
	autoPublish: boolean;
	notes: string;
}

export const DEFAULT_PREFS: Prefs = {
	show: 'Morning Rundown',
	city: 'Stuttgart',
	language: 'en',
	minutes: 5,
	feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml'],
	tts: 'say',
	voice: 'Samantha',
	autoPublish: false,
	notes: 'Calm and plain. No hype. Say where each story comes from.',
};

export function ensureHome() {
	mkdirSync(EPISODES_DIR, { recursive: true });
}

export function loadPrefs(): Prefs {
	if (!existsSync(PREFS_FILE)) return { ...DEFAULT_PREFS };
	const raw = readFileSync(PREFS_FILE, 'utf8');
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	const front = (m ? parse(m[1]) : {}) ?? {};
	return {
		...DEFAULT_PREFS,
		...front,
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
