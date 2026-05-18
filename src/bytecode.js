const crypto = require("crypto");
const { encode } = require("./base85");
const { packProgram } = require("./program_envelope");

const OPS = {
  CONST: 11,
  GETGLOBAL: 17,
  GETLOCAL: 23,
  SETLOCAL: 29,
  CLOSURE: 31,
  CALL: 37,
  RETURN: 41,
  JMP: 43,
  JMPF: 47,
  BIN: 53,
  UN: 59,
  GETFIELD: 61,
  POP: 67,
  HALT: 71
};

const BIN = {
  ADD: 1,
  SUB: 2,
  MUL: 3,
  DIV: 4,
  MOD: 5,
  POW: 6,
  CONCAT: 7,
  EQ: 8,
  NE: 9,
  LT: 10,
  LE: 11,
  GT: 12,
  GE: 13,
  AND: 14,
  OR: 15
};

const UN = { NEG: 1, NOT: 2, LEN: 3 };

class Cursor {
  constructor(tokens) {
    this.tokens = tokens.filter(t => t.type !== "eof");
    this.i = 0;
  }

  peek(n = 0) {
    return this.tokens[this.i + n] || { type: "eof", value: "<eof>" };
  }

  eof() {
    return this.peek().type === "eof";
  }

  match(value) {
    if (this.peek().value === value) {
      this.i++;
      return true;
    }
    return false;
  }

  expect(value) {
    const t = this.peek();
    if (t.value !== value) throw new Error(`VM compiler: esperado '${value}' em ${t.line}:${t.col}.`);
    this.i++;
    return t;
  }

  expectType(type) {
    const t = this.peek();
    if (t.type !== type) throw new Error(`VM compiler: esperado ${type} em ${t.line}:${t.col}.`);
    this.i++;
    return t;
  }
}

function stringValue(raw) {
  if (raw[0] === "[") {
    const open = raw.match(/^\[=*\[/)[0];
    return raw.slice(open.length, raw.length - open.length);
  }
  if (raw[0] === '"') return JSON.parse(raw);
  let out = "";
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const n = raw[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "\\" || n === "'" || n === '"') out += n;
    else out += n || "";
  }
  return out;
}

function numberValue(raw) {
  if (/^0x/i.test(raw)) return Number(raw);
  return Number(raw);
}

function makeScope(parent = null, params = []) {
  const locals = new Map();
  for (const p of params) locals.set(p, locals.size);
  return { parent, locals, params };
}

function localSlot(scope, name) {
  if (!scope.locals.has(name)) scope.locals.set(name, scope.locals.size);
  return scope.locals.get(name);
}

function findLocal(scope, name, depth = 0) {
  if (!scope) return null;
  if (scope.locals.has(name)) return { depth, slot: scope.locals.get(name) };
  return findLocal(scope.parent, name, depth + 1);
}

function addConst(program, value) {
  const key = `${typeof value}:${String(value)}`;
  if (!program.constMap.has(key)) {
    program.constMap.set(key, program.constants.length);
    program.constants.push(value === null ? { $nil: 1 } : value);
  }
  return program.constMap.get(key);
}

function emit(fn, op, a, b, c) {
  const ins = [op];
  if (a !== undefined) ins.push(a);
  if (b !== undefined) ins.push(b);
  if (c !== undefined) ins.push(c);
  fn.code.push(ins);
  return fn.code.length - 1;
}

function patch(fn, at, value) {
  fn.code[at][1] = value;
}

function compileExpression(cur, program, fn, scope, minPrec = 0) {
  compilePrefix(cur, program, fn, scope);
  while (true) {
    const t = cur.peek();
    const inf = infix(t.value);
    if (!inf || inf.prec < minPrec) break;
    cur.i++;
    compileExpression(cur, program, fn, scope, inf.right ? inf.prec : inf.prec + 1);
    emit(fn, OPS.BIN, inf.op);
  }
}

function infix(value) {
  const map = {
    or: [1, BIN.OR],
    and: [2, BIN.AND],
    "==": [3, BIN.EQ],
    "~=": [3, BIN.NE],
    "<": [3, BIN.LT],
    "<=": [3, BIN.LE],
    ">": [3, BIN.GT],
    ">=": [3, BIN.GE],
    "..": [4, BIN.CONCAT, true],
    "+": [5, BIN.ADD],
    "-": [5, BIN.SUB],
    "*": [6, BIN.MUL],
    "/": [6, BIN.DIV],
    "%": [6, BIN.MOD],
    "^": [8, BIN.POW, true]
  };
  const spec = map[value];
  return spec && { prec: spec[0], op: spec[1], right: Boolean(spec[2]) };
}

function compilePrefix(cur, program, fn, scope) {
  const t = cur.peek();
  if (t.value === "-" || t.value === "not" || t.value === "#") {
    cur.i++;
    compileExpression(cur, program, fn, scope, 7);
    emit(fn, OPS.UN, t.value === "-" ? UN.NEG : t.value === "not" ? UN.NOT : UN.LEN);
    return;
  }
  compilePrimary(cur, program, fn, scope);
}

function compilePrimary(cur, program, fn, scope) {
  const t = cur.peek();
  if (t.type === "number") {
    cur.i++;
    emit(fn, OPS.CONST, addConst(program, numberValue(t.value)));
  } else if (t.type === "string") {
    cur.i++;
    emit(fn, OPS.CONST, addConst(program, stringValue(t.value)));
  } else if (t.value === "true" || t.value === "false" || t.value === "nil") {
    cur.i++;
    emit(fn, OPS.CONST, addConst(program, t.value === "true" ? true : t.value === "false" ? false : null));
  } else if (t.value === "(") {
    cur.i++;
    compileExpression(cur, program, fn, scope);
    cur.expect(")");
  } else if (t.type === "identifier" || (t.type === "keyword" && (t.value === "type" || t.value === "typeof"))) {
    cur.i++;
    const found = findLocal(scope, t.value);
    if (found) emit(fn, OPS.GETLOCAL, found.depth, found.slot);
    else emit(fn, OPS.GETGLOBAL, addConst(program, t.value));
  } else {
    throw new Error(`VM compiler: expressao nao suportada em ${t.line}:${t.col}.`);
  }

  while (true) {
    if (cur.match(".")) {
      const key = cur.expectType("identifier").value;
      emit(fn, OPS.GETFIELD, addConst(program, key));
    } else if (cur.match("(")) {
      let argc = 0;
      if (!cur.match(")")) {
        do {
          compileExpression(cur, program, fn, scope);
          argc++;
        } while (cur.match(","));
        cur.expect(")");
      }
      emit(fn, OPS.CALL, argc);
    } else {
      break;
    }
  }
}

function compileBlock(cur, program, fn, scope, stop = new Set()) {
  while (!cur.eof() && !stop.has(cur.peek().value)) {
    compileStatement(cur, program, fn, scope);
    cur.match(";");
  }
}

function compileStatement(cur, program, fn, scope) {
  const t = cur.peek();
  if (t.value === "local" && cur.peek(1).value === "function") {
    cur.i += 2;
    const name = cur.expectType("identifier").value;
    const slot = localSlot(scope, name);
    compileFunction(cur, program, fn, scope, slot);
    return;
  }
  if (t.value === "local") {
    cur.i++;
    const names = [cur.expectType("identifier").value];
    while (cur.match(",")) names.push(cur.expectType("identifier").value);
    if (cur.match("=")) {
      for (let i = 0; i < names.length; i++) {
        if (i > 0) cur.match(",");
        compileExpression(cur, program, fn, scope);
        emit(fn, OPS.SETLOCAL, localSlot(scope, names[i]));
        if (!cur.match(",")) break;
      }
      for (const name of names) localSlot(scope, name);
    } else {
      for (const name of names) {
        emit(fn, OPS.CONST, addConst(program, null));
        emit(fn, OPS.SETLOCAL, localSlot(scope, name));
      }
    }
    return;
  }
  if (t.value === "return") {
    cur.i++;
    if (cur.peek().value === "end" || cur.peek().value === "else" || cur.eof()) {
      emit(fn, OPS.RETURN, 0);
      return;
    }
    compileExpression(cur, program, fn, scope);
    emit(fn, OPS.RETURN, 1);
    return;
  }
  if (t.value === "if") {
    cur.i++;
    compileExpression(cur, program, fn, scope);
    cur.expect("then");
    const jf = emit(fn, OPS.JMPF, 0);
    compileBlock(cur, program, fn, scope, new Set(["else", "end"]));
    const jend = emit(fn, OPS.JMP, 0);
    patch(fn, jf, fn.code.length + 1);
    if (cur.match("else")) compileBlock(cur, program, fn, scope, new Set(["end"]));
    cur.expect("end");
    patch(fn, jend, fn.code.length + 1);
    return;
  }
  compileExpression(cur, program, fn, scope);
  emit(fn, OPS.POP);
}

function compileFunction(cur, program, parentFn, parentScope, targetSlot) {
  const name = `f${program.functions.length}`;
  cur.expect("(");
  const params = [];
  if (!cur.match(")")) {
    do params.push(cur.expectType("identifier").value);
    while (cur.match(","));
    cur.expect(")");
  }
  const scope = makeScope(parentScope, params);
  const fn = { name, params: params.length, locals: params.length, code: [] };
  const id = program.functions.length;
  program.functions.push(fn);
  compileBlock(cur, program, fn, scope, new Set(["end"]));
  cur.expect("end");
  emit(fn, OPS.CONST, addConst(program, null));
  emit(fn, OPS.RETURN, 1);
  fn.locals = scope.locals.size;
  emit(parentFn, OPS.CLOSURE, id);
  emit(parentFn, OPS.SETLOCAL, targetSlot);
}

function mutateProgram(program) {
  const key = crypto.randomBytes(1)[0] || 173;
  const salt = crypto.randomBytes(1)[0] || 91;
  const opMap = {};
  for (const op of Object.values(OPS)) opMap[op] = (op ^ key) + salt;
  for (const fn of program.functions) {
    for (let i = 0; i < fn.code.length; i++) {
      fn.code[i] = fn.code[i].map((v, n) => n === 0 ? (opMap[v] || ((v ^ key) + salt)) : v);
      if (i % 7 === 3) fn.code[i].push((key + salt + i) % 251);
    }
  }
  program.opKey = key;
  program.opSalt = salt;
  return program;
}

function addDecoys(program) {
  const fakeConstStart = program.constants.length;
  for (let i = 0; i < 4; i++) {
    program.constants.push(`:${crypto.randomBytes(5).toString("hex")}:${i}`);
  }
  for (const fn of program.functions) {
    fn.code.push([113 + (crypto.randomBytes(1)[0] % 37), fakeConstStart, 0, 0]);
    fn.code.push([OPS.POP]);
  }
  program.functions.push({
    name: `d${program.functions.length}`,
    params: 0,
    locals: 2,
    code: [
      [OPS.CONST, fakeConstStart + 1],
      [113 + (crypto.randomBytes(1)[0] % 37), 1, 2, 3],
      [OPS.POP],
      [OPS.HALT]
    ]
  });
}

function buildVirtualProgram(source, tokens) {
  const program = { version: 2, constants: [], constMap: new Map(), functions: [] };
  const entryScope = makeScope();
  const entry = { name: "main", params: 0, locals: 0, code: [] };
  program.functions.push(entry);
  compileBlock(new Cursor(tokens), program, entry, entryScope);
  emit(entry, OPS.HALT);
  entry.locals = entryScope.locals.size;
  delete program.constMap;
  addDecoys(program);
  mutateProgram(program);
  return {
    ...program,
    encodedSize: 0,
    virtualInstructions: program.functions.reduce((n, f) => n + f.code.length, 0)
  };
}

function pushU8(out, n) {
  out.push(n & 0xff);
}

function pushU16(out, n) {
  out.push(Math.floor(n / 256) & 0xff, n & 0xff);
}

function pushU32(out, n) {
  const v = n < 0 ? n + 0x100000000 : n;
  out.push(
    Math.floor(v / 16777216) & 0xff,
    Math.floor(v / 65536) & 0xff,
    Math.floor(v / 256) & 0xff,
    v & 0xff
  );
}

function encodeConst(value) {
  if (value && typeof value === "object" && value.$nil) return { tag: 0, bytes: Buffer.alloc(0) };
  if (value === false) return { tag: 1, bytes: Buffer.alloc(0) };
  if (value === true) return { tag: 2, bytes: Buffer.alloc(0) };
  if (typeof value === "number") return { tag: 3, bytes: Buffer.from(String(value), "utf8") };
  return { tag: 4, bytes: Buffer.from(String(value), "utf8") };
}

function encryptConst(bytes, key, tag, streamKey) {
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ ((key + (i + 1) * 31 + tag * 17 + streamKey) & 0xff);
  }
  return out;
}

function encryptCode(bytes, key, extra) {
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ ((key + (i + 1) * 13 + extra) & 0xff);
  }
  return out;
}

function u32(n) {
  return n < 0 ? n + 0x100000000 : n;
}

function maskOperand(value, pc, mask, slot) {
  const v = u32(value || 0);
  const delta = (mask * 65537 + (pc + 1) * 31337 + slot * 9173) >>> 0;
  return (v + delta) >>> 0;
}

function operandCheck(op, a, b, c, pc, mask) {
  return (op + a + b + c + (pc + 1) * 17 + mask * 29) & 0xff;
}

function instructionRecord(ins, pc, mask) {
  const out = [];
  const op = ins[0] || 0;
  const a = maskOperand(ins[1], pc, mask, 1);
  const b = maskOperand(ins[2], pc, mask, 2);
  const c = maskOperand(ins[3], pc, mask, 3);
  pushU16(out, op);
  pushU8(out, operandCheck(op, a, b, c, pc, mask));
  pushU32(out, a);
  pushU32(out, b);
  pushU32(out, c);
  return Buffer.from(out);
}

function serializeProgram(program) {
  const streamKey = crypto.randomBytes(1)[0] || 201;
  const h1 = crypto.randomBytes(1)[0] || 79;
  const h2 = crypto.randomBytes(1)[0] || 67;
  const h3 = crypto.randomBytes(1)[0] || 51;
  const hc = (h1 * 3 + h2 * 5 + h3 * 7 + (program.opKey & 0xff) * 11 + (program.opSalt & 0xff) * 13 + streamKey * 17) & 0xff;
  const out = [h1, h2, h3, program.opKey & 0xff, program.opSalt & 0xff, streamKey, hc];
  pushU16(out, program.constants.length);
  for (const value of program.constants) {
    const { tag, bytes } = encodeConst(value);
    const key = crypto.randomBytes(1)[0] || 73;
    const enc = encryptConst(bytes, key, tag, streamKey);
    pushU8(out, tag);
    pushU8(out, key);
    pushU32(out, enc.length);
    for (const b of enc) out.push(b);
  }
  pushU16(out, program.functions.length);
  program.functions.forEach((fn, index) => {
    const key = crypto.randomBytes(1)[0] || 111;
    const mask = crypto.randomBytes(1)[0] || 157;
    const raw = Buffer.concat(fn.code.map((ins, pc) => instructionRecord(ins, pc, mask)));
    const enc = encryptCode(raw, key, (streamKey + index * 7) & 0xff);
    pushU16(out, fn.params || 0);
    pushU16(out, fn.locals || 0);
    pushU32(out, fn.code.length);
    pushU8(out, key);
    pushU8(out, mask);
    for (const b of enc) out.push(b);
  });
  const checksum = out.reduce((sum, b, i) => (sum + b * ((i % 251) + 1)) % 65535, 0);
  pushU16(out, checksum);
  const binary = Buffer.from(out);
  program.encodedSize = binary.length;
  return encode(packProgram(binary));
}

module.exports = { OPS, BIN, UN, buildVirtualProgram, serializeProgram };
