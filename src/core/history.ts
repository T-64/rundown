// A plain Markdown log of past episodes, so the next script can avoid
// repeating yesterday's stories.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { ensureHome, HISTORY_FILE } from './config.ts';

export interface Entry {
	date: string;
	title: string;
	segments: string[];
	links: string[];
	uri?: string;
}

export function record(e: Entry) {
	ensureHome();
	const lines = [
		`## ${e.date} — ${e.title}`,
		...(e.uri ? [`- episode: ${e.uri}`] : []),
		...e.segments.map((s) => `- ${s}`),
		...e.links.map((l) => `  - ${l}`),
		'',
	];
	appendFileSync(HISTORY_FILE, lines.join('\n') + '\n');
}

// The last few entries, as written, for the model to read.
export function recent(count = 5): string {
	if (!existsSync(HISTORY_FILE)) return '';
	const blocks = readFileSync(HISTORY_FILE, 'utf8').split(/\n(?=## )/).filter((b) => b.trim());
	return blocks.slice(-count).join('\n').trim();
}
