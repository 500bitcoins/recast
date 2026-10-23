#!/usr/bin/env node
// Step 1: probe the take and cut it into parts the edit models accept.
//   node prep.mjs --src take.mp4 --dir work/my-take [--part 10]
// Writes <dir>/recast.json (length, frame rate, size, sound) and, per part:
//   part-N.mp4        H.264, long side at most 1920 px, under 10 MB, no audio (what Darkwoods takes as a video ref)
//   part-N-first.png  its first frame, which target.mjs turns into the target frame
// plus audio.m4a, the take's own sound, which finish.mjs puts back at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const src = arg('src'), dir = arg('dir'), partMax = Number(arg('part', 10));
if (!src || !dir) { console.error('usage: prep.mjs --src take.mp4 --dir work/<name> [--part 10]'); process.exit(2); }
if (!existsSync(src)) { console.error(`no such file: ${src}`); process.exit(1); }
mkdirSync(dir, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', src], { encoding: 'utf8' }));
const v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
if (!v) { console.error('no video stream'); process.exit(1); }
const duration = Number(p.format.duration || v.duration), [fn, fd] = v.r_frame_rate.split('/').map(Number), fps = fn / (fd || 1);
const long = Math.max(v.width, v.height), scale = long > 1920 ? 1920 / long : 1;
const even = (x) => Math.max(2, Math.round(x / 2) * 2), w = even(v.width * scale), h = even(v.height * scale);

// Equal parts no longer than partMax seconds (edits take 2–15 s; seedance-2.5-edit returns at most 10 s).
const n = Math.max(1, Math.ceil(duration / partMax - 1e-6)), len = duration / n, parts = [];
for (let i = 0; i < n; i++) {
  const start = i * len, file = join(dir, `part-${i + 1}.mp4`), first = join(dir, `part-${i + 1}-first.png`);
  let crf = 20;
  for (;;) {
    ff(['-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', src, '-vf', `scale=${w}:${h},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-an', '-movflags', '+faststart', file]);
    if (statSync(file).size < 9.5 * 1024 * 1024 || crf >= 34) break;
    crf += 3;   // over Darkwoods' 10 MB limit for a video reference: compress harder
  }
  ff(['-i', file, '-frames:v', '1', first]);
  parts.push({ n: i + 1, start: +start.toFixed(3), seconds: +len.toFixed(3), file: `part-${i + 1}.mp4`, first: `part-${i + 1}-first.png`, mb: +(statSync(file).size / 1048576).toFixed(2) });
}
if (a) ff(['-i', src, '-vn', '-c:a', 'aac', '-b:a', '192k', join(dir, 'audio.m4a')]);

const manifest = { src: resolve(src), seconds: +duration.toFixed(3), fps: +fps.toFixed(3), width: v.width, height: v.height, partSize: [w, h], audio: Boolean(a), parts, versions: [] };
writeFileSync(join(dir, 'recast.json'), JSON.stringify(manifest, null, 2));
console.log(`${src}: ${duration.toFixed(2)} s, ${fps.toFixed(2)} fps, ${v.width}x${v.height}, ${a ? 'with' : 'no'} sound → ${n} part${n > 1 ? 's' : ''} of ${len.toFixed(2)} s at ${w}x${h} (${parts.map((x) => `${x.mb} MB`).join(', ')})`);
