---
name: rundown
description: Make today's short audio briefing (weather, headlines, anything the listener asked for) and save it to their Spotify library. Use when the person asks for their rundown, morning briefing or daily podcast, or when a scheduled job asks for it.
---

# Daily rundown

The rundown tools may be named `rundown_gather` / `rundown_produce`, or carry a server prefix such as `mcp__rundown__rundown_gather`.

1. Call `rundown_gather`. Read all of it: the listener's notes in `prefs.notes`, the weather, the headlines, and the recent episodes.
2. Write a script for about `prefs.minutes` minutes of speech (roughly 140 words a minute) in `prefs.language`.
   - Open with the date and the weather for `weather.place`.
   - Pick the few headlines that matter most today. Skip anything the recent episodes already covered unless there's real news on it.
   - Say where each story comes from, in passing, the way a radio host would.
   - Write for the ear: short sentences, no lists, no URLs, no markdown. Spell out numbers that would sound odd read aloud.
   - One segment per topic. Each has a short title (it becomes a chapter) and the source URLs it used.
   - A segment may be in another language if the notes ask for it (say, a German practice segment). Set its `language`; `prefs.voiceLanguages` lists the languages that have a voice.
   - Close in one or two sentences.
3. Ask the person whether to save it to Spotify, unless this is a scheduled run and the notes say to publish automatically.
4. Call `rundown_produce` with the script and `publish` set to their answer.
5. Report the episode link and length. If something failed, say what and stop.
