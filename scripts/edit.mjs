#!/usr/bin/env node
// Steps 3 and 5: render an edit of one part. A 480p draft first; the full-resolution final only for drafts that pass
// check.mjs. Without --yes it prints the price and stops, so the cost is seen before anything is spent.
//   node edit.mjs --dir work/my-take --part 1 --mode swap|recast|restyle --change "..." [--refs a.png=label,...]
//                 [--target] [--style "Cel-Shaded CG Anime"] [--model ...] [--res 480p|720p|1080p] [--tag v1] [--yes]
// Modes (defaults):
//   swap     one element changes (a product, prop, sign, outfit), the person, light and camera stay: seedance-2.5-edit
//   recast   keep the performance and camera, change who or where: seedance-2.5-edit
//   restyle  keep the motion and framing, change the whole look: genjutsu-restyle (--style, 20 presets)
// --target uses part-N-<tag>-target.png (target.mjs) as the picture of the first frame after the edit.
// Writes part-N-<tag>-<res>.mp4 and records the version in recast.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as dw from './lib/dw.mjs';

const has = (k) => process.argv.includes(`--${k}`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const dir = arg('dir'), part = Number(arg('part', 1)), mode = arg('mode', 'swap'), change = arg('change'), tag = arg('tag', 'v1'), res = arg('res', '480p'), style = arg('style');
const id = arg('model', mode === 'restyle' && style ? 'genjutsu-restyle' : 'seedance-2.5-edit');
if (!dir || (!change && !style)) { console.error('usage: edit.mjs --dir work/<name> --part 1 --mode swap|recast|restyle --change "..." [--refs a.png=label] [--target] [--res 480p] [--tag v1] [--yes]'); process.exit(2); }
const man = JSON.parse(readFileSync(join(dir, 'recast.json'), 'utf8'));
const p = man.parts.find((x) => x.n === part);
if (!p) { console.error(`no part ${part} in ${dir}/recast.json`); process.exit(1); }

const m = await dw.model('video', id), media = m.media || {};
if (!(media.generation?.resolutions || [res]).includes(res)) { console.error(`${id} renders at ${media.generation.resolutions.join(', ')}, not ${res}`); process.exit(1); }
const vref = media.references?.video;
if (vref && (p.seconds < (vref.min_seconds ?? 0) || p.seconds > (vref.max_seconds ?? 99))) { console.error(`${id} takes ${vref.min_seconds}–${vref.max_seconds} s clips; part ${part} is ${p.seconds} s (re-run prep.mjs with another --part)`); process.exit(1); }

const refs = [{ file: join(dir, p.file), label: 'source video: keep its performance, timing, lip movements and camera exactly' }];
const target = join(dir, `part-${part}-${tag}-target.png`);
if (has('target')) { if (!existsSync(target)) { console.error(`no ${target}: run target.mjs first`); process.exit(1); } refs.push({ file: target, label: 'target first frame: exactly how the edited shot looks' }); }
for (const s of (arg('refs', '') || '').split(',').filter(Boolean)) { const [file, label] = s.split('='); refs.push({ file, label: `reference: ${label || 'the new element'}` }); }
const maxImg = media.references?.image?.max_count ?? 0, imgs = refs.filter((r) => dw.typeOf(r.file) === 'image').length;
if (imgs > maxImg) { console.error(`${id} takes at most ${maxImg} reference pictures, got ${imgs}`); process.exit(1); }

const keep = 'Keep everything else identical to the source video: the performance, facial expressions, lip movements and speech timing, hand motion, camera movement, framing, lighting and background. Do not add, remove or move anything else. Same length, no cuts.';
const ask = {
  swap: `Edit this video: ${change}.${has('target') ? ' The target frame shows exactly how the first frame looks after the edit.' : ''} The change follows every movement in the shot. ${keep}`,
  recast: `Recast this video: ${change}.${has('target') ? ' The target frame shows exactly how the first frame looks after the change.' : ''} Same performance, same timing, same lip sync, same camera move. ${keep.replace('the performance, facial expressions, ', '')}`,
  restyle: `Restyle this video${style ? ` as ${style}` : ''}${change ? `: ${change}` : ''}. Keep the motion, timing, framing and camera move exactly; change only the look.`,
}[mode];
if (!ask) { console.error(`unknown mode ${mode}: swap, recast or restyle`); process.exit(2); }

const b = dw.body({ model: id, prompt: ask, refs, resolution: res, ...(id === 'genjutsu-restyle' ? { style } : {}) });
const q = await dw.quote(b);
console.log(`${id} at ${res}, ${p.seconds} s: ${q.total.toFixed(1)} credits (balance ${(await dw.balance()).toFixed(0)})`);
if (!has('yes')) { console.log('Not rendered. Add --yes to spend it.'); process.exit(0); }

const t0 = Date.now(), out = await dw.run('video', b, q.id);
const file = `part-${part}-${tag}-${res}.mp4`;
writeFileSync(join(dir, file), out.buffer);
const now = JSON.parse(readFileSync(join(dir, 'recast.json'), 'utf8'));   // re-read: other renders may have finished meanwhile
now.versions.push({ tag, part, res, mode, model: id, change: change || null, style: style || null, refs: refs.slice(1).map((r) => r.file), prompt: ask, credits: out.charged || q.total, file, at: new Date().toISOString() });
writeFileSync(join(dir, 'recast.json'), JSON.stringify(now, null, 2));
console.log(`→ ${join(dir, file)} in ${Math.round((Date.now() - t0) / 1000)} s, ${(out.charged || q.total).toFixed(1)} credits. Next: node check.mjs --dir ${dir} --file ${file}`);
