# rundown

Spotify for your own agent. It can read your listening (top tracks and artists, recently played, playlists, liked songs, podcasts), make playlists, and produce a daily audio briefing: it gathers the weather and the day's headlines, your agent writes a short script, rundown voices it, and the episode lands in your Spotify library with chapters and source links.

It works with [pi](https://github.com/badlogic/pi-mono) as an extension, and with [DSH](https://github.com/deepseek-ai/deepseek-harness) or any other MCP client through a small MCP server. Same package, same code.

I built it after taking apart the morning podcast in Spotify's Studio app ([write-up](https://t-64.github.io/blog/spotify-studio/)). I wanted the same thing from open parts, in more than one language, and running on my own server.

## How the briefing works

1. `rundown_gather` fetches the weather from [Open-Meteo](https://open-meteo.com), headlines from the RSS feeds you pick, and the titles of your last few episodes so stories don't repeat.
2. Your agent writes the script. Each segment becomes a chapter, and a segment can be in a different language from the rest (a German practice segment in an English episode, say).
3. `rundown_produce` voices each segment, joins them into an MP3 with ffmpeg, and works out chapter times and when to show each source link.
4. If you agree, it uploads the episode with [Save to Spotify](https://github.com/spotify/save-to-spotify), Spotify's open-source CLI, into a private show only you can see.

The briefing itself doesn't read your Spotify account; the [account tools](#your-spotify-account) are separate and need their own one-time login.

## Install

You need Node 22.18 or later and ffmpeg.

```bash
git clone https://github.com/T-64/rundown ~/rundown
cd ~/rundown && npm install
```

**pi**

```bash
pi install ~/rundown
```

Then `/rundown` in pi. `/rundown-setup` edits your preferences.

**DSH**

Add the MCP server and the skill to your profile. [`examples/dsh.patch.yml`](examples/dsh.patch.yml) has both; replace the path and either pass it with `--patch` or paste it into your profile's `cordis.patch.yml`:

```bash
dsh --profile headless --patch ~/rundown/examples/dsh.patch.yml "make today's rundown"
```

**Anything else that speaks MCP** (Claude Code, Codex…)

```bash
claude mcp add rundown -- node ~/rundown/src/mcp.ts
```

and point it at the skills in [`skills/`](skills/): `rundown` for the briefing, `spotify` for your account.

## Uploading

Uploads go through Save to Spotify. If you have Spotify's desktop app on macOS you already have it; it ships inside the app and rundown finds it there. Otherwise [install it](https://github.com/spotify/save-to-spotify#install). Then log in once with your own account:

```bash
save-to-spotify auth login
```

Without it, rundown still makes the MP3 and tells you where it is.

## Your Spotify account

rundown can also read your Spotify account and make playlists, so your agent can answer "what have I had on repeat this month?" or "make me a playlist for a long train ride from what I like".

| Tool | What it does |
|---|---|
| `spotify_library` | top tracks or artists (4 weeks, 6 months, all time), recently played, playlists, liked songs, saved albums, followed podcasts, now playing |
| `spotify_playlist_items` | what's in one of your playlists |
| `spotify_search` | search the catalogue (10 results a call) |
| `spotify_create_playlist` | make a private playlist from tracks or episodes; asks first in pi |

This uses the public Web API with your own developer app. Setup takes a couple of minutes:

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app. Since February 2026 this needs Premium, and an app in development mode is limited to five users, which is plenty for yourself.
2. In the app's settings, add the redirect URI `http://127.0.0.1:8888/callback` and tick **Web API**.
3. Copy the Client ID into `~/.rundown/preferences.md`:
   ```yaml
   spotifyClientId: 0123456789abcdef...
   ```
   It isn't a secret: rundown logs in with PKCE, so there's no client secret anywhere.
4. Log in once:
   ```bash
   node src/cli.ts spotify-login     # or /spotify-login in pi
   node src/cli.ts spotify top_artists --range short_term
   ```

The login is kept in `~/.rundown/spotify.json` (readable only by you) and refreshed automatically. What the tools read goes to whichever model your agent uses, so pick one you're comfortable sending your listening history to.

## Voices

Pick an engine in `~/.rundown/preferences.md`, and a voice per language:

| `tts` | What it is | Good for |
|---|---|---|
| `say` | macOS built-in | trying it out; nothing to install |
| `piper` | [Piper](https://github.com/OHF-Voice/piper1-gpl), fast local voices on CPU, dozens of languages | a small server, or offline |
| `openai` | any OpenAI-compatible `/v1/audio/speech` endpoint | the best quality: OpenAI itself, or an open model you host, such as [Kokoro](https://github.com/remsky/Kokoro-FastAPI), Chatterbox Multilingual, Qwen3-TTS or CosyVoice |
| `command` | any program; gets `{in}` (a text file), `{out}` and `{voice}` | everything else |

Piper:

```bash
uv tool install piper-tts
cd ~/.rundown/voices && python -m piper.download_voices en_US-lessac-medium de_DE-thorsten-medium zh_CN-huayan-medium
```

```yaml
tts: piper
voices:
  default: en_US-lessac-medium
  de: de_DE-thorsten-medium
  zh: zh_CN-huayan-medium
```

A server on your own GPU:

```yaml
tts: openai
ttsUrl: http://my-gpu-box:8880
ttsModel: kokoro
ttsKeyEnv: MY_TTS_KEY     # name of an env var, if the server wants a key
voices:
  default: af_heart
```

## Preferences

`~/.rundown/preferences.md` (or run `node src/cli.ts init` for a starter):

```markdown
---
show: Morning Rundown
city: Stuttgart
language: en
minutes: 5
feeds:
  - https://feeds.bbci.co.uk/news/world/rss.xml
  - https://www.tagesschau.de/index~rss2.xml
tts: piper
voices:
  default: en_US-lessac-medium
  de: de_DE-thorsten-medium
autoPublish: false
---

Calm and plain. No hype. Say where each story comes from.
End with a short German practice segment: three words from today's news.
```

The text under the frontmatter goes to the agent as-is, so that's where you steer the writing.

## Every morning

On macOS, from the repo:

```bash
node src/cli.ts schedule --at 08:00 --weekdays
```

writes a launchd job that runs `pi -p /rundown` and prints the commands to turn it on. With DSH, use its scheduler or cron with `dsh --profile headless "make today's rundown"`. Scheduled runs have nobody to confirm the upload, so with pi they only publish if `autoPublish: true`.

## Without an agent

```bash
node src/cli.ts gather                                       # today's material as JSON
node src/cli.ts produce examples/multilingual.json --dry-run # audio only
```

## Files

```
~/.rundown/preferences.md   your settings and notes
~/.rundown/history.md       one entry per episode
~/.rundown/episodes/        audio, script and timeline for each run
```

## Notes

- Written from scratch against public docs. Nothing from Studio (Spotify's skills, prompts or closed tools) is copied.
- Not affiliated with Spotify.

MIT
