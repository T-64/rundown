# pi-rundown

A daily audio briefing for your [pi](https://github.com/badlogic/pi-mono) agent. It gathers the weather and the day's headlines, your agent writes a short script, rundown voices it on your machine, and the episode lands in your Spotify library with chapters and source links.

It's a rebuild, from open parts, of the morning podcast in Spotify's Studio app. I wrote about how Studio works [here](https://t-64.github.io/blog/spotify-studio/).

```
/rundown
```

## What it does

1. `rundown_gather` fetches weather from [Open-Meteo](https://open-meteo.com) and headlines from the RSS feeds you choose, plus the titles of your last few episodes so stories don't repeat.
2. Your agent writes the script, one segment per chapter.
3. `rundown_produce` voices each segment, joins them into an MP3 with ffmpeg, and works out chapter times and when to show each source link.
4. It asks before uploading, then hands the file to [Save to Spotify](https://github.com/spotify/save-to-spotify), Spotify's open-source CLI, which puts it in a private show in your library.

Everything except the upload runs locally. Nothing from your Spotify account is read or sent to the model.

## Install

You need macOS (for the built-in `say` voice; see below for other engines), Node 22.18 or later, and ffmpeg.

```bash
brew install ffmpeg
pi install git:github.com/T-64/pi-rundown
```

For uploading, install Save to Spotify and log in with your own account:

```bash
curl -fsSL https://saveto.spotify.com/install.sh | bash
save-to-spotify auth login
```

Without it, rundown still makes the MP3 and tells you where it is.

## Set up

Run `/rundown-setup` in pi, or edit `~/.rundown/preferences.md` directly:

```markdown
---
show: Morning Rundown
city: Stuttgart
language: en
minutes: 5
feeds:
  - https://feeds.bbci.co.uk/news/world/rss.xml
  - https://www.tagesschau.de/index~rss2.xml
tts: say
voice: Samantha
autoPublish: false
---

Calm and plain. No hype. Say where each story comes from.
```

The text under the frontmatter is passed to the agent as-is, so use it to steer the writing.

## Better voices

`say` is fine for testing. For something nicer, point rundown at any local text-to-speech command. It gets the text file as `{in}` and should write audio to `{out}`:

```yaml
tts: command
ttsCommand: kokoro-tts {in} {out} --voice af_heart
```

## Every morning

From a clone of this repo:

```bash
node src/cli.ts schedule --at 08:00 --weekdays
```

This writes a launchd job that runs `pi -p /rundown` and prints the two commands to turn it on. Scheduled runs have nobody to confirm the upload, so they only publish if you set `autoPublish: true`.

## Without an agent

```bash
node src/cli.ts gather                                  # today's material as JSON
node src/cli.ts produce examples/script.json --dry-run  # audio only
```

## Files

```
~/.rundown/preferences.md   your settings and notes
~/.rundown/history.md       one entry per episode
~/.rundown/episodes/        audio, script and timeline for each run
```

## Notes

- Studio's own pipeline (Spotify's skills, prompts and closed tools) was not copied. This is written from scratch against public docs.
- Save to Spotify uploads go to a private show that only you can see.
- Not affiliated with Spotify.

MIT
