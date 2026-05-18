const { KEYWORDS } = require("./lexer");

const RESERVED = new Set([
  ...KEYWORDS,
  "_G", "_ENV", "self", "script", "game", "workspace", "shared",
  "print", "warn", "require", "pairs", "ipairs", "next", "select",
  "tonumber", "tostring", "type", "typeof", "string", "table", "math",
  "coroutine", "debug", "os", "io", "utf8", "bit32", "bit", "task"
]);

function makeName(index) {
  const alphabet = ["i", "I", "l"];
  let n = index + 1;
  let out = "";
  while (n > 0) {
    n--;
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length);
  }
  return out;
}

function canRename(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name);
}

function collectLocalNames(tokens) {
  const names = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "keyword" || t.value !== "local") continue;
    const next = tokens[i + 1];
    if (next && next.value === "function") {
      const fn = tokens[i + 2];
      if (fn && fn.type === "identifier" && canRename(fn.value) && !seen.has(fn.value)) {
        seen.add(fn.value);
        names.push(fn.value);
      }
      continue;
    }
    for (let j = i + 1; j < tokens.length; j++) {
      const c = tokens[j];
      if (c.value === "=" || c.value === ";" || c.type === "eof") break;
      if (c.type === "identifier" && canRename(c.value) && !seen.has(c.value)) {
        seen.add(c.value);
        names.push(c.value);
      }
      if (c.value !== "," && c.type !== "identifier") break;
    }
  }
  return names;
}

function renameLexical(source, tokens) {
  const locals = collectLocalNames(tokens);
  if (!locals.length) return { code: source, renamed: 0 };
  const map = new Map();
  for (let i = 0; i < locals.length; i++) map.set(locals[i], makeName(i + 3));
  let out = "";
  let pos = 0;
  const real = tokens.filter(t => t.type !== "eof");
  for (let idx = 0; idx < real.length; idx++) {
    const t = real[idx];
    if (t.type === "eof") break;
    const at = source.indexOf(t.value, pos);
    if (at < pos) continue;
    out += source.slice(pos, at);
    const prev = real[idx - 1] && real[idx - 1].value;
    const next = real[idx + 1] && real[idx + 1].value;
    const tableKey = (prev === "{" || prev === ",") && next === "=";
    const member = prev === "." || prev === ":";
    out += t.type === "identifier" && map.has(t.value) && !member && !tableKey ? map.get(t.value) : t.value;
    pos = at + t.value.length;
  }
  out += source.slice(pos);
  return { code: out, renamed: map.size };
}

module.exports = { renameLexical };
