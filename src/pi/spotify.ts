// pi adapter for your Spotify account: read what you listen to, search, and
// make playlists. Uploading episodes is separate (save-to-spotify, in
// extension.ts) and needs no developer app.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { createPlaylist, library, login, playlistItems, search, VIEWS, type Range, type SearchType, type View } from '../core/spotify.ts';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const lit = <T extends string>(xs: readonly T[]) => Type.Union(xs.map((x) => Type.Literal(x)));

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: 'spotify_library',
		label: 'Spotify: library',
		description:
			"Read the person's own Spotify account: top tracks or artists, recently played, playlists, liked songs, saved albums, followed podcasts, or what's playing now. Each line ends with a spotify: URI you can reuse.",
		promptSnippet: "Read the person's Spotify listening, playlists and library",
		parameters: Type.Object({
			view: lit(VIEWS),
			range: Type.Optional(lit(['short_term', 'medium_term', 'long_term'] as const)),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: 'Default 20' })),
		}),
		async execute(_id, p) {
			return text(await library(p.view as View, { range: p.range as Range | undefined, limit: p.limit }));
		},
	});

	pi.registerTool({
		name: 'spotify_playlist_items',
		label: 'Spotify: playlist items',
		description: "List what's in one of the person's playlists. Accepts an id, a spotify:playlist: URI or an open.spotify.com link.",
		parameters: Type.Object({
			playlist: Type.String(),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
		}),
		async execute(_id, p) {
			return text(await playlistItems(p.playlist, p.limit));
		},
	});

	pi.registerTool({
		name: 'spotify_search',
		label: 'Spotify: search',
		description: 'Search the Spotify catalogue. Returns up to 10 results with spotify: URIs.',
		parameters: Type.Object({
			query: Type.String({ description: 'e.g. "artist:Nils Frahm" or "track:Says"' }),
			type: Type.Optional(lit(['track', 'artist', 'album', 'playlist', 'show', 'episode'] as const)),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
		}),
		async execute(_id, p) {
			return text(await search(p.query, (p.type ?? 'track') as SearchType, p.limit));
		},
	});

	pi.registerTool({
		name: 'spotify_create_playlist',
		label: 'Spotify: create playlist',
		description:
			"Create a new playlist in the person's account and add tracks or episodes to it by spotify: URI (get URIs from spotify_library or spotify_search). Private unless public is true.",
		promptGuidelines: ['Only use URIs that came back from spotify_library or spotify_search; never make them up.'],
		parameters: Type.Object({
			name: Type.String(),
			description: Type.Optional(Type.String()),
			uris: Type.Array(Type.String(), { minItems: 1 }),
			public: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, p, _signal, _onUpdate, ctx) {
			if (ctx.hasUI && !(await ctx.ui.confirm('Create Spotify playlist?', `"${p.name}" with ${p.uris.length} items`)))
				return text('The person declined; no playlist was created.');
			const r = await createPlaylist(p.name, p.uris, { description: p.description, public: p.public });
			return text(`Created ${r.url} with ${r.added} items${r.skipped ? ` (${r.skipped} invalid URIs skipped)` : ''}.`);
		},
	});

	pi.registerCommand('spotify-login', {
		description: 'Connect rundown to your Spotify account (one time)',
		handler: async (_args, ctx) => {
			ctx.ui.notify('Opening Spotify in your browser…', 'info');
			const who = await login((m) => ctx.ui.notify(m, 'info'));
			ctx.ui.notify(`Connected to Spotify as ${who}.`, 'info');
		},
	});
}
