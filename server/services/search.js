import { cosineSimilarity, embedText } from './embeddings.js';

const FLOW_TERMS = [
  'api route endpoint controller handler service repository dao database room entity model viewmodel datasource data source client http request response',
  'repository dao database room entity model table query insert update select flow',
  'viewmodel usecase interactor service repository data source database api',
  'stalker stalkerapi iptvchannel channel portal server load get_all_channels repository database viewmodel'
];

const STOPWORDS = new Set([
  'the',
  'from',
  'into',
  'onto',
  'and',
  'or',
  'for',
  'with',
  'this',
  'that',
  'what',
  'where',
  'which',
  'explain',
  'show',
  'find',
  'how',
  'does',
  'are',
  'is',
  'to',
  'of',
  'in',
  'on',
  'a',
  'an'
]);

function queryTerms(query) {
  return (query.toLowerCase().match(/[a-z0-9_$-]{2,}/g) || []).filter((term) => !STOPWORDS.has(term));
}

function keywordScore(query, chunk) {
  const haystack = `${chunk.filePath} ${chunk.kind} ${chunk.language} ${chunk.text}`.toLowerCase();
  const terms = queryTerms(query);
  if (!terms.length) return 0;

  const hits = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
  return hits / terms.length;
}

function roleScore(query, chunk) {
  const lowerQuery = query.toLowerCase();
  const path = chunk.filePath.toLowerCase();
  const textHead = chunk.text.slice(0, 1200).toLowerCase();
  let score = 0;

  for (const term of queryTerms(query)) {
    if (term.length >= 4 && path.includes(term)) score += 0.18;
  }

  if (lowerQuery.includes('stalker') && path.includes('stalker')) score += 0.35;
  if (lowerQuery.includes('iptv') && path.includes('iptv')) score += 0.22;
  if (/repository|database|dao|flow|route|api/.test(lowerQuery) && path.includes('/data/repository/')) score += 0.18;
  if (/api|route|flow/.test(lowerQuery) && path.includes('/data/api/')) score += 0.18;
  if (/viewmodel|flow|ui/.test(lowerQuery) && path.includes('viewmodel')) score += 0.12;
  if (/database|db|dao|room/.test(lowerQuery) && /(database|dao|room|supabase|datastore)/.test(`${path} ${textHead}`)) score += 0.16;
  if (path.includes('changelog') || path.includes('readme') || path.includes('privacy') || path.includes('.github/')) score -= 0.16;
  if (path.endsWith('.toml') || path.endsWith('.yml') || path.endsWith('.yaml')) score -= 0.08;

  return score;
}

export function compactChunk(chunk) {
  return {
    id: chunk._id || chunk.id,
    filePath: chunk.filePath,
    language: chunk.language,
    kind: chunk.kind,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
    score: Number(chunk.score?.toFixed?.(4) || chunk.score || 0)
  };
}

function chunkKey(chunk) {
  return `${chunk.filePath}:${chunk.startLine}:${chunk.endLine}`;
}

function inferQuestionType(query) {
  const lower = query.toLowerCase();
  if (/(flow|route|api|database|db|repository|dao|from .* to|handled|involved|architecture|explain)/.test(lower)) {
    return 'flow';
  }
  return 'general';
}

function expandedQueries(query) {
  if (inferQuestionType(query) !== 'flow') return [query];

  const lower = query.toLowerCase();
  const featureTerms = [];
  for (const term of ['stalker', 'xtream', 'm3u', 'iptv', 'channel', 'auth', 'login', 'payment', 'user', 'registration']) {
    if (lower.includes(term)) featureTerms.push(term);
  }

  const featurePrefix = featureTerms.length ? `${featureTerms.join(' ')} ` : '';
  return [query, ...FLOW_TERMS.map((terms) => `${featurePrefix}${terms}`)];
}

function scoreChunks(query, chunks, queryEmbedding) {
  return chunks.map((chunk) => {
    const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding || []);
    const lexicalScore = keywordScore(query, chunk);
    return {
      ...chunk,
      score: vectorScore * 0.55 + lexicalScore * 0.3 + roleScore(query, chunk),
      vectorScore,
      lexicalScore
    };
  });
}

function diversifyByFile(ranked, limit) {
  const selected = [];
  const seenFiles = new Map();

  for (const chunk of ranked) {
    const count = seenFiles.get(chunk.filePath) || 0;
    if (count >= 2 && selected.length < Math.ceil(limit * 0.7)) continue;
    selected.push(chunk);
    seenFiles.set(chunk.filePath, count + 1);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const chunk of ranked) {
      if (selected.some((item) => chunkKey(item) === chunkKey(chunk))) continue;
      selected.push(chunk);
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

function expandNeighbors(selected, allChunks, maxExtra = 8) {
  const selectedKeys = new Set(selected.map(chunkKey));
  const extras = [];

  for (const chunk of selected) {
    const neighbors = allChunks
      .filter(
        (candidate) =>
          candidate.filePath === chunk.filePath &&
          Math.abs(Number(candidate.chunkIndex || 0) - Number(chunk.chunkIndex || 0)) === 1
      )
      .sort((a, b) => Math.abs(a.chunkIndex - chunk.chunkIndex) - Math.abs(b.chunkIndex - chunk.chunkIndex));

    for (const neighbor of neighbors) {
      const key = chunkKey(neighbor);
      if (selectedKeys.has(key)) continue;
      extras.push({ ...neighbor, score: Math.max((chunk.score || 0) - 0.04, 0) });
      selectedKeys.add(key);
      if (extras.length >= maxExtra) return [...selected, ...extras];
    }
  }

  return [...selected, ...extras];
}

export async function rankChunks(query, chunks, limit = 8) {
  const queryEmbedding = await embedText(query, 'RETRIEVAL_QUERY');

  return scoreChunks(query, chunks, queryEmbedding)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(compactChunk);
}

export async function retrieveAnswerContexts(query, chunks, limit = 18) {
  const rankedByKey = new Map();

  for (const nextQuery of expandedQueries(query)) {
    const queryEmbedding = await embedText(nextQuery, 'RETRIEVAL_QUERY');
    const ranked = scoreChunks(nextQuery, chunks, queryEmbedding)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(limit, 16));

    for (const chunk of ranked) {
      const key = chunkKey(chunk);
      const previous = rankedByKey.get(key);
      if (!previous || chunk.score > previous.score) rankedByKey.set(key, chunk);
    }
  }

  const ranked = Array.from(rankedByKey.values()).sort((a, b) => b.score - a.score);
  const diversified = diversifyByFile(ranked, limit);
  const expanded = inferQuestionType(query) === 'flow' ? expandNeighbors(diversified, chunks, 8) : diversified;

  return expanded
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return `${a.filePath}:${a.startLine}`.localeCompare(`${b.filePath}:${b.startLine}`);
    })
    .slice(0, limit + 8)
    .map(compactChunk);
}
