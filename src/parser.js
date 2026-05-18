function parse(tokens) {
  const blocks = [];
  const pairs = [];
  const ast = { type: "Chunk", body: [], stats: { functions: 0, locals: 0, returns: 0, loops: 0 } };

  const top = () => blocks[blocks.length - 1];
  const openPair = { "(": ")", "{": "}", "[": "]" };
  const closePair = { ")": "(", "}": "{", "]": "[" };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "eof") break;

    if (t.type === "symbol" && openPair[t.value]) {
      pairs.push({ value: t.value, line: t.line, col: t.col });
    } else if (t.type === "symbol" && closePair[t.value]) {
      const p = pairs.pop();
      if (!p || p.value !== closePair[t.value]) {
        throw new Error(`Delimitador '${t.value}' inesperado em ${t.line}:${t.col}.`);
      }
    }

    if (t.type !== "keyword") continue;

    if (t.value === "function") {
      ast.stats.functions++;
      blocks.push({ type: "function", line: t.line });
    } else if (t.value === "do") {
      blocks.push({ type: "do", line: t.line });
    } else if (t.value === "then") {
      blocks.push({ type: "if", line: t.line });
    } else if (t.value === "repeat") {
      ast.stats.loops++;
      blocks.push({ type: "repeat", line: t.line });
    } else if (t.value === "while" || t.value === "for") {
      ast.stats.loops++;
    } else if (t.value === "local") {
      ast.stats.locals++;
    } else if (t.value === "return") {
      ast.stats.returns++;
      const n = tokens[i + 1];
      if (n && n.type !== "eof" && n.value !== ";" && n.value !== "end" && n.value !== "else" && n.value !== "elseif" && n.value !== "until") {
        ast.body.push({ type: "Return", line: t.line });
      }
    } else if (t.value === "elseif" || t.value === "else") {
      if (!top() || top().type !== "if") throw new Error(`'${t.value}' sem if em ${t.line}:${t.col}.`);
    } else if (t.value === "until") {
      const b = blocks.pop();
      if (!b || b.type !== "repeat") throw new Error(`'until' sem repeat em ${t.line}:${t.col}.`);
    } else if (t.value === "end") {
      const b = blocks.pop();
      if (!b || b.type === "repeat") throw new Error(`'end' sem bloco aberto em ${t.line}:${t.col}.`);
    }
  }

  if (pairs.length) {
    const p = pairs[pairs.length - 1];
    throw new Error(`Delimitador '${p.value}' aberto em ${p.line}:${p.col} nao foi fechado.`);
  }
  if (blocks.length) {
    const b = blocks[blocks.length - 1];
    throw new Error(`Bloco '${b.type}' aberto na linha ${b.line} nao foi fechado.`);
  }
  return ast;
}

module.exports = { parse };
