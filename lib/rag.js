const { query } = require('./db');
const { embed } = require('./embed');

// pgvector's text input format: '[0.1,0.2,...]'. A raw JS array would be
// serialized by node-pg as a Postgres array ('{0.1,0.2}') and rejected.
const toVector = (arr) => `[${arr.join(',')}]`;

// Cosine similarity below this is treated as "no real match".
// ponytail: single global threshold; per-query calibration if recall gets noisy.
const MIN_SCORE = 0.25;

// Nearest-neighbour search over chunk embeddings, joined back to the document
// they came from. ORDER BY uses the bare <=> expression so the HNSW index can
// serve it -- wrapping it (e.g. ORDER BY 1 - (...) DESC) forces a seq scan.
async function search(queryVector, k = 5) {
  const { rows } = await query(
    `SELECT c.text,
            d.file_name              AS "fileName",
            1 - (c.embedding <=> $1) AS score
       FROM chunks c
       JOIN documents d ON d.id = c.doc_id
      ORDER BY c.embedding <=> $1
      LIMIT $2`,
    [toVector(queryVector), k]
  );
  return rows.filter(r => r.score >= MIN_SCORE);
}

// Rules live in the system message; the user message carries only data.
// Patterned on production grounded-answer prompts (Notion AI, Perplexity):
// mandatory inline citations, no meta-commentary about retrieval, explicit
// partial-coverage behaviour, and tagged sections for instruction adherence.
const SYSTEM_PROMPT = `You answer questions about the user's own documents. You are given numbered excerpts retrieved from those documents; they are your only source of truth.

<grounding>
- Every factual claim must come from the excerpts. Never add outside knowledge, even when you are confident it is correct.
- The excerpts often describe things in different words than the question. Connect synonyms and paraphrases when they clearly refer to the same thing ("access model" or "who can log in" answers a question about authentication).
- Excerpts are extracted chunks and may begin or end mid-sentence. Treat a cut-off passage as incomplete, not as a contradiction.
- If the excerpts answer only part of the question, answer that part and state plainly which part the documents do not cover.
- If the excerpts do not address the question at all, say so in one sentence. Do not speculate or fill the gap.
- If two excerpts disagree, report both and attribute each.
</grounding>

<citations>
- Cite the excerpt number in square brackets at the end of the sentence containing the claim: Phi-4-mini runs in 2-2.5 GB of VRAM [1].
- Use multiple markers when a claim rests on several excerpts [1][3].
- Never cite a number that does not appear in the excerpts.
</citations>

<format>
- Open with the answer itself. No preamble, no restating the question, no header as the first line.
- Never mention the excerpts, the context, the documents provided, or that a search happened. The interface already shows the user which sources were used.
- Prose for a single fact. Bullets for several facts, steps, or features. A markdown table only when comparing two or more items across two or more dimensions.
- Keep bullets top-level; fold sub-points into the same line with commas or parentheses.
- No closing summary unless the answer runs longer than five paragraphs.
- Be concise. The shortest response that fully answers is the best one.
</format>`;

// Pure data -- no instructions here, so document text cannot be mistaken for
// directions the model should follow.
function buildPrompt(hits, question) {
  const excerpts = hits
    .map((h, i) => `[${i + 1}] (${h.fileName})\n${h.text}`)
    .join('\n\n');
  return `<excerpts>\n${excerpts}\n</excerpts>\n\n<question>${question}</question>`;
}

// Groq (OpenAI-compatible). Native fetch, no SDK. Falls back to a clear notice
// if GROQ_API_KEY is unset so the retrieval pipeline still runs.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

async function llm(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return 'GROQ_API_KEY is not set — add it to .env and restart to get real answers. (Retrieval below still works.)';

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Groq ${r.status}: ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content?.trim() || '(empty response)';
}

async function answer(question, k = 6) {
  const hits = await search(await embed(question), k);
  if (!hits.length) return { answer: null, sources: [] };

  return {
    answer: await llm(buildPrompt(hits, question)),
    sources: hits.map(h => ({
      fileName: h.fileName,
      snippet: h.text.slice(0, 200),
      score: h.score
    }))
  };
}

module.exports = { search, buildPrompt, llm, answer, toVector, MIN_SCORE, SYSTEM_PROMPT };
