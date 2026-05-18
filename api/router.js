/**
 * wRyObf — API Router
 * Arquivo NOVO — não modifica nenhum arquivo existente.
 *
 * Para ativar, adicione 2 linhas no seu server.js:
 *   const apiRouter = require('./api/router');
 *   app.use('/api', apiRouter);
 */

const express    = require("express");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const { generateKey, validateKey, revokeKey, addLog, getStats, CONFIG } = require("./keyManager");

// ── Importa o obfuscador EXISTENTE do projeto (não altera nada nele) ──────────
// O require abaixo só carrega o módulo — não executa nada, não altera nada.
let obfuscate;
try {
  obfuscate = require("../src/obfuscador");
  // Se o módulo exporta um objeto com uma função, ajuste aqui:
  // ex: if (typeof obfuscate !== "function") obfuscate = obfuscate.obfuscate;
} catch (e) {
  console.warn("[wRyObf API] Aviso: src/obfuscador.js não encontrado. Rodando em modo placeholder.");
  obfuscate = null;
}

const router  = express.Router();
const VERSION = process.env.API_VERSION || "1.0.0";
const STARTED = Date.now();

// ── Segurança: Helmet ─────────────────────────────────────────────────────────
router.use(helmet());

// ── CORS (para uso externo por outros sites) ──────────────────────────────────
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Rate limit global por IP ──────────────────────────────────────────────────
router.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Muitas requisições. Aguarde alguns minutos." },
}));

// ── Body limit ────────────────────────────────────────────────────────────────
router.use(express.json({ limit: `${CONFIG.MAX_SCRIPT_KB}kb` }));

// ── Timeout ───────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
  req.setTimeout(30_000, () =>
    res.status(408).json({ success: false, error: "Timeout: requisição demorou demais." })
  );
  next();
});

// ── Rate limit extra para /obfuscate (anti-spam) ──────────────────────────────
const obfuscateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  message: { success: false, error: "Limite de obfuscações por minuto atingido." },
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/status
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/status", (_req, res) => {
  res.json({
    success: true,
    status:  "online",
    version: VERSION,
    uptime:  Math.floor((Date.now() - STARTED) / 1000) + "s",
    time:    new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/version
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/version", (_req, res) => {
  res.json({
    success: true,
    version: VERSION,
    name:    "wRyObf Public API",
    node:    process.version,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/stats
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/stats", (_req, res) => {
  res.json({ success: true, ...getStats() });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/keys/generate   (requer ADMIN_SECRET no header)
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/keys/generate", (req, res) => {
  const secret = req.headers["x-admin-secret"] || req.body?.adminSecret;
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: "Admin secret inválido." });
  }
  const apiKey = generateKey(req.body?.owner || "user");
  res.json({ success: true, apiKey });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/keys/revoke
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/keys/revoke", (req, res) => {
  const secret = req.headers["x-admin-secret"] || req.body?.adminSecret;
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: "Admin secret inválido." });
  }
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ success: false, error: "'apiKey' é obrigatório." });
  if (!revokeKey(apiKey)) return res.status(404).json({ success: false, error: "API Key não encontrada." });
  res.json({ success: true, message: "API Key revogada." });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/obfuscate  ← ENDPOINT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/obfuscate", obfuscateLimiter, async (req, res) => {
  const t0 = Date.now();

  try {
    const { apikey, script, settings = {} } = req.body || {};

    // Validação de autenticação
    const auth = validateKey(apikey);
    if (!auth.valid) {
      return res.status(auth.retryAfter ? 429 : 403).json({
        success: false,
        error:   auth.reason,
        ...(auth.retryAfter ? { retryAfterMinutes: auth.retryAfter } : {}),
      });
    }

    // Validação do script
    if (!script || typeof script !== "string" || script.trim().length === 0) {
      return res.status(400).json({ success: false, error: "'script' é obrigatório e não pode ser vazio." });
    }

    const sizeIn = Buffer.byteLength(script, "utf8");
    if (sizeIn > CONFIG.MAX_SCRIPT_KB * 1024) {
      return res.status(413).json({
        success: false,
        error: `Script muito grande. Máximo: ${CONFIG.MAX_SCRIPT_KB}KB.`,
      });
    }

    // ── Chamar o obfuscador existente ─────────────────────────────────────
    //
    //  O módulo src/obfuscador.js é importado no topo (linha ~18).
    //  Ajuste abaixo conforme o que ele exporta:
    //
    //    module.exports = function(code, opts) { ... }   → use: obfuscate(script, settings)
    //    module.exports = { run: fn }                    → use: obfuscate.run(script, settings)
    //    module.exports = class { static run(c,o) }      → use: obfuscate.run(script, settings)
    //
    let obfuscated;

    if (!obfuscate) {
      // Placeholder caso o módulo não seja encontrado (modo dev)
      obfuscated = `--[[ wRyObf API - obfuscador não carregado ]]\n${script}`;
    } else {
      try {
        // ↓ Ajuste esta linha se necessário
        const result = await Promise.resolve(obfuscate(script, settings));
        obfuscated = typeof result === "string" ? result : JSON.stringify(result);
      } catch (obfErr) {
        return res.status(422).json({
          success: false,
          error: "Erro na obfuscação: " + obfErr.message,
        });
      }
    }

    const sizeOut = Buffer.byteLength(obfuscated, "utf8");
    const elapsed = Date.now() - t0;

    // Log de uso
    addLog({
      key:     (apikey || "").slice(0, 12) + "…",
      ip:      req.ip,
      sizeIn,
      sizeOut,
      ms:      elapsed,
    });

    return res.json({
      success:    true,
      obfuscated,
      stats: {
        time:        elapsed + "ms",
        size_before: sizeIn,
        size_after:  sizeOut,
      },
    });

  } catch (err) {
    console.error("[wRyObf API] Erro:", err.message);
    return res.status(500).json({ success: false, error: "Erro interno do servidor." });
  }
});

// ── 404 interno da API ────────────────────────────────────────────────────────
router.use((req, res) => {
  res.status(404).json({ success: false, error: `Endpoint não existe: ${req.method} ${req.path}` });
});

module.exports = router;
