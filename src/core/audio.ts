// Text to speech, one segment at a time, then everything joined into one MP3.
//
// Engines:
//   say      macOS built-in, nothing to install. Fine for testing.
//   piper    fast local voices on CPU, dozens of languages (pip install piper-tts)
//   openai   any OpenAI-compatible /v1/audio/speech server: OpenAI, or an open
//            model you host yourself (Kokoro, Chatterbox, Qwen3-TTS, CosyVoice)
//   command  any program; gets {in} (a UTF-8 text file), {out}, {voice}

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Engine } from './config.ts';

const run = promisify(execFile);

// Every intermediate file uses the same format so concatenation is lossless.
const PCM = ['-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le'];

export interface TtsOptions {
	engine: Engine;
	voice?: string;
	command?: string;
	piperDir?: string;
	url?: string;
	model?: string;
	keyEnv?: string;
}

async function ffmpeg(args: string[]) {
	await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

export async function duration(file: string): Promise<number> {
	const { stdout } = await run('ffprobe', [
		'-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
	]);
	return Math.round(parseFloat(stdout) * 1000);
}

// Long passages are split at sentence ends so one failure doesn't lose a
// whole segment, and so engines with input limits still work.
export function chunk(text: string, max = 900): string[] {
	const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?。！？]+[.!?。！？]+["')\]]*\s*|.+$/g) ?? [];
	const out: string[] = [];
	let cur = '';
	for (const s of sentences) {
		if (cur && (cur + s).length > max) {
			out.push(cur.trim());
			cur = '';
		}
		cur += s;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

async function speakOnce(text: string, out: string, opts: TtsOptions) {
	const input = out.replace(/\.wav$/, '.txt');
	writeFileSync(input, text);
	const raw = out.replace(/\.wav$/, '.raw');
	const audio = raw + '.audio';
	switch (opts.engine) {
		case 'say':
			await run('say', [...(opts.voice ? ['-v', opts.voice] : []), '-o', audio + '.aiff', '-f', input]);
			await ffmpeg(['-i', audio + '.aiff', ...PCM, out]);
			return;
		case 'piper': {
			const dir = opts.piperDir ?? join(homedir(), '.rundown', 'voices');
			if (!opts.voice) throw new Error('piper needs a voice, e.g. en_US-lessac-medium');
			await run('piper', ['-m', opts.voice, '--data-dir', dir, '-i', input, '-f', audio + '.wav']);
			await ffmpeg(['-i', audio + '.wav', ...PCM, out]);
			return;
		}
		case 'openai': {
			const base = (opts.url ?? 'https://api.openai.com').replace(/\/+$/, '');
			const key = process.env[opts.keyEnv ?? 'OPENAI_API_KEY'];
			const res = await fetch(`${base}/v1/audio/speech`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
				body: JSON.stringify({ model: opts.model ?? 'tts-1', voice: opts.voice ?? 'alloy', input: text, response_format: 'wav' }),
			});
			if (!res.ok) throw new Error(`TTS server ${res.status}: ${(await res.text()).slice(0, 200)}`);
			writeFileSync(audio + '.wav', Buffer.from(await res.arrayBuffer()));
			await ffmpeg(['-i', audio + '.wav', ...PCM, out]);
			return;
		}
		case 'command': {
			if (!opts.command) throw new Error('tts is "command" but ttsCommand is empty');
			const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
			const cmd = opts.command
				.replaceAll('{in}', q(input))
				.replaceAll('{out}', q(audio))
				.replaceAll('{voice}', q(opts.voice ?? ''));
			await run('/bin/sh', ['-c', cmd]);
			await ffmpeg(['-i', audio, ...PCM, out]);
			return;
		}
	}
}

// Voice one segment into dir/<name>.wav, retrying each chunk once.
export async function speak(text: string, dir: string, name: string, opts: TtsOptions): Promise<string> {
	const parts = chunk(text);
	const files: string[] = [];
	for (const [i, part] of parts.entries()) {
		const f = join(dir, `${name}-${String(i + 1).padStart(2, '0')}.wav`);
		try {
			await speakOnce(part, f, opts);
		} catch {
			await speakOnce(part, f, opts);
		}
		files.push(f);
	}
	const out = join(dir, `${name}.wav`);
	await concat(files, out, 0, dir);
	return out;
}

// Join WAVs with `gapMs` of silence between them.
export async function concat(files: string[], out: string, gapMs: number, dir: string) {
	const list: string[] = [];
	const silence = join(dir, `gap-${gapMs}.wav`);
	if (gapMs > 0) await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(gapMs / 1000), ...PCM, silence]);
	files.forEach((f, i) => {
		if (i > 0 && gapMs > 0) list.push(`file '${silence}'`);
		list.push(`file '${f}'`);
	});
	const listFile = out + '.list';
	writeFileSync(listFile, list.join('\n') + '\n');
	await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out]);
}

export async function toMp3(wav: string, mp3: string) {
	await ffmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', mp3]);
}
