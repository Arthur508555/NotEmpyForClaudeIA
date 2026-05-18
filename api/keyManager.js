/**
 * wRyObf — API Key Manager
 * Arquivo NOVO — não modifica nada existente.
 */

const crypto = require("crypto");

// Armazenamento em memória (sem banco de dados externo)
// Reinicia quando o servidor reinicia — OK para começar.
const keys = new Map();
const usageLogs = [];

const CONFIG = {
  MAX_REQ_PER_HOUR: parseInt(process.env.API_RATE_LIMIT) || 100,
  MAX_SCRIPT_KB:    parseInt(process.env.API_MAX_SCRIPT_KB) || 100,
  LOG_MAX:          500,
};

// ── Gerar nova Key ────────────────────────────────────────────────────────────
function generateKey(owner = "user") {
  const key = "wry_" + crypto.randomBytes(18).toString("hex"); // wry_ + 36 chars
  keys.set(key, {
    owner,
    createdAt:  new Date().toISOString(),
    active:     true,
    requests:   0,
    hourBucket: getHour(),
    lastUsed:   null,
  });
  return key;
}

// ── Validar Key e contabilizar uso ────────────────────────────────────────────
function validateKey(apikey) {
  if (!apikey || typeof apikey !== "string")
    return { valid: false, reason: "Campo 'apikey' ausente." };

  if (!apikey.startsWith("wry_"))
    return { valid: false, reason: "Formato inválido. Esperado: wry_xxx" };

  const k = keys.get(apikey);
  if (!k) return { valid: false, reason: "API Key não encontrada." };
  if (!k.active) return { valid: false, reason: "API Key revogada." };

  // Reset por hora
  const now = getHour();
  if (k.hourBucket !== now) { k.requests = 0; k.hourBucket = now; }

  if (k.requests >= CONFIG.MAX_REQ_PER_HOUR) {
    return {
      valid: false,
      reason: `Limite de ${CONFIG.MAX_REQ_PER_HOUR} req/hora atingido.`,
      retryAfter: 60 - new Date().getMinutes(),
    };
  }

  k.requests++;
  k.lastUsed = new Date().toISOString();
  return { valid: true };
}

// ── Revogar Key ───────────────────────────────────────────────────────────────
function revokeKey(apikey) {
  const k = keys.get(apikey);
  if (!k) return false;
  k.active = false;
  return true;
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(entry) {
  usageLogs.unshift({ ...entry, at: new Date().toISOString() });
  if (usageLogs.length > CONFIG.LOG_MAX) usageLogs.pop();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function getStats() {
  const vals = [...keys.values()];
  const last24h = usageLogs.filter(
    l => Date.now() - new Date(l.at).getTime() < 86_400_000
  ).length;
  return {
    totalKeys:     keys.size,
    activeKeys:    vals.filter(k => k.active).length,
    totalRequests: usageLogs.length,
    last24h,
  };
}

function getHour() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

// ── Criar key de admin via .env (opcional) ────────────────────────────────────
if (process.env.ADMIN_API_KEY) {
  keys.set(process.env.ADMIN_API_KEY, {
    owner: "admin", createdAt: new Date().toISOString(),
    active: true, requests: 0, hourBucket: getHour(), lastUsed: null,
  });
}

module.exports = { generateKey, validateKey, revokeKey, addLog, getStats, CONFIG };
