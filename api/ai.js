import { once } from 'node:events';

const CHAT_MODEL = 'openai/gpt-oss-20b';
const SEARCH_MODEL = 'openai/gpt-oss-20b';
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
    try { if (new URL(origin).host !== host) return false; }
    catch { return false; }
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

function textFromParts(parts = []) {
  return parts.map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}

function toJsonSchema(schema) {
  const typeMap = { STRING: 'string', INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean', OBJECT: 'object', ARRAY: 'array' };
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {}, additionalProperties: false };
  const result = {};
  if (schema.type) result.type = typeMap[schema.type] || schema.type.toLowerCase();
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.items) result.items = toJsonSchema(schema.items);
  if (schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)]));
    result.required = Array.isArray(schema.required) ? schema.required : Object.keys(schema.properties);
    result.additionalProperties = false;
  }
  return result;
}

function structuredResponseFormat(schema) {
  if (!schema) return { type: 'json_object' };
  let jsonSchema = toJsonSchema(schema);
  // Groq strict mode requires an object at the schema root. Wrap array schemas
  // and let the app unwrap the `result` property after parsing.
  if (jsonSchema.type !== 'object') {
    jsonSchema = {
      type: 'object',
      properties: { result: jsonSchema },
      required: ['result'],
      additionalProperties: false
    };
  }
  return { type: 'json_schema', json_schema: { name: 'skillbridge_response', strict: true, schema: jsonSchema } };
}

function toGroqRequest(payload, streaming) {
  const generation = payload.generationConfig || {};
  const schema = generation.responseSchema;
  const wantsJson = generation.responseMimeType === 'application/json' || Boolean(schema);
  const hasWebSearch = Array.isArray(payload.tools) && payload.tools.some(tool => tool?.google_search);
  const schemaInstruction = schema
    ? '\n\nReturn only valid JSON matching this schema exactly (do not use Markdown fences):\n' + JSON.stringify(schema)
    : wantsJson ? '\n\nReturn only valid JSON. Do not include Markdown fences or commentary.' : '';
  const systemText = [textFromParts(payload.systemInstruction?.parts), schemaInstruction].filter(Boolean).join('\n');
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const item of payload.contents || []) {
    const content = textFromParts(item?.parts);
    if (content) messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content });
  }
  if (!messages.length) messages.push({ role: 'user', content: 'Please help with this request.' });

  const request = {
    model: hasWebSearch ? SEARCH_MODEL : CHAT_MODEL,
    messages,
    temperature: Number.isFinite(generation.temperature) ? generation.temperature : (hasWebSearch ? 0.2 : 0.5),
    max_completion_tokens: Number.isFinite(generation.maxOutputTokens) ? generation.maxOutputTokens : (hasWebSearch ? 1800 : 900),
    stream: streaming
  };
  if (wantsJson && !hasWebSearch) request.response_format = structuredResponseFormat(schema);
  if (hasWebSearch) {
    request.tools = [{ type: 'browser_search' }];
    request.tool_choice = 'required';
    request.reasoning_effort = 'low';
  }
  return request;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Use POST for AI requests.' } });
  if (!allowRequest(req)) return sendJson(res, 429, { error: { code: 'rate_limit_exceeded', message: 'Request limit reached. Please wait a minute and try again.' } });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: { message: 'AI is not configured on the server. Add GROQ_API_KEY to the Vercel project environment variables.' } });

  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: { message: error.statusCode === 413 ? error.message : 'Invalid JSON request.' } }); }
  if (!body || typeof body !== 'object' || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return sendJson(res, 400, { error: { message: 'An AI request payload is required.' } });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return sendJson(res, 413, { error: { message: 'Request is too large.' } });

  const streaming = body.stream === true;
  let upstream;
  const groqRequest = toGroqRequest(body.payload, streaming);
  try {
    upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(groqRequest)
    });
  } catch {
    return sendJson(res, 502, { error: { message: 'Could not reach the AI service. Please try again.' } });
  }

  if (upstream.ok && !streaming && groqRequest.tools?.some(tool => tool.type === 'browser_search') && groqRequest.messages.length) {
    // Groq browser search cannot run together with structured output. Search first,
    // then use a second, schema-constrained completion to return reliable JSON.
    const searchResult = await upstream.json().catch(() => null);
    const searchText = searchResult?.choices?.[0]?.message?.content;
    if (typeof searchText !== 'string' || !searchText.trim()) {
      return sendJson(res, 502, { error: { message: 'The AI search completed without readable results. Please try again.' } });
    }
    const generation = body.payload.generationConfig || {};
    const schema = generation.responseSchema;
    const finalMessages = [
      { role: 'system', content: 'Convert the supplied web research into the requested JSON structure. Preserve concrete source URLs and factual details; do not add unsupported facts.' },
      { role: 'user', content: [textFromParts(body.payload.contents?.at(-1)?.parts), 'Web research to structure:', searchText].filter(Boolean).join('\n\n') }
    ];
    try {
      upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: finalMessages,
          temperature: 0.1,
          max_completion_tokens: Number.isFinite(generation.maxOutputTokens) ? generation.maxOutputTokens : 1800,
          response_format: structuredResponseFormat(schema)
        })
      });
    } catch {
      return sendJson(res, 502, { error: { message: 'Could not format the AI search results. Please try again.' } });
    }
  }

  if (!upstream.ok) {
    const errorBody = await upstream.json().catch(() => ({}));
    return sendJson(res, upstream.status, errorBody);
  }
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', streaming ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8');
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
