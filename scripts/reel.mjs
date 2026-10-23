#!/usr/bin/env node
// A before/after reel for posting: the take, then each version, each with a small label. 1920x1080, 30 fps.
//   node reel.mjs --out reel.mp4 --clip take.mp4="the take" --clip v1-720p.mp4="new can" [--clip ...] [--side]
// --side shows the take and each version next to each other instead of one after another.
// Labels are drawn with headless Chrome (CHROME=path to override); without Chrome the reel has no labels.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2), out = argv[argv.indexOf('--out') + 1], side = argv.includes('--side');
const clips = argv.flatMap((a, i) => (a === '--clip' ? [argv[i + 1]] : [])).map((s) => { const k = s.indexOf('='); return k > 0 ? { file: s.slice(0, k), label: s.slice(k + 1) } : { file: s, label: '' }; });
if (!out || clips.length < 2) { console.error('usage: reel.mjs --out reel.mp4 --clip take.mp4="the take" --clip version.mp4="label" [...] [--side]'); process.exit(2); }
for (const c of clips) if (!existsSync(c.file)) { console.error(`no such clip: ${c.file}`); process.exit(1); }
const W = 1920, H = 1080, tmp = mkdtempSync(join(tmpdir(), 'recast-reel-'));
const ff = (args) => execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const hasAudio = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim() !== '';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
function labelPng(text, w, h, i) {   // a transparent frame with the label in the bottom-left corner
  if (!CHROME || !text) return null;
  const html = join(tmp, `l${i}.html`), png = join(tmp, `l${i}.png`);
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  writeFileSync(html, `<html><body style="margin:0;width:${w}px;height:${h}px;background:transparent;position:relative;font-family:-apple-system,Helvetica,Arial,sans-serif"><div style="position:absolute;left:${Math.round(w * 0.03)}px;bottom:${Math.round(h * 0.05)}px;padding:${Math.round(h * 0.012)}px ${Math.round(h * 0.022)}px;border-radius:${Math.round(h * 0.012)}px;background:rgba(10,10,10,.72);color:#fff;font-size:${Math.round(h * 0.042)}px;font-weight:650;letter-spacing:.01em">${esc}</div></body></html>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${w},${h}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore' });
  return existsSync(png) ? png : null;
}

// Each clip fitted to its box with black bars, 30 fps, stereo sound (silence if it has none), label on top.
function segment(c, i, w, h) {
  const o = join(tmp, `s${i}.mp4`), lab = labelPng(c.label, w, h, i), a = hasAudio(c.file);
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`;
  const inputs = ['-i', c.file, ...(lab ? ['-i', lab] : []), ...(a ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'])];
  const vf = lab ? `[0:v]${fit}[v0];[v0][1:v]overlay=0:0[v]` : `[0:v]${fit}[v]`, ai = a ? '0:a' : `${lab ? 2 : 1}:a`;
  ff([...inputs, '-filter_complex', vf, '-map', '[v]', '-map', ai, '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-ar', '48000', '-ac', '2', o]);
  return o;
}

if (side) {   // take on the left, each version on the right, one pair after another
  const [take, ...versions] = clips, pairs = versions.map((v, i) => {
    const l = segment(take, `L${i}`, W / 2, H), r = segment(v, `R${i}`, W / 2, H), o = join(tmp, `p${i}.mp4`);
    ff(['-i', l, '-i', r, '-filter_complex', '[0:v][1:v]hstack[v]', '-map', '[v]', '-map', '1:a', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', o]);
    return o;
  });
  clips.splice(0, clips.length, ...pairs.map((file) => ({ file, label: '' })));
}
const segs = side ? clips.map((c) => c.file) : clips.map((c, i) => segment(c, i, W, H));
ff([...segs.flatMap((s) => ['-i', s]), '-filter_complex', `${segs.map((_, i) => `[${i}:v][${i}:a]`).join('')}concat=n=${segs.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-movflags', '+faststart', out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`→ ${out} (${segs.length} segments${side ? ', side by side' : ''}${CHROME ? '' : ', no labels: Chrome not found'})`);
