#!/usr/bin/env node
// Step 4: measure a render against its source part, before paying for the final.
//   node check.mjs --dir work/my-take --file part-1-v1-480p.mp4 [--mode swap|recast|restyle]
//   node check.mjs --a source.mp4 --b render.mp4 [--mode swap]           (any two clips)
// Scores, all from frames sampled at 12 fps and shrunk to 160 px wide, in grey:
//   length          the render is as long as the source (within 5%; one a few percent short is compared on the take's timeline)
//   changed         share of the frame that differs from the source: near 0 means the edit did nothing
//   structure       how much of the layout and edges survive (correlation of edge maps)
//   motion match    the render moves when the source moves (correlation of frame-to-frame change)
//   jumps           frames where the render lurches and the source doesn't: a pose resets or morphs
//   tail drift      the last frames wandering away from the source (suggests a trim point)
//   frozen frames   the render stalls while the source moves
// Verdict: pass, check (look before using) or fail, with reasons. Also writes a contact sheet, source on top and
// render below at 6 moments, for a human (or Claude) to look at hands, faces, brand marks and text.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'), mode = arg('mode');
let A = arg('a'), B = arg('b'), part = null, man = null;
if (dir) {
  man = JSON.parse(readFileSync(join(dir, 'recast.json'), 'utf8'));
  const f = arg('file'); const v = man.versions.find((x) => x.file === f);
  part = man.parts.find((x) => x.n === (v?.part ?? Number((f || '').match(/^part-(\d+)/)?.[1] || 1)));
  A = join(dir, part.file); B = join(dir, f);
}
if (!A || !B || !existsSync(A) || !existsSync(B)) { console.error('usage: check.mjs --dir work/<name> --file part-1-v1-480p.mp4 | --a source.mp4 --b render.mp4'); process.exit(2); }
const kind = mode || man?.versions.find((x) => join(dir, x.file) === B)?.mode || 'swap';

const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' }));
const pa = probe(A), pb = probe(B);
const W = 160, H = Math.max(2, Math.round((W * pa.streams[0].height) / pa.streams[0].width / 2) * 2), FPS = 12;
const dA = Number(pa.format.duration), dB = Number(pb.format.duration);
// The render is sampled on the take's timeline: edit models that return 4n+1 frames give back the whole take a few
// percent faster (8.00 s comes back as 7.71 s), and finish.mjs stretches it back to the take's length.
const frames = (f, stretch = 1) => {
  const buf = execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', f, '-vf', `setpts=PTS*${stretch},fps=${FPS},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(buf.length / (W * H)); return Array.from({ length: n }, (_, i) => buf.subarray(i * W * H, (i + 1) * W * H));
};
const fa = frames(A), fb = frames(B, dA / dB), n = Math.min(fa.length, fb.length);

const mean = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
const median = (x) => { const s = [...x].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? 0; };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; };
const absdiff = (p, q) => { let s = 0; for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - q[i]); return s / p.length; };
const changedShare = (p, q) => { let c = 0; for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - q[i]) > 25) c++; return c / p.length; };
const edges = (f) => { const e = new Float32Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const gx = f[i - W + 1] + 2 * f[i + 1] + f[i + W + 1] - f[i - W - 1] - 2 * f[i - 1] - f[i + W - 1]; const gy = f[i + W - 1] + 2 * f[i + W] + f[i + W + 1] - f[i - W - 1] - 2 * f[i - W] - f[i - W + 1]; e[i] = Math.hypot(gx, gy); } return e; };

const changed = [], structure = [], mA = [0], mB = [0];
for (let t = 0; t < n; t++) {
  changed.push(changedShare(fa[t], fb[t]));
  if (t % 3 === 0) structure.push(pearson(Array.from(edges(fa[t])), Array.from(edges(fb[t]))));
  if (t) { mA.push(absdiff(fa[t], fa[t - 1])); mB.push(absdiff(fb[t], fb[t - 1])); }
}
const medB = median(mB.slice(1));
const jumps = [], frozen = [];
for (let t = 1; t < n; t++) {
  if (mB[t] > 8 && mB[t] > 2.5 * (mA[t] + 2) && mB[t] > 3 * (medB + 0.5)) jumps.push(+(t / FPS).toFixed(2));
  if (mB[t] < 0.25 && mA[t] > 1.5) frozen.push(+(t / FPS).toFixed(2));
}
const head = changed.slice(0, Math.max(1, Math.floor(n * 0.7))), tailStart = Math.floor(n * 0.85), tail = changed.slice(tailStart);
const base = median(head), drift = tail.length >= 3 && mean(tail) > base * 1.6 + 0.04;
const trimAt = drift ? +(((tailStart + tail.findIndex((c) => c > base * 1.6 + 0.04)) / FPS)).toFixed(2) : null;
const moving = Math.sqrt(mean(mA.slice(1).map((v) => (v - mean(mA.slice(1))) ** 2))) > 0.5;
const scores = {
  length: { source: +dA.toFixed(2), render: +dB.toFixed(2), ok: Math.abs(dB / dA - 1) <= 0.05, stretched: Math.abs(dA - dB) > 0.05 },
  changed: +mean(changed).toFixed(3), changedMax: +Math.max(...changed).toFixed(3),
  structure: +mean(structure).toFixed(3),
  motionMatch: moving ? +pearson(mA.slice(1), mB.slice(1)).toFixed(3) : null,
  jumps, tailDrift: drift ? { from: trimAt, base: +base.toFixed(3), tail: +mean(tail).toFixed(3) } : null,
  frozenFrames: frozen.length,
};

const fail = [], look = [], info = [];
if (!scores.length.ok) fail.push(`length ${dB.toFixed(2)} s vs ${dA.toFixed(2)} s`);
else if (scores.length.stretched) info.push(`render is ${dB.toFixed(2)} s for a ${dA.toFixed(2)} s take: compared on the take's timeline; finish.mjs stretches it back`);
if (scores.changed < 0.015) fail.push('the edit changed almost nothing');
if (jumps.length >= 2) fail.push(`${jumps.length} jumps (at ${jumps.join(', ')} s)`); else if (jumps.length) look.push(`a jump at ${jumps[0]} s`);
if (frozen.length >= 4) fail.push(`${frozen.length} frozen frames`); else if (frozen.length) look.push(`${frozen.length} frozen frame${frozen.length > 1 ? 's' : ''}`);
if (scores.motionMatch !== null && scores.motionMatch < 0.4) fail.push(`motion doesn't follow the source (${scores.motionMatch})`); else if (scores.motionMatch !== null && scores.motionMatch < 0.6) look.push(`motion match only ${scores.motionMatch}`);
// A new location replaces most of the edges behind the person, so recasts are allowed a lower structure score.
const [minStructure, lookStructure] = { swap: [0.45, 0.6], recast: [0.3, 0.45], restyle: [0.2, 0.3] }[kind] || [0.45, 0.6];
if (scores.structure < minStructure) fail.push(`layout lost (structure ${scores.structure})`); else if (scores.structure < lookStructure) look.push(`structure ${scores.structure}`);
if (kind === 'swap' && scores.changed > 0.6) look.push(`${Math.round(scores.changed * 100)}% of the frame changed for a one-element swap`);
if (drift) look.push(`tail drift from ${trimAt} s: trim every version there`);
const verdict = fail.length ? 'fail' : look.length ? 'check' : 'pass';

// Contact sheet: 6 moments, source row over render row.
const out = dir ? join(dir, 'checks') : join(process.cwd(), 'checks');
mkdirSync(out, { recursive: true });
const stem = basename(B, '.mp4'), sheet = join(out, `${stem}-sheet.png`), row = (f, d, o) => execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', f, '-vf', `fps=6/${d.toFixed(3)},scale=320:-2,tile=6x1`, '-frames:v', '1', o]);
row(A, dA, join(out, `${stem}-a.png`)); row(B, dB, join(out, `${stem}-b.png`));
execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', join(out, `${stem}-a.png`), '-i', join(out, `${stem}-b.png`), '-filter_complex', '[0][1]vstack', sheet]);
const report = { file: B, source: A, mode: kind, verdict, fail, look, notes: info, scores, sheet };
writeFileSync(join(out, `${stem}.json`), JSON.stringify(report, null, 2));
console.log(`${basename(B)}: ${verdict.toUpperCase()}${fail.length ? ` (${fail.join('; ')})` : ''}${look.length ? `${fail.length ? ' · also' : ' ·'} look at: ${look.join('; ')}` : ''}`);
if (info.length) console.log(`  note: ${info.join('; ')}`);
console.log(`  changed ${Math.round(scores.changed * 100)}% · structure ${scores.structure} · motion match ${scores.motionMatch ?? 'n/a (static shot)'} · jumps ${jumps.length} · frozen ${frozen.length} · length ${dB.toFixed(2)}/${dA.toFixed(2)} s`);
console.log(`  contact sheet: ${sheet}`);
process.exit(verdict === 'fail' ? 1 : 0);
