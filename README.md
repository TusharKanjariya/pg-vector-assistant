# VectorDocs — RAG over your own documents with Postgres + pgvector

Upload documents, ask questions, and get answers grounded only in those documents, with the source chunk and match score shown for every answer.

This is a small Retrieval-Augmented Generation (RAG) demo built on **PostgreSQL 18 and pgvector**. Embeddings run locally, retrieval is a single SQL query, and an LLM writes the answer using only the retrieved chunks. It is a port of an earlier MongoDB Atlas Vector Search version, built to learn how vector search works inside an ordinary relational database.

## How it works

```
upload ─► extract text ─► chunk (1000 chars, 150 overlap) ─► embed (384-dim) ─► INSERT into Postgres
ask    ─► embed question ─► ORDER BY embedding <=> $1 LIMIT k ─► prompt LLM with top chunks ─► answer + citations
```

- **Extraction:** `.txt`, `.md`, `.pdf` (pdf-parse), `.docx` (mammoth). Max 2 MB per file, 10 documents total.
- **Embeddings:** `Xenova/all-MiniLM-L6-v2` via Transformers.js. Runs locally, no API key. The first run downloads the model (about 90 MB).
- **Storage:** vectors live in a normal `vector(384)` column next to the chunk text. There is no separate vector database.
- **Retrieval:** cosine distance (`<=>`) served by an HNSW index. Chunks with similarity below 0.25 are dropped.
- **Answering:** Groq (OpenAI-compatible API). The model has to cite chunks as `[n]` and say plainly when the documents don't cover the question.

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- PostgreSQL with the **pgvector** extension. This project uses PostgreSQL 18 with pgvector 0.8.1.
- A [Groq](https://console.groq.com) API key for generating answers. Retrieval still works without one.

## Setup

### 1. Postgres + pgvector

pgvector has no official Windows binary, so on Windows this project runs Postgres inside **WSL2 (Ubuntu)**. On Linux, skip the WSL steps and run the same commands directly. On macOS, `brew install postgresql@18 pgvector` works.

In a WSL/Ubuntu shell:

```bash
sudo apt update
sudo apt install -y postgresql-18 postgresql-18-pgvector

# Port 5433, so it doesn't clash with a native Windows Postgres on 5432
sudo pg_conftool 18 main set port 5433

# Let Windows reach it: listen on the WSL virtual adapter, allow the WSL subnet
sudo pg_conftool 18 main set listen_addresses '*'
echo "host all all 172.16.0.0/12 scram-sha-256" | sudo tee -a /etc/postgresql/18/main/pg_hba.conf
sudo pg_ctlcluster 18 main restart

# Role, database, extension
sudo -u postgres psql -p 5433 -c "CREATE ROLE vector_demo LOGIN PASSWORD 'vector_demo';"
sudo -u postgres psql -p 5433 -c "CREATE DATABASE vector_demo OWNER vector_demo;"
sudo -u postgres psql -p 5433 -d vector_demo -c "CREATE EXTENSION vector;"
```

Check it with `ss -ltn | grep 5433`. You should see `0.0.0.0:5433`. If you see only `127.0.0.1:5433`, Windows can't reach it.

### 2. App

```bash
npm install
cp .env.example .env     # then set GROQ_API_KEY
npm run init-db          # creates tables + HNSW index (safe to re-run)
npm start                # http://localhost:3000
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | `postgres://vector_demo:vector_demo@localhost:5433/vector_demo` |
| `PORT` | `3000` | HTTP port |
| `GROQ_API_KEY` | — | Needed for answers. Without it, retrieval still runs. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any chat model available on your Groq key |

## Schema

```sql
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text NOT NULL,
  size        integer NOT NULL,
  chunk_count integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  doc_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  text        text NOT NULL,
  embedding   vector(384) NOT NULL
);

CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

The full, re-runnable version is in `scripts/init-db.js`.

## Working with vectors in pgvector

Things this project ran into:

**Send vectors as a string, not an array.** pgvector's input format is `'[0.1,0.2,...]'`. If you pass a JS array, node-pg sends it as a Postgres array (`{0.1,0.2}`), and the cast fails.

```js
const toVector = (arr) => `[${arr.join(',')}]`;
```

**They come back as strings too.** `SELECT embedding` returns `"[0.1,...]"`. It's valid JSON, so use `JSON.parse` if you need the numbers. This app never reads embeddings back. Once stored, only the operators touch them.

**Operators return distance, not similarity.**

| Operator | Metric | Best match |
|---|---|---|
| `<=>` | cosine distance | 0 |
| `<->` | L2 distance | 0 |
| `<#>` | negative inner product | most negative |

Similarity is `1 - (a <=> b)`. It can go slightly below 0 for unrelated text. The embeddings are L2-normalized, so cosine, L2, and inner product all rank results in the same order.

**Order by the bare distance, or the index won't be used.**

```sql
ORDER BY embedding <=> $1              -- Index Scan using the HNSW index
ORDER BY 1 - (embedding <=> $1) DESC   -- Seq Scan + Sort (every row)
```

The index's operator class has to match the query operator, too. A `vector_cosine_ops` index serves `<=>` and nothing else. So `lib/rag.js` sorts by the raw distance and selects `1 - distance` separately as the displayed score.

**Storage.** A `vector(384)` takes 384 × 4 bytes + 8 bytes of header = 1,544 bytes. The text form sent over the wire is about 8 KB.

### Differences from the MongoDB Atlas version

- **No index lag.** Atlas builds the vector index on separate search nodes and syncs it asynchronously, so new chunks show up in search a few seconds late. In Postgres the HNSW index updates inside the insert transaction, so a chunk is searchable as soon as `COMMIT` returns.
- **Atomic ingest.** Each document and all of its chunks are inserted in one transaction, with a single `INSERT ... SELECT FROM unnest(...)`.
- **Cascading deletes.** `ON DELETE CASCADE` makes orphaned chunks impossible.
- **Joins.** The filename comes from `documents` through a join. Each chunk doesn't carry its own copy.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/upload` | multipart `file` | `{ id, fileName, chunkCount }` |
| `POST` | `/api/chat` | `{ "question": "..." }` | `{ answer, sources: [{ fileName, snippet, score }] }` |
| `GET` | `/api/documents` | — | `{ count, limit, documents: [...] }` |
| `DELETE` | `/api/documents/:id` | — | `{ deleted, chunksRemoved }` |

If no chunk passes the similarity threshold, `/api/chat` returns `{ "answer": null, "sources": [] }` and doesn't call the LLM. Client errors return 4xx with `{ error }`.

## Project structure

```
server.js            Express routes, upload pipeline, error handling
lib/db.js            pg Pool
lib/extract.js       file -> text
lib/chunk.js         overlapping character chunks (+ assert self-check)
lib/embed.js         local MiniLM embeddings
lib/rag.js           vector search, prompt, Groq call
scripts/init-db.js   extension, tables, indexes
public/              vanilla JS frontend, no build step
samples/             example document to try
```

## Testing

```bash
npm test    # chunker self-check: empty input, max size, overlap
```

To try the whole flow, upload `samples/helios-knowledge-base.md` and ask "Does it support single sign-on?". The document never uses that phrase, but the answer comes from a passage about federated login through an identity provider.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5433` | Postgres inside WSL is bound to loopback only | Set `listen_addresses '*'` and add the `pg_hba.conf` line (Setup step 1) |
| Same error after a reboot | WSL shut down | Any `wsl` command starts it again. With systemd enabled, Postgres starts on its own. |
| `type "vector" does not exist` | Extension not enabled in this database | `CREATE EXTENSION vector;` (it's per database, not per server) |
| `expected 384 dimensions` | Embedding model changed | Column width must match the model output. Recreate the table. |
| `Groq 404 model_not_found` | Model was retired | Set `GROQ_MODEL` to a current model from Groq's `/models` list |

## Limits and next steps

These were left out on purpose:

- No auth. Every visitor shares the same 10 documents.
- Ingestion is synchronous and embeds chunks one at a time. That's fine at 2 MB, but would need a job queue for larger files.
- A single global similarity threshold (`MIN_SCORE` in `lib/rag.js`).

Ideas to explore: tuning `hnsw.ef_search` (recall vs. speed), HNSW build parameters `m` and `ef_construction`, hybrid search (combining `tsvector` full-text with vector similarity), and filtered search (`WHERE doc_id = ...`) and what it does to HNSW recall.
