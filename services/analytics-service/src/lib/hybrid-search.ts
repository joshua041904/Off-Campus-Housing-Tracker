import { pool } from "../db.js";
import { rerankLtrCandidates, type LtrWeights } from "./reranker.js";

export type HybridSearchResult = {
  listing_id: string;
  title: string;
  description: string;
  score: number;
  vector_score: number;
  keyword_score: number;
  recency_score: number;
};

type HybridSearchInput = {
  query: string;
  limit: number;
};

const OLLAMA_TIMEOUT_MS = 15_000;
const OLLAMA_RETRIES = Number(process.env.ANALYTICS_OLLAMA_RETRIES || "3");
const EMBEDDING_DIMS = Number(process.env.OLLAMA_EMBEDDING_DIMS || "384");
const MAX_LIMIT = 20;

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
}

function ollamaModel(): string {
  return process.env.OLLAMA_MODEL || "llama3.2:1b";
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((v) => Number(v).toFixed(8)).join(",")}]`;
}

async function embedQuery(query: string): Promise<number[] | null> {
  if (!ollamaBaseUrl()) return null;
  for (let attempt = 1; attempt <= OLLAMA_RETRIES; attempt++) {
    try {
      const res = await fetch(`${ollamaBaseUrl()}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel(),
          prompt: query,
        }),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (attempt < OLLAMA_RETRIES) continue;
        return null;
      }
      const body = (await res.json()) as { embedding?: unknown };
      if (!Array.isArray(body.embedding)) {
        if (attempt < OLLAMA_RETRIES) continue;
        return null;
      }
      const emb = body.embedding
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x))
        .slice(0, EMBEDDING_DIMS);
      if (emb.length !== EMBEDDING_DIMS) {
        if (attempt < OLLAMA_RETRIES) continue;
        return null;
      }
      return emb;
    } catch {
      if (attempt >= OLLAMA_RETRIES) return null;
    }
  }
  return null;
}

async function getActiveLtrWeights(): Promise<Partial<LtrWeights>> {
  try {
    const r = await pool.query(
      `SELECT w.distance, w.recency
         FROM analytics.recommendation_weights w
         JOIN analytics.recommendation_models m ON m.id = w.model_id
        WHERE m.is_active = true
        ORDER BY m.id DESC
        LIMIT 1`
    );
    if (!r.rows[0]) return {};
    const distance = Number(r.rows[0].distance);
    const recency = Number(r.rows[0].recency);
    return {
      vector: Number.isFinite(distance) ? Math.max(0, Math.min(distance, 1)) : 0.6,
      recency: Number.isFinite(recency) ? Math.max(0, Math.min(recency, 1)) : 0.1,
      // Keep these stable until an offline trainer sets them.
      keyword: 0.25,
      length: 0.05,
    };
  } catch {
    return {};
  }
}

export async function runHybridSearch(input: HybridSearchInput): Promise<HybridSearchResult[]> {
  const query = String(input.query || "").trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(input.limit) || 5));
  const embedding = await embedQuery(query);
  if (!embedding) return [];

  const vector = vectorLiteral(embedding);
  let rows: Array<{
    listing_id: string;
    title: string;
    description: string;
    vector_score: number;
    keyword_score: number;
    recency_score: number;
  }> = [];

  try {
    const r = await pool.query(
      `WITH base AS (
         SELECT
           listing_id,
           title,
           description,
           (1 - (embedding <=> $1::vector))::float8 AS vector_score,
           ts_rank_cd(search_tsv, websearch_to_tsquery('english', $2))::float8 AS keyword_score,
           (1 / (1 + EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0))::float8 AS recency_score
         FROM analytics.listing_search_index
         WHERE search_tsv @@ websearch_to_tsquery('english', $2)
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $3 * 5
       )
       SELECT * FROM base`,
      [vector, query, limit]
    );
    rows = r.rows;
  } catch (e) {
    // pgvector extension/table might not be deployed yet in some environments.
    const msg = String((e as Error)?.message || "");
    if (
      msg.includes("type \"vector\" does not exist") ||
      msg.includes("relation \"analytics.listing_search_index\" does not exist")
    ) {
      return [];
    }
    throw e;
  }

  if (!rows.length) return [];
  const weights = await getActiveLtrWeights();
  const ranked = rerankLtrCandidates(
    rows.map((row) => ({
      id: row.listing_id,
      response: `${row.title} ${row.description}`,
      vectorScore: Number(row.vector_score) || 0,
      keywordScore: Number(row.keyword_score) || 0,
      recency: Number(row.recency_score) || 0,
    })),
    weights
  );

  const byId = new Map(rows.map((r) => [r.listing_id, r]));
  return ranked.slice(0, limit).map((item) => {
    const row = byId.get(item.id)!;
    return {
      listing_id: row.listing_id,
      title: row.title,
      description: row.description,
      score: item.score,
      vector_score: Number(row.vector_score) || 0,
      keyword_score: Number(row.keyword_score) || 0,
      recency_score: Number(row.recency_score) || 0,
    };
  });
}
