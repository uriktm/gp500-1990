/**
 * Serverless WebRTC signaling endpoint for 500cc Grand Prix '90 (/api/room).
 * Zero npm dependencies; supports Upstash Redis REST in production and an
 * in-memory Map with deterministic TTL expiration locally and in tests.
 */

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 5;
const ROOM_TTL_SECONDS = 600;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const TURN_TTL_SECONDS = 3600;
const TURN_CACHE_MS = 60_000;
const MAX_BODY_BYTES = 262_144; // 256 KB
const MAX_CREATE_ATTEMPTS = 8;

const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, statusCode, payload, extraHeaders = null) {
  const headers = extraHeaders ? { ...RESPONSE_HEADERS, ...extraHeaders } : RESPONSE_HEADERS;
  if (typeof res.setHeader === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
  }
  if (typeof res.end === 'function') {
    res.statusCode = statusCode;
    res.end(JSON.stringify(payload));
    return;
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(payload);
    return;
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(payload));
  }
}

function getHeader(req, name) {
  const headers = req?.headers;
  if (!headers) return '';
  const target = name.toLowerCase();
  if (typeof headers.get === 'function') {
    return headers.get(target) || '';
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    }
  }
  return '';
}

function getClientIp(req) {
  const xff = getHeader(req, 'x-forwarded-for');
  let raw = xff ? xff.split(',')[0].trim() : '';
  if (!raw) raw = getHeader(req, 'x-real-ip').trim();
  if (!raw) raw = getHeader(req, 'x-vercel-forwarded-for').trim();
  if (!raw) raw = String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '').trim();
  if (raw.startsWith('::ffff:')) raw = raw.slice(7);
  return raw || 'unknown';
}

function parseQuery(req) {
  const query = {};
  try {
    const parsed = new URL(req?.url || '/', 'http://localhost');
    for (const [k, v] of parsed.searchParams.entries()) {
      query[k] = v;
    }
  } catch {
    // Fallback below if req.url is malformed
  }
  if (req?.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined || v === null) continue;
      query[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
    }
  }
  return query;
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON body must be an object');
  }
  return parsed;
}

async function readJsonBody(req) {
  if (req?.body !== undefined) {
    if (req.body === null || req.body === '') return {};
    if (Buffer.isBuffer(req.body)) {
      return parseJsonObject(req.body.toString('utf8'));
    }
    if (typeof req.body === 'string') {
      return parseJsonObject(req.body);
    }
    if (typeof req.body === 'object' && !Array.isArray(req.body)) {
      return req.body;
    }
    throw new HttpError(400, 'JSON body must be an object');
  }

  if (!req || (typeof req[Symbol.asyncIterator] !== 'function' && typeof req.on !== 'function')) {
    return {};
  }

  const chunks = [];
  let totalBytes = 0;

  if (typeof req[Symbol.asyncIterator] === 'function') {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        throw new HttpError(413, 'Request body too large');
      }
      chunks.push(buf);
    }
  } else {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_BYTES) {
          reject(new HttpError(413, 'Request body too large'));
          return;
        }
        chunks.push(buf);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
  }

  return parseJsonObject(Buffer.concat(chunks).toString('utf8'));
}

function generateRoomCode() {
  let code = '';
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return code;
  }
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

function createMemoryStorage(map, nowFn) {
  function pruneIfExpired(key, nowMs) {
    const entry = map.get(key);
    if (!entry) return null;
    if (nowMs >= entry.expiresAt) {
      map.delete(key);
      return null;
    }
    return entry;
  }

  function sweepExpired(nowMs) {
    if (map.size <= 1000) return;
    for (const [k, v] of map.entries()) {
      if (v && typeof v.expiresAt === 'number' && nowMs >= v.expiresAt) {
        map.delete(k);
      }
    }
  }

  return {
    async incrRateLimit(ip, windowSec) {
      const nowMs = nowFn();
      sweepExpired(nowMs);
      const key = `rl:${ip}`;
      const existing = pruneIfExpired(key, nowMs);
      if (!existing) {
        map.set(key, { count: 1, expiresAt: nowMs + windowSec * 1000 });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },

    async createRoom(code, record, ttlSec) {
      const nowMs = nowFn();
      sweepExpired(nowMs);
      const key = `room:${code}`;
      if (pruneIfExpired(key, nowMs)) {
        return false;
      }
      map.set(key, { value: record, expiresAt: nowMs + ttlSec * 1000 });
      return true;
    },

    async getRoom(code) {
      const entry = pruneIfExpired(`room:${code}`, nowFn());
      return entry ? { ...entry.value } : null;
    },

    async answerRoom(code, answer, guestMeta) {
      const entry = pruneIfExpired(`room:${code}`, nowFn());
      if (!entry) return 'not_found';
      if (entry.value.answer !== null && entry.value.answer !== undefined) {
        return 'conflict';
      }
      entry.value = {
        ...entry.value,
        answer,
        guestMeta: guestMeta ?? null,
      };
      return 'ok';
    },
  };
}

function createUpstashStorage(restUrl, restToken, fetchFn, nowFn) {
  const endpoint = restUrl.replace(/\/+$/, '');

  async function redisCmd(args) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(`Upstash REST error (${response.status})`);
    }
    const payload = await response.json();
    if (payload && payload.error) {
      throw new Error(`Upstash Redis command error: ${payload.error}`);
    }
    return payload ? payload.result : null;
  }

  return {
    async incrRateLimit(ip, windowSec) {
      const rlKey = `gp500:rl:${ip}`;
      const count = Number(await redisCmd(['INCR', rlKey]));
      if (count === 1) {
        await redisCmd(['EXPIRE', rlKey, String(windowSec)]);
      }
      return count;
    },

    async createRoom(code, record, ttlSec) {
      const result = await redisCmd([
        'SET',
        `gp500:room:${code}`,
        JSON.stringify(record),
        'EX',
        String(ttlSec),
        'NX',
      ]);
      return result === 'OK';
    },

    async getRoom(code) {
      const raw = await redisCmd(['GET', `gp500:room:${code}`]);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    async answerRoom(code, answer, guestMeta) {
      const key = `gp500:room:${code}`;
      const raw = await redisCmd(['GET', key]);
      if (!raw) return 'not_found';
      const room = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (room.answer !== null && room.answer !== undefined) {
        return 'conflict';
      }
      const updated = {
        ...room,
        answer,
        guestMeta: guestMeta ?? null,
      };
      const elapsedSec = Math.max(0, Math.floor((nowFn() - (room.createdAt || nowFn())) / 1000));
      const remainingSec = Math.max(1, ROOM_TTL_SECONDS - elapsedSec);
      const setRes = await redisCmd([
        'SET',
        key,
        JSON.stringify(updated),
        'EX',
        String(remainingSec),
        'XX',
      ]);
      return setRes === 'OK' ? 'ok' : 'not_found';
    },
  };
}

/**
 * Creates a configurable signaling handler for /api/room.
 * @param {object} [options]
 * @param {Map} [options.store] Optional Map store for in-memory testing
 * @param {() => number} [options.nowFn] Clock function returning epoch ms
 * @param {typeof fetch} [options.fetchFn] Fetch implementation for Upstash & TURN APIs
 * @param {Record<string, string | undefined>} [options.env] Environment variables map
 */
export function createRoomHandler(options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;
  const env = options.env || process.env;
  const fallbackMap = options.store instanceof Map ? options.store : new Map();

  let warnedMissingTurn = false;
  let cachedTurn = null;

  function resolveStorage() {
    if (options.store instanceof Map) {
      return createMemoryStorage(options.store, nowFn);
    }
    const kvUrl = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').trim();
    const kvToken = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
    if (kvUrl && kvToken) {
      if (typeof fetchFn !== 'function') {
        throw new Error('fetchFn is required when Upstash REST env vars are configured');
      }
      return createUpstashStorage(kvUrl, kvToken, fetchFn, nowFn);
    }
    return createMemoryStorage(fallbackMap, nowFn);
  }

  function buildStaticFallbackTurn() {
    const turnUrl = String(env.TURN_URL || '').trim();
    if (!turnUrl) return [];
    const urls = turnUrl.includes(',')
      ? turnUrl.split(',').map((u) => u.trim()).filter(Boolean)
      : turnUrl;
    const entry = { urls };
    const username = String(env.TURN_USERNAME || '').trim();
    const credential = String(env.TURN_CREDENTIAL || '').trim();
    if (username) entry.username = username;
    if (credential) entry.credential = credential;
    return [entry];
  }

  async function getIceServers() {
    const servers = DEFAULT_STUN_SERVERS.map((s) => ({ ...s }));
    const turnKeyId = String(env.TURN_KEY_ID || '').trim();
    const turnApiToken = String(env.TURN_API_TOKEN || '').trim();

    if (turnKeyId && turnApiToken && typeof fetchFn === 'function') {
      const cacheKey = `${turnKeyId}:${turnApiToken}`;
      const nowMs = nowFn();
      if (cachedTurn && cachedTurn.cacheKey === cacheKey && nowMs < cachedTurn.expiresAt) {
        return [...servers, ...cachedTurn.servers];
      }
      try {
        const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`;
        const resp = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${turnApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        });
        if (!resp.ok) {
          throw new Error(`TURN API HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const rawList = Array.isArray(data?.iceServers)
          ? data.iceServers
          : (data?.iceServers && typeof data.iceServers === 'object' ? [data.iceServers] : []);
        const cfServers = rawList.filter((entry) => entry && entry.urls);
        if (cfServers.length > 0) {
          cachedTurn = {
            cacheKey,
            servers: cfServers,
            expiresAt: nowMs + TURN_CACHE_MS,
          };
          return [...servers, ...cfServers];
        }
      } catch (err) {
        console.warn('[gp500/api/room] Failed to fetch Cloudflare TURN credentials; falling back:', err?.message || err);
      }
    }

    const staticTurn = buildStaticFallbackTurn();
    if (staticTurn.length > 0) {
      return [...servers, ...staticTurn];
    }

    if (!warnedMissingTurn) {
      warnedMissingTurn = true;
      console.warn('[gp500/api/room] TURN credentials not configured (set TURN_KEY_ID & TURN_API_TOKEN, or TURN_URL); returning STUN servers only.');
    }
    return servers;
  }

  return async function roomHandler(req, res) {
    try {
      const method = String(req?.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        if (typeof res.setHeader === 'function') {
          for (const [k, v] of Object.entries(RESPONSE_HEADERS)) {
            res.setHeader(k, v);
          }
        }
        if (typeof res.end === 'function') {
          res.statusCode = 204;
          res.end();
        } else if (typeof res.status === 'function' && typeof res.json === 'function') {
          res.status(204).json({});
        }
        return;
      }

      if (method !== 'GET' && method !== 'POST') {
        sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET, POST, OPTIONS' });
        return;
      }

      const query = parseQuery(req);
      const storage = resolveStorage();

      if (method === 'GET') {
        const action = String(query.action || '').trim().toLowerCase();
        if (action === 'ice') {
          const iceServers = await getIceServers();
          sendJson(res, 200, { iceServers });
          return;
        }
        if (action === 'create' || action === 'answer') {
          sendJson(res, 405, { error: `Use POST for action=${action}` }, { Allow: 'POST' });
          return;
        }

        const code = normalizeCode(query.code);
        if (!code) {
          sendJson(res, 400, { error: 'Missing query parameter: expected action=ice or code=XXXXX' });
          return;
        }
        if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
          sendJson(res, 404, { error: 'Room not found or expired' });
          return;
        }

        const room = await storage.getRoom(code);
        if (!room) {
          sendJson(res, 404, { error: 'Room not found or expired' });
          return;
        }

        const iceServers = await getIceServers();
        sendJson(res, 200, {
          code,
          offer: room.offer,
          answer: room.answer ?? null,
          hostMeta: room.hostMeta ?? null,
          guestMeta: room.guestMeta ?? null,
          iceServers,
        });
        return;
      }

      // POST
      const body = await readJsonBody(req);
      const action = String(query.action || body.action || '').trim().toLowerCase();

      if (action === 'ice') {
        sendJson(res, 405, { error: 'Use GET for action=ice' }, { Allow: 'GET' });
        return;
      }

      if (action === 'create') {
        const offer = body.offer;
        if (!offer || (typeof offer !== 'object' && typeof offer !== 'string')) {
          sendJson(res, 400, { error: 'Missing offer in request body' });
          return;
        }

        const requestedCode = body.code !== undefined && body.code !== null
          ? normalizeCode(body.code)
          : '';
        if (requestedCode && !/^[A-Z0-9]{4,12}$/.test(requestedCode)) {
          sendJson(res, 400, { error: 'Invalid requested room code format' });
          return;
        }

        const clientIp = getClientIp(req);
        const count = await storage.incrRateLimit(clientIp, RATE_LIMIT_WINDOW_SECONDS);
        if (count > RATE_LIMIT_MAX) {
          sendJson(
            res,
            429,
            { error: 'Rate limit exceeded. Maximum 20 rooms per hour per IP.' },
            { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) }
          );
          return;
        }

        const record = {
          offer,
          hostMeta: body.hostMeta ?? null,
          answer: null,
          guestMeta: null,
          createdAt: nowFn(),
        };

        if (requestedCode) {
          const created = await storage.createRoom(requestedCode, record, ROOM_TTL_SECONDS);
          if (!created) {
            sendJson(res, 409, { error: 'Room code already exists' });
            return;
          }
          sendJson(res, 200, { code: requestedCode, expiresIn: ROOM_TTL_SECONDS });
          return;
        }

        for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
          const candidate = generateRoomCode();
          const created = await storage.createRoom(candidate, record, ROOM_TTL_SECONDS);
          if (created) {
            sendJson(res, 200, { code: candidate, expiresIn: ROOM_TTL_SECONDS });
            return;
          }
        }
        sendJson(res, 503, { error: 'Unable to allocate unique room code, please retry' });
        return;
      }

      if (action === 'answer') {
        const code = normalizeCode(body.code ?? query.code);
        if (!code) {
          sendJson(res, 400, { error: 'Missing room code' });
          return;
        }
        if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
          sendJson(res, 404, { error: 'Room not found or expired' });
          return;
        }

        const answer = body.answer;
        if (!answer || (typeof answer !== 'object' && typeof answer !== 'string')) {
          sendJson(res, 400, { error: 'Missing answer in request body' });
          return;
        }

        const outcome = await storage.answerRoom(code, answer, body.guestMeta ?? null);
        if (outcome === 'not_found') {
          sendJson(res, 404, { error: 'Room not found or expired' });
          return;
        }
        if (outcome === 'conflict') {
          sendJson(res, 409, { error: 'Room already has an answer (room full)' });
          return;
        }

        sendJson(res, 200, { ok: true, code });
        return;
      }

      sendJson(res, 400, { error: 'Unknown or missing action (expected create or answer)' });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error('[gp500/api/room] Unexpected error:', err);
      sendJson(res, 500, { error: 'Internal Server Error' });
    }
  };
}

const defaultHandler = createRoomHandler();

export default async function handler(req, res) {
  return defaultHandler(req, res);
}
