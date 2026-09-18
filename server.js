require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');

const { pool, query } = require('./lib/db');
const { extractText, ALLOWED } = require('./lib/extract');
const { chunkText } = require('./lib/chunk');
const { embed } = require('./lib/embed');
const { answer, toVector } = require('./lib/rag');

const MAX_DOCS = 10;
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } });

// Express 4 does not catch rejected promises from async handlers -- without this
// a DB outage leaves the request hanging instead of returning 500.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Upload -> extract -> chunk -> embed -> store
app.post('/api/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED.includes(ext)) {
    return res.status(400).json({ error: `Unsupported file type. Allowed: ${ALLOWED.join(', ')}` });
  }

  const { rows: [{ count }] } = await query('SELECT count(*)::int FROM documents');
  if (count >= MAX_DOCS) {
    return res.status(400).json({ error: `Document limit reached (${MAX_DOCS}). Delete a document first.` });
  }

  const parts = chunkText(await extractText(req.file.buffer, req.file.originalname));
  if (!parts.length) return res.status(400).json({ error: 'No readable text found in file.' });

  const vectors = [];
  for (const p of parts) vectors.push(toVector(await embed(p)));

  // Document + all its chunks in one transaction: a crash mid-ingest leaves
  // nothing behind rather than a half-indexed document.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [doc] } = await client.query(
      `INSERT INTO documents (file_name, size, chunk_count)
       VALUES ($1, $2, $3)
       RETURNING id, file_name AS "fileName", chunk_count AS "chunkCount"`,
      [req.file.originalname, req.file.size, parts.length]
    );
    // One statement for every chunk. unnest() zips the two arrays into rows and
    // WITH ORDINALITY supplies the 1-based position we store as chunk_index.
    await client.query(
      `INSERT INTO chunks (doc_id, chunk_index, text, embedding)
       SELECT $1, ord - 1, t, v::vector
         FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS u(t, v, ord)`,
      [doc.id, parts, vectors]
    );
    await client.query('COMMIT');
    res.json(doc);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Ask a question grounded in the uploaded documents
app.post('/api/chat', wrap(async (req, res) => {
  const question = (req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question is required.' });
  res.json(await answer(question));
}));

// List uploaded documents (and cap usage)
app.get('/api/documents', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, file_name AS "fileName", chunk_count AS "chunkCount", created_at AS "createdAt"
       FROM documents ORDER BY created_at DESC`
  );
  res.json({ count: rows.length, limit: MAX_DOCS, documents: rows });
}));

// Delete a document. Its chunks go with it via ON DELETE CASCADE.
app.delete('/api/documents/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid id.' });
  const { rows } = await query(
    'DELETE FROM documents WHERE id = $1 RETURNING chunk_count', [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document not found.' });
  res.json({ deleted: true, chunksRemoved: rows[0].chunk_count });
}));

// Turn multer's file-size error into a clean 400
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 2 MB).' : err.message;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || err.statusCode || 500;
  // 4xx is the caller's mistake and is already reported in the response body.
  // Only log 5xx -- those are ours.
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
