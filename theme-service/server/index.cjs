'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BUILTIN_THEMES, validateTheme, MAX_THEME_BYTES } = require('../shared/themes.cjs');

const RESERVED_IDS = new Set(BUILTIN_THEMES.map(theme => theme.id));
const MAX_THEMES = 1000;
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_LIMIT = 30;

function apiError(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function tokenDigest(value) { return crypto.createHash('sha256').update(value).digest(); }
function validateToken(value) {
  if (value && (value.length < 32 || value.length > 512 || /[^\x21-\x7e]/.test(value))) throw new Error('Configured publishing tokens must contain 32–512 printable ASCII characters without spaces.');
  return value || '';
}

function send(res, status, body, extra = {}) {
  const data = body == null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw apiError(415, 'CONTENT_TYPE', 'Content-Type must be application/json.');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_THEME_BYTES) throw apiError(413, 'BODY_TOO_LARGE', 'Theme exceeds the size limit.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_THEME_BYTES) throw apiError(413, 'BODY_TOO_LARGE', 'Theme exceeds the size limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

async function atomicWrite(directory, theme) {
  const filename = path.join(directory, `${theme.id}.json`);
  const temporary = path.join(directory, `.${theme.id}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(theme, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}

/** Create an isolated HTTP server. No sockets are opened until caller invokes listen(). */
async function createThemeServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(__dirname, 'data'));
  const uploadToken = validateToken(options.uploadToken || '');
  const adminToken = validateToken(options.adminToken || '');
  if (uploadToken && uploadToken === adminToken) throw new Error('Publishing and administrator tokens must be different.');
  const uploadDigest = tokenDigest(uploadToken);
  const adminDigest = tokenDigest(adminToken);
  const origins = new Set(options.corsOrigins || []);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== 'https:') throw new Error('CORS origins must be exact HTTPS origins.');
  }
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const themes = new Map();
  const files = (await fs.readdir(dataDir)).filter(file => /^[a-z][a-z0-9-]{2,47}\.json$/.test(file));
  if (files.length > MAX_THEMES) throw new Error('Stored theme catalog exceeds the configured limit.');
  for (const file of files) {
    const filename = path.join(dataDir, file);
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > MAX_THEME_BYTES) throw new Error('Stored theme validation failed.');
    const theme = validateTheme(JSON.parse(await fs.readFile(filename, 'utf8')));
    if (RESERVED_IDS.has(theme.id) || `${theme.id}.json` !== file) throw new Error('Stored theme validation failed.');
    themes.set(theme.id, theme);
  }
  const attempts = new Map();
  let mutation = Promise.resolve();
  function rateAllowed(ip) {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || now - entry.start >= RATE_WINDOW) {
      if (attempts.size >= 10000) {
        for (const [key, value] of attempts) if (now - value.start >= RATE_WINDOW) attempts.delete(key);
        if (attempts.size >= 10000) return false;
      }
      attempts.set(ip, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!origins.has(origin)) throw apiError(403, 'ORIGIN_DENIED', 'Origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') {
        if (!origin || !['/themes', '/health'].includes(url.pathname)) throw apiError(403, 'ORIGIN_DENIED', 'Origin is not allowed.');
        return send(res, 204, null, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
      }
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok', service: 'dex-themes', version: 1 });
      if (url.pathname === '/themes' && req.method === 'GET') {
        if ([...url.searchParams.keys()].some(key => !['limit', 'offset'].includes(key)) || url.searchParams.getAll('limit').length > 1 || url.searchParams.getAll('offset').length > 1) throw apiError(400, 'INVALID_PAGINATION', 'Unsupported pagination parameters.');
        const rawLimit = url.searchParams.get('limit') ?? '50';
        const rawOffset = url.searchParams.get('offset') ?? '0';
        if (!/^\d{1,3}$/.test(rawLimit) || !/^\d{1,6}$/.test(rawOffset)) throw apiError(400, 'INVALID_PAGINATION', 'Invalid pagination parameters.');
        const limit = Number(rawLimit);
        const offset = Number(rawOffset);
        if (limit < 1 || limit > 100 || offset > MAX_THEMES) throw apiError(400, 'INVALID_PAGINATION', 'Pagination is outside the allowed range.');
        const catalog = [...themes.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
        return send(res, 200, { themes: catalog.slice(offset, offset + limit), total: catalog.length, nextOffset: offset + limit < catalog.length ? offset + limit : null });
      }
      if (url.pathname === '/themes' && req.method === 'POST') {
        if (!rateAllowed(req.socket.remoteAddress || 'unknown')) throw apiError(429, 'RATE_LIMIT', 'Publishing limit reached. Try again later.');
        if (!uploadToken && !adminToken) throw apiError(503, 'PUBLISHING_DISABLED', 'Publishing is not configured.');
        const authorization = req.headers.authorization || '';
        const received = /^Bearer [\x21-\x7e]{32,512}$/.test(authorization) ? authorization.slice(7) : '';
        const digest = tokenDigest(received);
        // Always compare two fixed-size digests; raw secret length is never exposed.
        const uploadMatch = crypto.timingSafeEqual(digest, uploadDigest);
        const adminMatch = crypto.timingSafeEqual(digest, adminDigest);
        const isAdmin = Boolean(adminToken) && adminMatch;
        if (!(Boolean(uploadToken) && uploadMatch) && !isAdmin) throw apiError(401, 'UNAUTHORIZED', 'Publishing token is invalid.');
        const input = await readBody(req);
        let theme;
        try { theme = validateTheme(input); } catch { throw apiError(400, 'INVALID_THEME', 'Theme did not pass validation.'); }
        if (RESERVED_IDS.has(theme.id)) throw apiError(400, 'RESERVED_ID', 'Built-in theme IDs are reserved.');
        const operation = mutation.then(async () => {
          const exists = themes.has(theme.id);
          if (exists && !isAdmin) throw apiError(403, 'ADMIN_REQUIRED', 'Updating an existing theme requires an administrator token.');
          if (!exists && themes.size >= MAX_THEMES) throw apiError(507, 'CATALOG_FULL', 'The theme catalog is full.');
          await atomicWrite(dataDir, theme);
          themes.set(theme.id, theme);
          return { status: exists ? 200 : 201, theme };
        });
        mutation = operation.catch(() => {});
        const result = await operation;
        return send(res, result.status, { theme: result.theme });
      }
      if (['/health', '/themes'].includes(url.pathname)) return send(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Method is not supported.' }, { Allow: url.pathname === '/health' ? 'GET' : 'GET, POST' });
      return send(res, 404, { error: 'NOT_FOUND', message: 'Resource not found.' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.code && error.status ? error.code : 'INTERNAL_ERROR', message: error.status ? error.message : 'An internal server error occurred.' });
      req.resume();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

async function start() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 17896);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const server = await createThemeServer({ dataDir: process.env.DATA_DIR, uploadToken: process.env.UPLOAD_TOKEN, adminToken: process.env.ADMIN_TOKEN, corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean) });
  server.listen(port, host, () => process.stdout.write(JSON.stringify({ event: 'listening', host, port: server.address().port }) + '\n'));
  server.on('error', error => { process.stderr.write(`Theme server failed to listen (${error.code || 'error'}).\n`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
}

if (require.main === module) start().catch(() => { process.stderr.write('Theme server startup failed. Check token format, CORS origins, data directory permissions, and stored theme validation.\n'); process.exitCode = 1; });

module.exports = { createThemeServer };
