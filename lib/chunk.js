const SIZE = 1000;      // chars per chunk
const OVERLAP = 150;    // chars shared with the previous chunk

// Split text into overlapping character windows. Whitespace is collapsed first
// so chunk sizes are predictable regardless of source formatting.
function chunkText(text, size = SIZE, overlap = OVERLAP) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const step = size - overlap;
  const chunks = [];
  for (let i = 0; i < clean.length; i += step) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}

module.exports = { chunkText, SIZE, OVERLAP };

// Self-check: `node lib/chunk.js`
if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(chunkText(''), [], 'empty -> []');
  assert.deepStrictEqual(chunkText('   '), [], 'whitespace -> []');
  assert.strictEqual(chunkText('hello world').length, 1, 'short -> one chunk');

  // distinct, whitespace-free content so overlap is observable
  const s = Array.from({ length: 2500 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
  const cs = chunkText(s);
  assert(cs.every(c => c.length <= SIZE), 'no chunk exceeds SIZE');
  assert(cs.length >= 3, 'long text splits into several chunks');
  const step = SIZE - OVERLAP;
  assert.strictEqual(cs[0].slice(step), cs[1].slice(0, OVERLAP), 'chunks overlap by OVERLAP chars');

  console.log(`chunk.js ok — ${cs.length} chunks, overlap verified`);
}
