// One-off schema setup: `npm run init-db`. Safe to re-run.
require('dotenv').config();
const { pool } = require('../lib/db');

const SQL = `
-- The extension is per-database. Everything below depends on it.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text        NOT NULL,
  size        integer     NOT NULL,
  chunk_count integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  doc_id      uuid    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  text        text    NOT NULL,
  -- 384 = the output width of all-MiniLM-L6-v2. Fixed at DDL time:
  -- Postgres rejects any insert of a different length.
  embedding   vector(384) NOT NULL
);

-- Approximate-nearest-neighbour index. vector_cosine_ops must match the
-- operator we query with (<=>). An index built for L2 will not serve cosine.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Plain B-tree for the delete/lookup path; nothing vector about it.
CREATE INDEX IF NOT EXISTS chunks_doc_id_idx ON chunks (doc_id);
`;

async function main() {
  await pool.query(SQL);
  const { rows } = await pool.query(`
    SELECT extversion FROM pg_extension WHERE extname = 'vector'
  `);
  console.log(`Schema ready. pgvector ${rows[0]?.extversion ?? '(missing!)'}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
