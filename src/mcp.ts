#!/usr/bin/env node
// MCP server over stdio, for harnesses that speak MCP: DSH (DeepSeek Harness)
// through @deepseek-ai/dsh-mcp-client, Claude Code, Codex and others.
// Same two tools as the pi extension. There's no confirmation dialog over MCP,
// so produce only uploads when the caller passes publish: true; the bundled
// skill tells the agent to ask the person first.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { gather, produce, type Script } from './core/episode.ts';
import { loggedIn } from './core/publish.ts';

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

await server.connect(new StdioServerTransport());
