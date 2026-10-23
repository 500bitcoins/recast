#!/usr/bin/env node
// Step 5: put the take's own sound back, so lips and steps stay in sync, and join the parts into one clip.
//   node finish.mjs --dir work/my-take --tag v1 [--res 720p] [--trim 7.6] [--keep-audio]
// Every part is stretched back to its source part's exact length first, so versions line up with the take frame for
// frame. --trim cuts the clip at that second (use the same point on every version when check.mjs reports tail drift).
// --keep-audio keeps the render's own sound instead (a new place gets its own ambience). Writes <tag>-<res>.mp4.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const dir = arg('dir'), tag = arg('tag', 'v1'), res = arg('res', '720p'), trim = arg('trim'), keepAudio = has('keep-audio');
if (!dir) { console.error('usage: finish.mjs --dir work/<name> --tag v1 [--res 720p] [--trim 7.6] [--keep-audio]'); process.exit(2); }
const man = JSON.parse(readFileSync(join(dir, 'recast.json'), 'utf8'));
const ff = (args) => execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const size = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split(',').map(Number);
const hasAudio = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim() !== '';

const files = man.parts.map((p) => ({ p, f: join(dir, `part-${p.n}-${tag}-${res}.mp4`) }));
const missing = files.filter((x) => !existsSync(x.f));
if (missing.length) { console.error(`missing renders: ${missing.map((x) => x.f).join(', ')}`); process.exit(1); }
const [w, h] = size(files[0].f), fps = man.fps;

// Each part at the render's size and the take's frame rate, stretched to exactly its source part's length: edit models
// that return 4n+1 frames give the whole take back a few percent faster, so this keeps lips on the take's sound.
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));
const fixed = files.map(({ p, f }, i) => {
  const o = join(dir, `.fix-${tag}-${i}.mp4`), a = keepAudio && hasAudio(f), k = p.seconds / dur(f);
  ff(['-i', f, '-vf', `setpts=PTS*${k.toFixed(6)},scale=${w}:${h},fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=0:${p.seconds},setpts=PTS-STARTPTS`,
    ...(a ? ['-af', `atempo=${(1 / k).toFixed(6)},apad,atrim=0:${p.seconds}`, '-c:a', 'aac'] : ['-an']), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', o]);
  return o;
});
const list = join(dir, `.fix-${tag}.txt`);
writeFileSync(list, fixed.map((f) => `file '${f.split('/').pop()}'`).join('\n'));
const joined = join(dir, `.joined-${tag}.mp4`);
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

const out = join(dir, `${tag}-${res}.mp4`), cut = trim ? ['-t', String(trim)] : [];
if (man.audio && !keepAudio) ff(['-i', joined, '-i', join(dir, 'audio.m4a'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', ...cut, '-movflags', '+faststart', out]);
else ff(['-i', joined, '-c', 'copy', ...cut, '-movflags', '+faststart', out]);
for (const f of [...fixed, list, joined]) unlinkSync(f);
console.log(`→ ${out} (${w}x${h}, ${man.parts.length} part${man.parts.length > 1 ? 's' : ''}, ${man.audio && !keepAudio ? "the take's own sound" : keepAudio ? "the render's sound" : 'no sound'}${trim ? `, trimmed at ${trim} s` : ''})`);
