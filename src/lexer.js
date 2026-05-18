const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while", "continue", "export", "type", "typeof"
]);

const TWO = new Set(["==", "~=", "<=", ">=", "..", "::", "//", "+=", "-=", "*=", "/=", "%=", "^=", "..="]);
const THREE = new Set(["...", "<<=", ">>="]);
const SINGLE = new Set(["+", "-", "*", "/", "%", "^", "#", "=", "<", ">", "(", ")", "{", "}", "[", "]", ";", ":", ",", ".", "~"]);

function isAlpha(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isDigit(ch) {
  return /[0-9]/.test(ch);
}

function longBracket(src, i) {
  if (src[i] !== "[") return null;
  let j = i + 1;
  while (src[j] === "=") j++;
  if (src[j] !== "[") return null;
  const eq = j - i - 1;
  const close = "]" + "=".repeat(eq) + "]";
  const end = src.indexOf(close, j + 1);
  if (end < 0) throw new Error(`String longa sem fechamento na posicao ${i}.`);
  return { end: end + close.length, value: src.slice(i, end + close.length) };
}

function readString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
    } else if (ch === quote) {
      return { end: j + 1, value: src.slice(i, j + 1) };
    } else {
      if (ch === "\n" || ch === "\r") throw new Error(`String curta quebrada na posicao ${i}.`);
      j++;
    }
  }
  throw new Error(`String sem fechamento na posicao ${i}.`);
}

function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const push = (type, value, startLine = line, startCol = col) => tokens.push({ type, value, line: startLine, col: startCol });
  const step = text => {
    for (const ch of text) {
      if (ch === "\n") { line++; col = 1; } else col++;
    }
  };

  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      step(ch); i++; continue;
    }

    if (ch === "-" && src[i + 1] === "-") {
      const lb = longBracket(src, i + 2);
      if (lb) { step(src.slice(i, lb.end)); i = lb.end; continue; }
      const end = src.indexOf("\n", i + 2);
      const next = end < 0 ? src.length : end;
      step(src.slice(i, next)); i = next; continue;
    }

    const l = line, c = col;
    if (ch === "'" || ch === '"') {
      const s = readString(src, i);
      push("string", s.value, l, c); step(s.value); i = s.end; continue;
    }

    const lb = longBracket(src, i);
    if (lb) {
      push("string", lb.value, l, c); step(lb.value); i = lb.end; continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
      let j = i;
      if (src[j] === "0" && /[xX]/.test(src[j + 1] || "")) {
        j += 2;
        while (/[0-9A-Fa-f.]/.test(src[j] || "")) j++;
        if (/[pP]/.test(src[j] || "")) {
          j++;
          if (/[+-]/.test(src[j] || "")) j++;
          while (isDigit(src[j] || "")) j++;
        }
      } else {
        while (isDigit(src[j] || "")) j++;
        if (src[j] === "." && src[j + 1] !== ".") { j++; while (isDigit(src[j] || "")) j++; }
        if (/[eE]/.test(src[j] || "")) {
          j++;
          if (/[+-]/.test(src[j] || "")) j++;
          while (isDigit(src[j] || "")) j++;
        }
      }
      const value = src.slice(i, j);
      push("number", value, l, c); step(value); i = j; continue;
    }

    if (isAlpha(ch)) {
      let j = i + 1;
      while (/[A-Za-z0-9_]/.test(src[j] || "")) j++;
      const value = src.slice(i, j);
      push(KEYWORDS.has(value) ? "keyword" : "identifier", value, l, c);
      step(value); i = j; continue;
    }

    const tri = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (THREE.has(tri)) { push("symbol", tri, l, c); step(tri); i += 3; continue; }
    if (TWO.has(two)) { push("symbol", two, l, c); step(two); i += 2; continue; }
    if (SINGLE.has(ch)) { push("symbol", ch, l, c); step(ch); i++; continue; }
    throw new Error(`Token invalido '${ch}' em ${line}:${col}.`);
  }
  tokens.push({ type: "eof", value: "<eof>", line, col });
  return tokens;
}

module.exports = { tokenize, KEYWORDS };
