---
name: spotify
description: Read the person's own Spotify listening (top tracks and artists, recently played, playlists, liked songs, followed podcasts, now playing), search Spotify, and make playlists for them. Use when they ask about their music or podcasts, want a playlist, or want suggestions based on what they listen to.
---

# Spotify

The tools may carry a server prefix, such as `mcp__rundown__spotify_library`.

- `spotify_library` with a `view`: `top_tracks`, `top_artists` (with `range`: `short_term` ≈ 4 weeks, `medium_term` ≈ 6 months, `long_term` = all time), `recently_played`, `playlists`, `saved_tracks`, `saved_albums`, `saved_shows`, `now_playing`.
- `spotify_playlist_items` to look inside one playlist.
- `spotify_search` for anything in the catalogue (up to 10 results a call).
- `spotify_create_playlist` to make a playlist from URIs.

Every result line ends with a `spotify:` URI. Only put URIs into a playlist that one of these tools returned; never write one from memory.

Making a playlist:
1. Look at what they actually listen to first (`top_tracks`, `top_artists`, `recently_played`), at the range that fits the request.
2. For new music, search for specific artists or tracks you have a reason to suggest, and say briefly why each fits.
3. Tell the person the name and the track list, and ask before calling `spotify_create_playlist`. Playlists are private unless they ask otherwise.
4. Give them the link.

If a tool says the account isn't connected, tell the person to run `rundown spotify-login` once (or `/spotify-login` in pi).
