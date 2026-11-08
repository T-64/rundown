// pi adapter: two tools for the model, one command for the person.
//
//   rundown_gather   read-only; returns today's material
//   rundown_produce  voices the script and (after you confirm) uploads it
//   /rundown-setup   edit preferences without opening the file
//
// The /rundown prompt template in ../../prompts/ ties them together.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { loadPrefs, PREFS_FILE, savePrefs } from '../core/config.ts';
import { gather, produce, type Script } from '../core/episode.ts';
import { loggedIn } from '../core/publish.ts';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: 'rundown_gather',
		label: 'Rundown: gather',
		description:
			"Collect material for today's rundown episode: the listener's preferences and notes, local weather, recent headlines with links, and the titles of recent episodes.",
		promptSnippet: "Collect weather, headlines and preferences for today's audio rundown",
		parameters: Type.Object({}),
		async execute() {
			const m = await gather();
			return { ...text(JSON.stringify(m, null, 2)), details: { headlines: m.headlines.length, problems: m.problems } };
		},
	});

	pi.registerTool({
		name: 'rundown_produce',
		label: 'Rundown: produce',
		description:
			'Turn a finished script into audio (one segment per chapter), join it into an MP3 with chapters and source links, and save it to the listener\'s Spotify library with save-to-spotify. Asks the person before uploading.',
		promptSnippet: 'Voice a rundown script and save the episode to Spotify',
		promptGuidelines: [
			'Write rundown_produce segment text for listening: plain sentences, no markdown, no URLs in the text. Put source URLs in the segment links instead.',
		],
		parameters: Type.Object({
			title: Type.String({ description: 'Episode title, e.g. "Morning Rundown: Saturday 8 November"' }),
			summary: Type.String({ description: 'One or two sentences for the episode description' }),
			segments: Type.Array(
				Type.Object({
					title: Type.String({ description: 'Short chapter title' }),
					text: Type.String({ description: 'What the host says in this segment' }),
					links: Type.Optional(Type.Array(Type.String(), { description: 'Source URLs used in this segment' })),
					language: Type.Optional(
						Type.String({ description: 'Language code if this segment is not in the episode language, e.g. "de"' }),
					),
				}),
				{ minItems: 1 },
			),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const progress = (msg: string) => onUpdate?.({ ...text(msg), details: { stage: msg } });
			const prefs = loadPrefs();

			let publish = await loggedIn();
			if (!publish) {
				progress('save-to-spotify is missing or not logged in; making the audio only');
			} else if (ctx.hasUI) {
				publish = await ctx.ui.confirm(
					'Save to Spotify?',
					`"${params.title}", ${params.segments.length} segments, to your show "${prefs.show}"`,
				);
			} else {
				// Unattended (scheduled) runs only upload if the listener opted in.
				publish = prefs.autoPublish;
			}

			const r = await produce(params as Script, { publish, onProgress: progress, signal });
			const lines = [
				`Made ${minutes(r.durationMs)} of audio: ${r.mp3}`,
				`Chapters: ${r.chapters.map((c) => `${minutes(c.startMs)} ${c.title}`).join(' · ')}`,
				r.episodeUri
					? `Saved to Spotify: ${r.episodeUri} (https://open.spotify.com/episode/${r.episodeUri.split(':').pop()})`
					: 'Not uploaded.',
			];
			return { ...text(lines.join('\n')), details: r };
		},
	});

	pi.registerCommand('rundown-setup', {
		description: 'Set up your daily rundown (show name, city, length, voice, feeds)',
		handler: async (_args, ctx) => {
			const p = loadPrefs();
			const ask = async (label: string, current: string) => (await ctx.ui.input(label, current))?.trim() || current;
			p.show = await ask('Show name', p.show);
			p.city = await ask('City for the weather', p.city);
			p.minutes = Number(await ask('Length in minutes', String(p.minutes))) || p.minutes;
			p.language = await ask('Language code', p.language);
			p.voices.default = await ask(`Voice for ${p.tts} (others per language in the file)`, p.voices.default ?? '');
			p.feeds = (await ask('RSS feeds, comma separated', p.feeds.join(', ')))
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			savePrefs(p);
			ctx.ui.notify(`Saved to ${PREFS_FILE}. Edit the notes at the bottom to steer the writing.`, 'info');
		},
	});
}
