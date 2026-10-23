// Darkwoods media API client for recast (https://api.darkwoods.ai). Auth: DARKWOODS_API_KEY (dwk_...).
// Video edits and images are "controlled" requests: model, resolution, prompt_parts and references. The source clip
// goes in as a type "video" reference; the target frame and product/person/place pictures as type "image" ones.
// Every request is priced first (POST /v1/media/quotes), then run async (Prefer: respond-async) and polled at
// /v1/generations/{id}.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = process.env.DARKWOODS_API_BASE || 'https://api.darkwoods.ai';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = () => { if (!process.env.DARKWOODS_API_KEY) throw new Error('DARKWOODS_API_KEY is not set (dwk_...)'); return process.env.DARKWOODS_API_KEY; };

// Backoff on 429/5xx: 60 s, 120 s, 240 s, then give up.
export async function req(method, path, { body, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method, headers: { Authorization: `Bearer ${key()}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(300000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { const wait = 60e3 * 2 ** attempt; console.error(`${res.status} on ${path}, waiting ${wait / 1000}s`); await sleep(wait); continue; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return res.json();
  }
}

const cache = {};
export async function model(modality, id) {
  cache[modality] ||= (await (await fetch(`${API}/v1/models?modality=${modality}`)).json()).data;
  const m = cache[modality].find((x) => x.id === id);
  if (!m) throw new Error(`Darkwoods has no ${modality} model "${id}"`);
  return m;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
export const mimeOf = (file) => MIME[file.split('.').pop().toLowerCase()] || 'application/octet-stream';
export const typeOf = (file) => mimeOf(file).split('/')[0];   // image | video | audio
export const ref = (file, label) => ({ id: randomUUID(), type: typeOf(file), data: `data:${mimeOf(file)};base64,${readFileSync(file).toString('base64')}`, ...(label ? { label: label.slice(0, 150) } : {}) });

// The request body for an edit or an image. refs: [{ file, label }], the source video first for edits.
export function body({ model: id, prompt, refs = [], resolution, aspect, style, duration }) {
  return {
    model: id, ...(resolution ? { resolution } : {}), ...(aspect ? { aspect_ratio: aspect } : {}), ...(style ? { style } : {}),
    ...(duration ? { duration } : {}), ...(aspect || !refs.some((r) => typeOf(r.file) === 'video') ? { n: 1 } : {}),
    prompt_parts: [{ text: prompt }], references: refs.map((r) => ref(r.file, r.label)),
  };
}

export async function quote(b) { const q = await req('POST', '/v1/media/quotes', { body: b }); return { id: q.id, total: Number(q.total) }; }

async function poll(id, { every = 5000, max = 30 * 60e3 } = {}) {
  const until = Date.now() + max;
  for (;;) {
    const s = await req('GET', `/v1/generations/${encodeURIComponent(id)}?data=0`);
    if (s.status === 'completed') return req('GET', `/v1/generations/${encodeURIComponent(id)}`);
    if (s.status === 'failed' || s.status === 'cancelled') throw new Error(`generation ${id} ${s.status}: ${s.error?.message || ''}`);
    if (Date.now() > until) throw new Error(`generation ${id} timed out`);
    await sleep(every);
  }
}

// Run a quoted request. kind: 'video' | 'image'. Returns { buffer, mime, charged }.
export async function run(kind, b, quoteId) {
  const path = kind === 'video' ? '/v1/videos/generations' : '/v1/images/generations';
  let out = await req('POST', path, { body: { ...b, quote_id: quoteId }, headers: { Prefer: 'respond-async', 'X-Request-Id': randomUUID() } });
  if (!out.data) out = await poll(out.id);
  const d = out.data[0];
  return { buffer: Buffer.from(d.b64_json, 'base64'), mime: d.mime_type, charged: Number(out.usage?.charged ?? 0) };
}

export async function balance() { return Number((await req('GET', '/me')).balance.spendable); }
