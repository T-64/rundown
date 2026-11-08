---
description: Make today's audio rundown and save it to Spotify
argument-hint: "[anything extra to cover]"
---
Make today's rundown episode.

1. Call `rundown_gather` and read everything it returns, including the listener's notes in `prefs.notes` and the recent episodes.
2. Write a script for about `prefs.minutes` minutes of speech (roughly 140 words a minute) in `prefs.language`.
   - Open with the date and the weather for `weather.place`.
   - Pick the few headlines that matter most today. Skip anything already covered in the recent episodes unless there's real news on it.
   - Say where each story comes from, in passing, the way a radio host would.
   - Write for the ear: short sentences, no lists, no URLs, no markdown. Spell out numbers that would sound odd read aloud.
   - Each segment gets a short title (it becomes a chapter) and the source URLs it used.
   - A segment may be in another language if the notes ask for it (say, a German practice segment). Set its `language`; `prefs.voiceLanguages` lists the languages that have a voice.
   - Close in one or two sentences. No sign-off catchphrase.
3. Call `rundown_produce` with the script.
4. Tell me the episode link and how long it is. If something failed, say what and stop.

${@:-}
