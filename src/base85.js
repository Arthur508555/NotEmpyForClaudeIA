const ALPHABET = (() => {
  const codes = [];
  for (let i = 33; i <= 117; i++) codes.push(i);
  return String.fromCharCode(...codes);
})();

function encode(buffer) {
  const bytes = Buffer.from(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    let value = 0;
    const size = Math.min(4, bytes.length - i);
    for (let j = 0; j < 4; j++) value = value * 256 + (bytes[i + j] || 0);
    const chars = Array(5);
    for (let j = 4; j >= 0; j--) {
      chars[j] = ALPHABET[value % 85];
      value = Math.floor(value / 85);
    }
    out += chars.slice(0, size + 1).join("");
  }
  return out;
}

function decode(text) {
  if (typeof text !== "string") throw new Error("Base85 invalido.");
  if (text.length > 4_000_000) throw new Error("Base85 muito grande.");
  const bytes = [];
  for (let i = 0; i < text.length; i += 5) {
    const chunk = text.slice(i, i + 5);
    let value = 0;
    for (let j = 0; j < 5; j++) {
      const idx = j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 84;
      if (idx < 0) throw new Error("Base85 corrompido.");
      value = value * 85 + idx;
    }
    if (chunk.length < 2) throw new Error("Base85 truncado.");
    const block = [
      Math.floor(value / 16777216) % 256,
      Math.floor(value / 65536) % 256,
      Math.floor(value / 256) % 256,
      value % 256
    ];
    bytes.push(...block.slice(0, chunk.length - 1));
  }
  return Buffer.from(bytes);
}

module.exports = { encode, decode };
