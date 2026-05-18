const { tokenize } = require("./lexer");
const { parse } = require("./parser");
const { decode } = require("./base85");
const { decompress } = require("./lzma");
const { unpackProgram } = require("./program_envelope");

function validateSource(code) {
  if (!code.trim()) throw new Error("Informe um script Lua/Luau.");
  const tokens = tokenize(code);
  const ast = parse(tokens);
  return { tokens, ast };
}

function antiCorrupt({ source, compressed, encodedProgram, runtime }) {
  const restored = decompress(compressed);
  if (restored !== source) throw new Error("Anti-corrupt: compressao/descompressao alterou o script.");
  unpackProgram(decode(encodedProgram));
  if (!/^local\s+[A-Za-z_][A-Za-z0-9_]*=function\(\)/.test(runtime) || !/\breturn\s+[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(runtime)) {
    throw new Error("Builder final nao esta encapsulado.");
  }
  if (/SAFELOAD|loadstring|\bload\s*\(|local\s+_load/.test(runtime)) {
    throw new Error("Anti-corrupt: runtime tentou reintroduzir carregamento dinamico de source.");
  }
  if (/program\s*=\s*JSON|local function JSON|constMap/.test(runtime)) {
    throw new Error("Anti-corrupt: runtime tentou reintroduzir programa reconstruido em JSON.");
  }
  if (/\b(?:LIBS|ENV|WATCHDOG|INTEGRITY|VM|READ|CONSTV|REGISTER_TABLE|VM_RUNNER|FUNCTION_HANDLER|EXECUTION)\b/.test(runtime)) {
    throw new Error("Anti-corrupt: runtime final manteve identificadores internos legiveis.");
  }
  if (/\bstring\.byte\b(?!,)/.test(runtime.slice(runtime.indexOf("}") + 1))) {
    throw new Error("Runtime acessa biblioteca fora de LIBS.");
  }
  return true;
}

module.exports = { validateSource, antiCorrupt };
