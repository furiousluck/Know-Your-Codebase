import crypto from 'crypto';

const LOCAL_DIMENSIONS = 128;
let remoteEmbeddingDisabledReason = '';

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function localEmbedding(text) {
  const vector = Array.from({ length: LOCAL_DIMENSIONS }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9_$-]{2,}/g) || [];

  for (const token of tokens) {
    const hash = crypto.createHash('sha256').update(token).digest();
    const index = hash[0] % LOCAL_DIMENSIONS;
    const sign = hash[1] % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(token.length, 20) / 20);
  }

  return normalize(vector);
}

async function geminiEmbedding(text, taskType) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          parts: [{ text: text.slice(0, 24000) }]
        },
        taskType
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embedding failed ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const values = data.embedding?.values || data.embeddings?.[0]?.values;
  if (!Array.isArray(values)) throw new Error('Gemini embedding response did not include values.');
  return normalize(values);
}

export async function embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!process.env.GEMINI_API_KEY) return localEmbedding(text);
  if (remoteEmbeddingDisabledReason) return localEmbedding(text);

  try {
    return await geminiEmbedding(text, taskType);
  } catch (error) {
    const fallbackEnabled = process.env.EMBEDDING_FALLBACK_ON_ERROR !== 'false';
    if (!fallbackEnabled) throw error;

    remoteEmbeddingDisabledReason = error.message;
    console.warn(`Gemini embeddings unavailable, using local fallback: ${error.message}`);
    return localEmbedding(text);
  }
}

export async function embedChunks(chunks) {
  const embedded = [];
  for (const chunk of chunks) {
    const summary = `${chunk.kind} ${chunk.language} chunk from ${chunk.filePath} lines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.text}`;
    const embedding = await embedText(summary, 'RETRIEVAL_DOCUMENT');
    embedded.push({ ...chunk, embedding });
  }
  return embedded;
}

export function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / ((Math.sqrt(magA) || 1) * (Math.sqrt(magB) || 1));
}

export function embeddingProviderName() {
  if (!process.env.GEMINI_API_KEY) return 'local:hash';
  if (remoteEmbeddingDisabledReason) return 'local:hash-fallback';
  return `gemini:${process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001'}`;
}

export function embeddingStatus() {
  return {
    provider: embeddingProviderName(),
    remoteConfigured: Boolean(process.env.GEMINI_API_KEY),
    fallbackActive: Boolean(remoteEmbeddingDisabledReason),
    fallbackReason: remoteEmbeddingDisabledReason
  };
}
