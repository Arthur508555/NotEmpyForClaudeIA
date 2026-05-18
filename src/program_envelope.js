const { compress, decompressBuffer } = require("./lzma");

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

function checksum16(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i] * ((i % 251) + 1)) % 65535;
  return sum;
}

function envelopeChecksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i] * ((i % 199) + 3)) % 65535;
  return sum;
}

function packProgram(binary) {
  const raw = Buffer.from(binary);
  const packed = compress(raw);
  const out = [79, 67, 3, 1];
  pushU32(out, raw.length);
  pushU16(out, checksum16(raw));
  pushU32(out, packed.length);
  for (const b of packed) out.push(b);
  pushU16(out, envelopeChecksum(out));
  return Buffer.from(out);
}

function readU16(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function readU32(bytes, offset) {
  return ((bytes[offset] * 256 + bytes[offset + 1]) * 256 + bytes[offset + 2]) * 256 + bytes[offset + 3];
}

function unpackProgram(envelope) {
  const bytes = Buffer.from(envelope);
  if (bytes.length < 16) throw new Error("Envelope do programa truncado.");
  const body = bytes.subarray(0, bytes.length - 2);
  if (readU16(bytes, bytes.length - 2) !== envelopeChecksum(body)) {
    throw new Error("Envelope do programa corrompido.");
  }
  if (bytes[0] !== 79 || bytes[1] !== 67 || bytes[2] !== 3 || bytes[3] !== 1) {
    throw new Error("Envelope do programa invalido.");
  }
  const rawLen = readU32(bytes, 4);
  const rawSum = readU16(bytes, 8);
  const packedLen = readU32(bytes, 10);
  if (14 + packedLen !== bytes.length - 2) throw new Error("Envelope do programa com tamanho invalido.");
  const raw = decompressBuffer(bytes.subarray(14, 14 + packedLen));
  if (raw.length !== rawLen || checksum16(raw) !== rawSum) {
    throw new Error("Envelope do programa falhou na validacao interna.");
  }
  return raw;
}

module.exports = { packProgram, unpackProgram, checksum16 };
