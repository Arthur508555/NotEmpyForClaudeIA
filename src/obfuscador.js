const { validateSource, antiCorrupt } = require("./validator");
const { compress } = require("./lzma");
const { buildVirtualProgram, serializeProgram } = require("./bytecode");
const { buildRuntime } = require("./runtime_builder");
const { buildKeySystem } = require("./key_system");
const { renameLexical } = require("./renamer");

function obfuscate(code, options = {}) {
  const parsed = validateSource(code);
  const renamed = renameLexical(code, parsed.tokens);
  const reparsed = validateSource(renamed.code);
  const compressed = compress(renamed.code);
  const program = buildVirtualProgram(renamed.code, reparsed.tokens);
  const encodedProgram = serializeProgram(program);
  const keySystem = buildKeySystem();
  const runtime = buildRuntime(encodedProgram, options, keySystem);
  antiCorrupt({ source: renamed.code, compressed, encodedProgram, runtime });
  return {
    ok: true,
    code: runtime,
    report: {
      originalBytes: Buffer.byteLength(code, "utf8"),
      transformedBytes: Buffer.byteLength(renamed.code, "utf8"),
      compressedBytes: compressed.length,
      finalBytes: Buffer.byteLength(runtime, "utf8"),
      tokens: parsed.tokens.length - 1,
      renamedLocals: renamed.renamed,
      functions: parsed.ast.stats.functions,
      locals: parsed.ast.stats.locals,
      returns: parsed.ast.stats.returns,
      loops: parsed.ast.stats.loops,
      virtualInstructions: program.virtualInstructions,
      payloadChunks: program.functions.length,
      encodedPayloadBytes: program.encodedSize,
      layers: [
        "Lexer",
        "Parser",
        "AST estrutural",
        "Transformacoes e renomeacao lexical segura",
        "Compilacao para bytecode custom",
        "VM stack/register sem source final",
        "Serializacao binaria custom criptografada",
        "Envelope binario comprimido com checksum duplo",
        "Payload Base85 fragmentado",
        "Fragmentos com tamanho e checksum individual",
        "Header binario mutavel com checksum interno",
        "Tabela de OP_Codes mascarada e reconstruida em runtime",
        "Runtime VM hardened",
        "Key system binario XOR multicamada",
        "Opcode mutation por build",
        "Opcode remap por sessao e dispatch indireto permutavel",
        "Handlers efemeros gerados por factory contextual",
        "Handlers envolvidos por micro-execucao com shadow args",
        "Dispatch segmentado por trampolim/continuations curtas",
        "Dispatch com slots mascarados injetivos e varredura rotativa",
        "Operand masking por frame/instrucao",
        "UNMASK multi-estagio dependente de estado vivo",
        "Materializacao parcial de operandos com phantom checks",
        "Bytecode fragmentado em segmentos criptografados",
        "Registradores e stack encapsulados com selos runtime",
        "Instruction cache transitorio com wipe por ciclo",
        "Monitoramento E2E de decode/dispatch/stack/register/env",
        "Reacao ativa com poisoning, wipe e invalidacao de chaves",
        "Constants pool lazy criptografada e reconstruida por janelas",
        "Instrucao VM descriptografada on-demand",
        "Decoy opcodes/fake functions/fake VM secundario",
        "Runtime rekeying, rolling masks e handler permutation",
        "Native/userdata entropy opcional quando disponivel",
        "Stack/metatable/coroutine/traceback fingerprinting",
        "Self-checks anti-hook distribuidos",
        "Debug interno e erro controlado",
        "Protecoes/anti-corrupt/opcode limit/ambiente",
        "Builder final one-line"
      ]
    }
  };
}

module.exports = { obfuscate };
