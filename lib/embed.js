// Local embeddings via Transformers.js (all-MiniLM-L6-v2, 384-dim).
// No API key, no cost. First call downloads the model (~90 MB) then runs offline.
// @xenova/transformers is ESM-only, so we dynamic-import it from CommonJS.

let extractor;

async function getExtractor() {
  if (!extractor) {
    const { pipeline } = await import('@xenova/transformers');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return extractor;
}

// text -> number[384] (mean-pooled, L2-normalized so cosine similarity is valid)
async function embed(text) {
  const ex = await getExtractor();
  const out = await ex(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

module.exports = { embed };
