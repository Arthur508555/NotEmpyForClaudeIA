function compress(input) {
  const src = Buffer.from(input, "utf8");
  const out = [];
  let i = 0;
  while (i < src.length) {
    let bestLen = 0, bestDist = 0;
    const start = Math.max(0, i - 4095);
    for (let j = start; j < i; j++) {
      let n = 0;
      while (n < 130 && i + n < src.length && src[j + n] === src[i + n]) n++;
      if (n >= 4 && n > bestLen) {
        bestLen = n;
        bestDist = i - j;
      }
    }
    if (bestLen >= 4) {
      out.push(0x80 | (bestLen - 3), Math.floor(bestDist / 256), bestDist % 256);
      i += bestLen;
    } else {
      const startLit = i++;
      while (i < src.length && i - startLit < 127) {
        let found = false;
        const s = Math.max(0, i - 4095);
        for (let j = s; j < i && !found; j++) {
          let n = 0;
          while (n < 4 && i + n < src.length && src[j + n] === src[i + n]) n++;
          found = n >= 4;
        }
        if (found) break;
        i++;
      }
      out.push(i - startLit, ...src.slice(startLit, i));
    }
  }
  return Buffer.from(out);
}

function decompressBuffer(buffer) {
  const src = Buffer.from(buffer);
  if (src.length > 4_000_000) throw new Error("LZMA custom muito grande.");
  const out = [];
  for (let i = 0; i < src.length;) {
    const tag = src[i++];
    if (tag & 0x80) {
      if (i + 1 >= src.length) throw new Error("LZMA custom truncado.");
      const len = (tag & 0x7f) + 3;
      const dist = src[i++] * 256 + src[i++];
      const start = out.length - dist;
      if (dist < 1 || start < 0) throw new Error("LZMA custom corrompido.");
      for (let n = 0; n < len; n++) {
        const value = out[start + n];
        if (value === undefined) throw new Error("LZMA custom corrompido.");
        out.push(value);
        if (out.length > 5_000_000) throw new Error("LZMA custom excedeu limite.");
      }
    } else {
      if (i + tag > src.length) throw new Error("LZMA custom truncado.");
      for (let n = 0; n < tag; n++) {
        out.push(src[i++]);
        if (out.length > 5_000_000) throw new Error("LZMA custom excedeu limite.");
      }
    }
  }
  return Buffer.from(out);
}

function decompress(buffer) {
  return decompressBuffer(buffer).toString("utf8");
}

module.exports = { compress, decompress, decompressBuffer };
