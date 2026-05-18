const crypto = require("crypto");

function xorByte(a, b) {
  return (a ^ b) & 255;
}

function buildKeySystem() {
  const plain = crypto.randomBytes(24);
  const layers = [crypto.randomBytes(24), crypto.randomBytes(24), crypto.randomBytes(24)];
  const encoded = [];
  for (let i = 0; i < plain.length; i++) {
    let v = plain[i];
    v = xorByte(v, layers[0][i]);
    v = xorByte((v + layers[1][i]) & 255, layers[2][i]);
    encoded.push(v);
  }
  const checksum = [...plain].reduce((a, b, i) => (a + b * (i + 17)) % 65535, 0);
  return {
    encoded,
    layers: layers.map(x => [...x]),
    checksum,
    size: plain.length
  };
}

module.exports = { buildKeySystem };
