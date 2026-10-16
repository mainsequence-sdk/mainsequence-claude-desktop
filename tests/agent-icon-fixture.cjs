const { deflateSync } = require('node:zlib');
function chunk(type, payload) {
  const content = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const result = Buffer.alloc(payload.length + 12);
  result.writeUInt32BE(payload.length); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function animatedIcon(extraBytes = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  const frame = sequence => { const b = Buffer.alloc(26); b.writeUInt32BE(sequence); b.writeUInt32BE(32, 4); b.writeUInt32BE(32, 8); b.writeUInt16BE(1, 20); b.writeUInt16BE(5, 22); return b; };
  const pixels = green => { const b = Buffer.alloc(32 * (1 + 32 * 4)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const i = y * 129 + 1 + x * 4; b[i] = green ? 0 : 255; b[i + 1] = green ? 255 : 0; b[i + 3] = 255; } return deflateSync(b); };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('acTL', animation),
    chunk('fcTL', frame(0)), chunk('IDAT', pixels(false)), chunk('fcTL', frame(1)),
    chunk('fdAT', Buffer.concat([sequence, pixels(true), Buffer.alloc(extraBytes)])), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { animatedIcon };
