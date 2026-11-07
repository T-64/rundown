#!/usr/bin/env node
// Command line for things that don't need an agent: testing the audio
// pipeline, checking sources, and setting up the daily schedule.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME, ensureHome, loadPrefs, savePrefs, PREFS_FILE } from './core/config.ts';
import { gather, produce } from './core/episode.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const usage = `rundown <command>

  init                         write a starter ${PREFS_FILE}
  gather                       print today's material as JSON
  produce <script.json>        voice a script and save it to Spotify
      --dry-run                make the audio only, don't upload
  schedule --at 08:00          write a launchd job that runs \`pi -p /rundown\`
      [--weekdays]             Monday to Friday only
`;

function which(bin: string) {
	try {
		return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8' }).trim();
	} catch {
		return undefined;
	}
}

function schedule() {
	const at = opt('at') ?? '08:00';
	const [hour, minute] = at.split(':').map(Number);
	const pi = which('pi');
	if (!pi) throw new Error('pi is not on your PATH');
	const days = flag('weekdays') ? [1, 2, 3, 4, 5] : [undefined];
	const intervals = days
		.map(
			(d) =>
				`      <dict>${d ? `<key>Weekday</key><integer>${d}</integer>` : ''}<key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`,
		)
		.join('\n');
	const label = 'dev.rundown.daily';
	const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${label}</string>
    <key>ProgramArguments</key>
    <array><string>${pi}</string><string>-p</string><string>/rundown</string></array>
    <key>WorkingDirectory</key><string>${HOME}</string>
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key><string>${process.env.PATH}</string></dict>
    <key>StartCalendarInterval</key>
    <array>
${intervals}
    </array>
    <key>StandardOutPath</key><string>${join(HOME, 'schedule.log')}</string>
    <key>StandardErrorPath</key><string>${join(HOME, 'schedule.log')}</string>
  </dict>
</plist>
`;
	ensureHome();
	const file = join(HOME, `${label}.plist`);
	writeFileSync(file, plist);
	const dest = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
	console.log(`Wrote ${file}

To turn it on:
  cp ${file} ${dest}
  launchctl bootstrap gui/$(id -u) ${dest}

Scheduled runs have no one to ask, so they only upload if preferences.md has:
  autoPublish: true`);
}

async function main() {
	switch (cmd) {
		case 'init':
			savePrefs(loadPrefs());
			console.log(`Wrote ${PREFS_FILE}`);
			break;
		case 'gather':
			console.log(JSON.stringify(await gather(), null, 2));
			break;
		case 'produce': {
			const file = args.find((a) => !a.startsWith('--'));
			if (!file) throw new Error('produce needs a script.json');
			const script = JSON.parse(readFileSync(file, 'utf8'));
			const dry = flag('dry-run');
			const r = await produce(script, { publish: !dry, record: !dry, onProgress: (m) => console.error(m) });
			console.log(JSON.stringify(r, null, 2));
			break;
		}
		case 'schedule':
			schedule();
			break;
		default:
			console.log(usage);
			process.exitCode = cmd ? 1 : 0;
	}
}

main().catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
