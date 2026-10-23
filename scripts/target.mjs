#!/usr/bin/env node
// Step 2: the target frame. The part's real first frame, redrawn by an image model with only the change made, so the
// video model gets an exact picture of the result to aim for. References are the product, outfit, person or place.
//   node target.mjs --dir work/my-take --part 1 --change "swap the paper cup for the can in the reference" \
//                   [--refs can.png[,label=the can]...] [--tag v1] [--model gpt-image-2.5-flare]
// Writes part-N-<tag>-target.png. Costs a few credits; prints what it charged.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as dw from './lib/dw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'), part = Number(arg('part', 1)), change = arg('change'), tag = arg('tag', 'v1'), id = arg('model', 'gpt-image-2.5-flare');
if (!dir || !change) { console.error('usage: target.mjs --dir work/<name> --part 1 --change "..." [--refs a.png,b.png] [--tag v1]'); process.exit(2); }
const man = JSON.parse(readFileSync(join(dir, 'recast.json'), 'utf8'));
const p = man.parts.find((x) => x.n === part);
if (!p) { console.error(`no part ${part} in ${dir}/recast.json`); process.exit(1); }

// --refs "a.png,b.png" or "a.png=the new can,b.png=the jacket"
const refs = (arg('refs', '') || '').split(',').filter(Boolean).map((s) => { const [file, label] = s.split('='); return { file, label: label || 'reference' }; });
const m = await dw.model('image', id), gen = m.media?.generation || {};
const want = man.partSize[0] / man.partSize[1];
const ratio = (s) => { const [a, b] = s.split(':').map(Number); return a / b; };
const aspect = (gen.aspect_ratios || ['1:1']).reduce((best, s) => (Math.abs(Math.log(ratio(s) / want)) < Math.abs(Math.log(ratio(best) / want)) ? s : best));

const prompt = [
  'Image 1 is a frame from a video. Edit only this: ' + change + '.',
  refs.length ? `Use the other ${refs.length > 1 ? 'images' : 'image'} as the exact look of what's new: ${refs.map((r, i) => `image ${i + 2} is ${r.label}`).join('; ')}.` : '',
  'Everything else stays exactly as in image 1: the framing, camera angle and lens, the lighting and colour, the background, and the person\'s face, pose, expression and hands.',
  'Photorealistic, matching the frame\'s grain and focus. Not a new photo: the same frame, changed in one place.',
].filter(Boolean).join(' ');
const b = dw.body({ model: id, prompt, aspect, resolution: gen.default_resolution, refs: [{ file: join(dir, p.first), label: 'the video frame to edit' }, ...refs] });
const q = await dw.quote(b);
const out = await dw.run('image', b, q.id);
const file = join(dir, `part-${part}-${tag}-target.png`);
writeFileSync(file, out.buffer);
console.log(`target frame → ${file} (${id}, ${aspect}, ${out.charged || q.total} credits)`);
