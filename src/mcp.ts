#!/usr/bin/env node
// MCP server over stdio, for harnesses that speak MCP: DSH (DeepSeek Harness)
// through @deepseek-ai/dsh-mcp-client, Claude Code, Codex and others.
// Same tools as the pi extension. There's no confirmation dialog over MCP,
// so produce only uploads when the caller passes publish: true; the bundled
// skill tells the agent to ask the person first.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { gather, produce, type Script } from './core/episode.ts';
import { loggedIn } from './core/publish.ts';
import { createPlaylist, library, playlistItems, search, VIEWS, type View } from './core/spotify.ts';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

const server = new McpServer({ name: 'rundown', version: '0.1.0' });

server.registerTool(
	'rundown_gather',
	{
		description:
			"Collect material for today's rundown episode: the listener's preferences and notes, local weather, recent headlines with links, and recent episode titles.",
		inputSchema: {},
	},
	async () => text(JSON.stringify(await gather(), null, 2)),
);

server.registerTool(
	'rundown_produce',
	{
		description:
			"Voice a finished rundown script (one segment per chapter), join it into an MP3 with chapters and source links, and, if publish is true, save it to the listener's Spotify library with save-to-spotify. Ask the person before publishing.",
		inputSchema: {
			title: z.string().describe('Episode title'),
			summary: z.string().describe('One or two sentences for the episode description'),
			segments: z
				.array(
					z.object({
						title: z.string().describe('Short chapter title'),
						text: z.string().describe('What the host says; plain sentences, no markdown or URLs'),
						links: z.array(z.string()).optional().describe('Source URLs used in this segment'),
						language: z.string().optional().describe('Language code if not the episode language, e.g. "de"'),
					}),
				)
				.min(1),
			publish: z.boolean().default(false).describe('Upload to Spotify. Only true after the person agreed.'),
		},
	},
	async ({ publish, ...script }) => {
		const canPublish = publish && (await loggedIn());
		const r = await produce(script as Script, { publish: canPublish });
		return text(
			[
				`Made ${minutes(r.durationMs)} of audio: ${r.mp3}`,
				`Chapters: ${r.chapters.map((c) => `${minutes(c.startMs)} ${c.title}`).join(' · ')}`,
				r.episodeUri
					? `Saved to Spotify: https://open.spotify.com/episode/${r.episodeUri.split(':').pop()}`
					: publish
						? 'Not uploaded: save-to-spotify is missing or not logged in.'
						: 'Not uploaded (publish was false).',
			].join('\n'),
		);
	},
);

// --- the person's Spotify account (needs `rundown spotify-login` once) -----

server.registerTool(
	'spotify_library',
	{
		description:
			"Read the person's own Spotify account: top tracks or artists, recently played, playlists, liked songs, saved albums, followed podcasts, or what's playing now. Each line ends with a spotify: URI you can reuse.",
		inputSchema: {
			view: z.enum(VIEWS as [View, ...View[]]),
			range: z.enum(['short_term', 'medium_term', 'long_term']).optional().describe('For top_*: last 4 weeks, 6 months, or all time'),
			limit: z.number().int().min(1).max(50).optional(),
		},
	},
	async ({ view, range, limit }) => text(await library(view, { range, limit })),
);

server.registerTool(
	'spotify_playlist_items',
	{
		description: "List what's in one of the person's playlists. Accepts an id, a spotify:playlist: URI or an open.spotify.com link.",
		inputSchema: { playlist: z.string(), limit: z.number().int().min(1).max(50).optional() },
	},
	async ({ playlist, limit }) => text(await playlistItems(playlist, limit)),
);

server.registerTool(
	'spotify_search',
	{
		description: 'Search the Spotify catalogue. Returns up to 10 results with spotify: URIs.',
		inputSchema: {
			query: z.string(),
			type: z.enum(['track', 'artist', 'album', 'playlist', 'show', 'episode']).default('track'),
			limit: z.number().int().min(1).max(10).optional(),
		},
	},
	async ({ query, type, limit }) => text(await search(query, type, limit)),
);

server.registerTool(
	'spotify_create_playlist',
	{
		description:
			"Create a new playlist in the person's account and add tracks or episodes by spotify: URI (only URIs returned by spotify_library or spotify_search). Private unless public is true. Ask the person first.",
		inputSchema: {
			name: z.string(),
			description: z.string().optional(),
			uris: z.array(z.string()).min(1),
			public: z.boolean().optional(),
		},
	},
	async ({ name, description, uris, public: pub }) => {
		const r = await createPlaylist(name, uris, { description, public: pub });
		return text(`Created ${r.url} with ${r.added} items${r.skipped ? ` (${r.skipped} invalid URIs skipped)` : ''}.`);
	},
);

await server.connect(new StdioServerTransport());
