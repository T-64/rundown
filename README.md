# rundown

A daily audio briefing for your agent. It gathers the weather and the day's headlines, your agent writes a short script, rundown voices it, and the episode lands in your Spotify library with chapters and source links.

It works with [pi](https://github.com/badlogic/pi-mono) as an extension, and with [DSH](https://github.com/deepseek-ai/deepseek-harness) or any other MCP client through a small MCP server. Same package, same code.

I built it after taking apart the morning podcast in Spotify's Studio app ([write-up](https://t-64.github.io/blog/spotify-studio/)). I wanted the same thing from open parts, in more than one language, and running on my own server.

## How it works

1. `rundown_gather` fetches the weather from [Open-Meteo](https://open-meteo.com), headlines from the RSS feeds you pick, and the titles of your last few episodes so stories don't repeat.
2. Your agent writes the script. Each segment becomes a chapter, and a segment can be in a different language from the rest (a German practice segment in an English episode, say).
3. `rundown_produce` voices each segment, joins them into an MP3 with ffmpeg, and works out chapter times and when to show each source link.
4. If you agree, it uploads the episode with [Save to Spotify](https://github.com/spotify/save-to-spotify), Spotify's open-source CLI, into a private show only you can see.

Nothing from your Spotify account is read or sent to the model.

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

and point it at [`skills/rundown/SKILL.md`](skills/rundown/SKILL.md).

## Uploading

Uploads go through Save to Spotify. If you have Spotify's desktop app on macOS you already have it; it ships inside the app and rundown finds it there. Otherwise [install it](https://github.com/spotify/save-to-spotify#install). Then log in once with your own account:

```bash
save-to-spotify auth login
```

Without it, rundown still makes the MP3 and tells you where it is.

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
