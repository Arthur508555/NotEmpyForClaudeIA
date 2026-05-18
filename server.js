const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto"); // ADDED

const { obfuscate } = require("./src/obfuscador");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8"
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC API — Key management & rate limiting             [ADDED BLOCK START]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API_VERSION  = process.env.API_VERSION   || "1.0.0";
const API_STARTED  = Date.now();
const MAX_KEY_REQ  = parseInt(process.env.API_RATE_LIMIT) || 100; // req/hour per key
const MAX_IP_RPM   = 60;  // req/min per IP on public endpoints

// Auto-generate ADMIN_SECRET if not set via env (logged to console once)
const ADMIN_SECRET = process.env.ADMIN_SECRET || (() => {
  const s = crypto.randomBytes(16).toString("hex");
  console.log(`[wRyObf] ADMIN_SECRET not configured — auto-generated: ${s}`);
  console.log(`[wRyObf] Set ADMIN_SECRET env var in production.`);
  return s;
})();

const apiKeys  = new Map();  // apikey → { owner, createdAt, active, requests, hourBucket, lastUsed }
const apiLogs  = [];         // [{at, key, ip, ms}]
const ipBucket = new Map();  // ip → { count, resetAt }

// Seed admin key from env if provided
if (process.env.ADMIN_API_KEY) {
  apiKeys.set(process.env.ADMIN_API_KEY, {
    owner: "admin", createdAt: new Date().toISOString(),
    active: true, requests: 0, hourBucket: hourTag(), lastUsed: null,
  });
  console.log(`[wRyObf] Admin API key loaded from env.`);
}

function hourTag() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

function genKey(owner) {
  const key = "wry_" + crypto.randomBytes(18).toString("hex");
  apiKeys.set(key, {
    owner: String(owner || "user"),
    createdAt: new Date().toISOString(),
    active: true, requests: 0, hourBucket: hourTag(), lastUsed: null,
  });
  return key;
}

function validateKey(apikey) {
  if (!apikey || typeof apikey !== "string")
    return { valid: false, code: 401, reason: "Missing 'apikey'." };
  if (!apikey.startsWith("wry_"))
    return { valid: false, code: 403, reason: "Invalid key format. Expected: wry_xxx" };
  const k = apiKeys.get(apikey);
  if (!k) return { valid: false, code: 403, reason: "API key not found." };
  if (!k.active) return { valid: false, code: 403, reason: "API key has been revoked." };
  const h = hourTag();
  if (k.hourBucket !== h) { k.requests = 0; k.hourBucket = h; }
  if (k.requests >= MAX_KEY_REQ)
    return { valid: false, code: 429, reason: `Rate limit: ${MAX_KEY_REQ} req/hour per key.`, retryAfter: 60 - new Date().getMinutes() };
  k.requests++;
  k.lastUsed = new Date().toISOString();
  return { valid: true };
}

function checkIpLimit(ip) {
  const now = Date.now();
  const e = ipBucket.get(ip);
  if (!e || now > e.resetAt) { ipBucket.set(ip, { count: 1, resetAt: now + 60_000 }); return true; }
  if (e.count >= MAX_IP_RPM) return false;
  e.count++;
  return true;
}

// Cleanup stale rate-limit entries and trim logs every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of ipBucket) if (now > e.resetAt) ipBucket.delete(ip);
  while (apiLogs.length > 1000) apiLogs.pop();
}, 60_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  [ADDED BLOCK END]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// send() — original + CORS headers added for external API access
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Payload muito grande."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clean = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(ROOT, clean));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const ip = req.socket?.remoteAddress || "0.0.0.0";

  // CORS preflight [ADDED]
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {

    // ── EXISTING endpoint — frontend obfuscate (UNCHANGED) ─────────────────
    if (req.method === "POST" && req.url === "/api/obfuscate") {
      const body  = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = obfuscate(String(input.code || ""), {
        name:       String(input.name       || "chunk"),
        complexity: String(input.complexity || "high"),
        debug:      Boolean(input.debug)
      });
      return send(res, 200, JSON.stringify(result));
    }

    // ── ADDED: GET /api/status ──────────────────────────────────────────────
    if (req.method === "GET" && req.url.startsWith("/api/status")) {
      return send(res, 200, JSON.stringify({
        ok: true, status: "online",
        uptime: Math.floor((Date.now() - API_STARTED) / 1000) + "s",
        version: API_VERSION, time: new Date().toISOString()
      }));
    }

    // ── ADDED: GET /api/version ─────────────────────────────────────────────
    if (req.method === "GET" && req.url.startsWith("/api/version")) {
      return send(res, 200, JSON.stringify({
        ok: true, version: API_VERSION, name: "wRyObf Public API", node: process.version
      }));
    }

    // ── ADDED: GET /api/stats ───────────────────────────────────────────────
    if (req.method === "GET" && req.url.startsWith("/api/stats")) {
      const vals   = [...apiKeys.values()];
      const last24h = apiLogs.filter(l => Date.now() - new Date(l.at).getTime() < 86_400_000).length;
      return send(res, 200, JSON.stringify({
        ok: true,
        totalKeys:     apiKeys.size,
        activeKeys:    vals.filter(k => k.active).length,
        totalRequests: apiLogs.length,
        last24h
      }));
    }

    // ── ADDED: POST /api/keys/generate ──────────────────────────────────────
    if (req.method === "POST" && req.url === "/api/keys/generate") {
      const body  = await readBody(req);
      const input = JSON.parse(body || "{}");
      const secret = req.headers["x-admin-secret"] || input.adminSecret;
      if (secret !== ADMIN_SECRET)
        return send(res, 403, JSON.stringify({ ok: false, error: "Invalid admin secret." }));
      const apiKey = genKey(input.owner);
      return send(res, 200, JSON.stringify({ ok: true, apiKey }));
    }

    // ── ADDED: POST /api/keys/revoke ────────────────────────────────────────
    if (req.method === "POST" && req.url === "/api/keys/revoke") {
      const body  = await readBody(req);
      const input = JSON.parse(body || "{}");
      const secret = req.headers["x-admin-secret"] || input.adminSecret;
      if (secret !== ADMIN_SECRET)
        return send(res, 403, JSON.stringify({ ok: false, error: "Invalid admin secret." }));
      const k = apiKeys.get(input.apiKey);
      if (!k) return send(res, 404, JSON.stringify({ ok: false, error: "Key not found." }));
      k.active = false;
      return send(res, 200, JSON.stringify({ ok: true, message: "Key revoked." }));
    }

    // ── ADDED: POST /api/v1/obfuscate  ← PUBLIC endpoint with API key auth ─
    if (req.method === "POST" && req.url === "/api/v1/obfuscate") {
      if (!checkIpLimit(ip))
        return send(res, 429, JSON.stringify({ ok: false, error: "Too many requests. Retry in 1 minute." }));

      const t0   = Date.now();
      const body = await readBody(req);

      let input;
      try { input = JSON.parse(body || "{}"); }
      catch { return send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON body." })); }

      const auth = validateKey(input.apikey);
      if (!auth.valid) {
        return send(res, auth.code, JSON.stringify({
          ok: false, error: auth.reason,
          ...(auth.retryAfter ? { retryAfterMinutes: auth.retryAfter } : {})
        }));
      }

      const script = String(input.script || "").trim();
      if (!script)
        return send(res, 400, JSON.stringify({ ok: false, error: "'script' is required and cannot be empty." }));

      const sizeIn = Buffer.byteLength(script, "utf8");
      if (sizeIn > 500_000)
        return send(res, 413, JSON.stringify({ ok: false, error: "Script too large. Max: 500KB." }));

      // Map public API settings → internal obfuscator options
      const s          = input.settings || {};
      const complexity = s.virtualize ? "max" : s.junkCode ? "high" : "balanced";

      let result;
      try {
        result = obfuscate(script, {
          name:       String(input.name || "chunk"),
          complexity,
          debug:      Boolean(s.debug)
        });
      } catch (obfErr) {
        return send(res, 422, JSON.stringify({ ok: false, error: "Obfuscation error: " + obfErr.message }));
      }

      if (!result.ok)
        return send(res, 422, JSON.stringify({ ok: false, error: result.error || "Obfuscation failed." }));

      const elapsed = Date.now() - t0;
      const sizeOut = Buffer.byteLength(result.code, "utf8");

      apiLogs.unshift({ at: new Date().toISOString(), key: input.apikey.slice(0, 12) + "…", ip, ms: elapsed });

      return send(res, 200, JSON.stringify({
        ok:         true,
        success:    true,
        obfuscated: result.code,
        stats: {
          time:        elapsed + "ms",
          size_before: sizeIn,
          size_after:  sizeOut
        }
      }));
    }

    // ── EXISTING: static files (UNCHANGED) ─────────────────────────────────
    if (req.method === "GET") return serveStatic(req, res);
    return send(res, 405, JSON.stringify({ ok: false, error: "Metodo nao permitido." }));

  } catch (error) {
    return send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Obf-CC rodando em http://localhost:${PORT}`);
});
// server.js //
