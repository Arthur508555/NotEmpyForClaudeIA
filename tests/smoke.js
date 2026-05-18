const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { obfuscate } = require("../src/obfuscador");
const { encode, decode } = require("../src/base85");
const { compress, decompress } = require("../src/lzma");

const source = `local x = "abcabcabc"
local function f(n)
  if n > 1 then
    return x .. n
  end
  return x
end
print(f(3))`;

const b85 = encode(Buffer.from(source, "utf8"));
assert.strictEqual(decode(b85).toString("utf8"), source);

const packed = compress(source);
assert.strictEqual(decompress(packed), source);

const result = obfuscate(source, { name: "smoke" });
assert.strictEqual(result.ok, true);
assert.ok(/^local\s+[A-Za-z_][A-Za-z0-9_]*=function\(\)/.test(result.code));
assert.ok(result.code.length > source.length);
assert.ok(!/\bloadstring\b/.test(result.code));
assert.ok(!/\bload\(/.test(result.code));
assert.ok(!/OP\.(?:CONST|CALL|RETURN|HALT)/.test(result.code));
assert.ok(!/\bCONST\s*=\s*11\b/.test(result.code));
assert.ok(!result.code.includes("LOAD INTERCEPTADO"));
assert.ok(result.report.virtualInstructions > 5);

const temp = path.join(os.tmpdir(), `obf-cc-smoke-${Date.now()}.lua`);
fs.writeFileSync(temp, result.code, "utf8");
const luac = spawnSync("luac", ["-p", temp], { encoding: "utf8" });
if (luac.status === 0) {
  const lua = spawnSync("lua", [temp], { encoding: "utf8" });
  assert.strictEqual(lua.status, 0, lua.stderr || lua.stdout);
  assert.ok(lua.stdout.includes("abcabcabc3"), lua.stdout || lua.stderr);
}
fs.rmSync(temp, { force: true });

const debugResult = obfuscate('print("oi")', { name: "trace", debug: true });
const debugTemp = path.join(os.tmpdir(), `obf-cc-debug-${Date.now()}.lua`);
fs.writeFileSync(debugTemp, debugResult.code, "utf8");
const debugLua = spawnSync("lua", [debugTemp], { encoding: "utf8" });
if (debugLua.status === 0) {
  assert.ok(debugLua.stdout.includes("trace ok"), debugLua.stdout || debugLua.stderr);
  assert.ok(!debugLua.stdout.includes('print("oi")'), debugLua.stdout || debugLua.stderr);
  assert.ok(debugLua.stdout.includes("oi"), debugLua.stdout || debugLua.stderr);
}
fs.rmSync(debugTemp, { force: true });

const sandboxResult = obfuscate('print(type(_G.load), type(getfenv))', { name: "sandbox" });
const sandboxTemp = path.join(os.tmpdir(), `obf-cc-sandbox-${Date.now()}.lua`);
fs.writeFileSync(sandboxTemp, sandboxResult.code, "utf8");
const sandboxLua = spawnSync("lua", [sandboxTemp], { encoding: "utf8" });
if (sandboxLua.status === 0) {
  assert.ok(sandboxLua.stdout.includes("nil") && !sandboxLua.stdout.includes("function"), sandboxLua.stdout || sandboxLua.stderr);
}
fs.rmSync(sandboxTemp, { force: true });

console.log("smoke ok", result.report);
