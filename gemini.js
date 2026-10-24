import { once } from 'node:events';

const MODEL = 'gemini-3.8-flash';
const MAX_BODY_BYTES = 200_000;
const MAX_PER_MINUTE = 12;
const requestBuckets = new Map();

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function allowRequest(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch { return false; }
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = req.headers['x-real-ip'] || (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) || 'local';
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    requestBuckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= MAX_PER_MINUTE) return false;
  bucket.count += 1;
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Use POST for Gemini requests.' } });
  if (!allowRequest(req)) return sendJson(res, 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Request limit reached. Please wait a minute and try again.' } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: { message: 'Gemini is not configured on the server. Add GEMINI_API_KEY to the Vercel project environment variables.' } });

  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: { message: error.statusCode === 413 ? error.message : 'Invalid JSON request.' } }); }
  if (!body || typeof body !== 'object' || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return sendJson(res, 400, { error: { message: 'A Gemini payload is required.' } });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return sendJson(res, 413, { error: { message: 'Request is too large.' } });

  const streaming = body.stream === true;
  const fixedUrl = streaming
    ? `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let upstream;
  try {
    upstream = await fetch(fixedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload)
    });
  } catch {
    return sendJson(res, 502, { error: { message: 'Could not reach the Gemini API. Please try again.' } });
  }

  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || (streaming ? 'text/event-stream' : 'application/json'));
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (!upstream.body) return res.end();

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await once(res, 'drain');
    }
    res.end();
  } catch {
    if (!res.writableEnded) res.end();
  }
}
