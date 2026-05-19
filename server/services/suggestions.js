const domainPatterns = [
  { key: 'stalker', label: 'Stalker portal', terms: ['stalker', 'ministra'], weight: 8 },
  { key: 'iptv', label: 'IPTV', terms: ['iptv', 'm3u', 'epg'], weight: 6 },
  { key: 'trakt', label: 'Trakt sync', terms: ['trakt'], weight: 6 },
  { key: 'supabase', label: 'Supabase', terms: ['supabase'], weight: 5 },
  { key: 'player', label: 'playback', terms: ['player', 'stream', 'exo'], weight: 4 },
  { key: 'auth', label: 'authentication', terms: ['auth', 'login', 'session'], weight: 4 },
  { key: 'catalog', label: 'catalogs', terms: ['catalog'], weight: 3 },
  { key: 'home', label: 'home screen', terms: ['homeviewmodel', 'homescreen'], weight: 3 },
  { key: 'profile', label: 'profiles', terms: ['profile'], weight: 2 },
  { key: 'settings', label: 'settings', terms: ['settings', 'config', 'preferences'], weight: 1 }
];

function hasAny(haystack, terms) {
  return terms.some((term) => haystack.includes(term));
}

function topDomains(chunks) {
  const scores = new Map();

  for (const chunk of chunks) {
    const haystack = `${chunk.filePath} ${chunk.text.slice(0, 1200)}`.toLowerCase();
    for (const domain of domainPatterns) {
      if (hasAny(haystack, domain.terms)) {
        const pathBonus = hasAny(String(chunk.filePath).toLowerCase(), domain.terms) ? domain.weight * 2 : domain.weight;
        scores.set(domain.key, (scores.get(domain.key) || 0) + pathBonus);
      }
    }
  }

  return domainPatterns
    .map((domain) => ({ ...domain, score: scores.get(domain.key) || 0 }))
    .filter((domain) => domain.score > 0)
    .sort((a, b) => b.score - a.score);
}

function hasPath(chunks, pattern) {
  return chunks.some((chunk) => pattern.test(chunk.filePath));
}

function uniqueQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const key = question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateRepoSuggestions(chunks) {
  const domains = topDomains(chunks);
  const primary = domains[0];
  const secondary = domains[1];
  const questions = [];

  for (const domain of domains.slice(0, 4)) {
    if (domain.key === 'stalker') questions.push('Explain the Stalker portal channel loading flow.');
    if (domain.key === 'iptv') questions.push('How are IPTV channels loaded, cached, and shown in the UI?');
    if (domain.key === 'trakt') questions.push('How does Trakt sync interact with local watch state?');
    if (domain.key === 'supabase') questions.push('Where is Supabase used and what data is persisted there?');
    if (domain.key === 'player') questions.push('How does playback resolve and start a stream?');
  }

  if (primary) {
    questions.push(`Explain the ${primary.label} flow end to end.`);
    questions.push(`Which files are involved in ${primary.label}?`);
    questions.push(`Where is ${primary.label} configured and loaded?`);
  }

  if (secondary) {
    questions.push(`How does ${primary?.label || 'the app'} connect with ${secondary.label}?`);
    questions.push(`Find bugs or edge cases in the ${secondary.label} flow.`);
  }

  if (hasPath(chunks, /\/data\/repository\//i)) {
    questions.push('Which repositories are most important in this codebase?');
    questions.push('Explain the flow from ViewModel to repository.');
  }

  if (hasPath(chunks, /\/data\/api\//i)) {
    questions.push('Which API clients does this app use?');
    questions.push('Explain the flow from API client to app state.');
  }

  if (hasPath(chunks, /viewmodel/i)) {
    questions.push('Which ViewModels coordinate the main user flows?');
  }

  if (hasPath(chunks, /test|spec/i)) {
    questions.push('Which tests cover the most important repository logic?');
    questions.push('Suggest missing test cases for the main data flow.');
  }

  questions.push('Give me an onboarding map of the most important files.');

  return uniqueQuestions(questions).slice(0, 8);
}

function representativeRepoSignals(chunks) {
  const domains = topDomains(chunks)
    .slice(0, 8)
    .map((domain) => `${domain.label} (${domain.score})`);

  const importantPaths = Array.from(
    new Set(
      chunks
        .map((chunk) => chunk.filePath)
        .filter((filePath) => /\/data\/api\/|\/data\/repository\/|viewmodel|screen|module|supabase|test|spec/i.test(filePath))
    )
  ).slice(0, 80);

  const snippets = chunks
    .filter((chunk) => /stalker|iptv|trakt|supabase|repository|viewmodel|player|auth|catalog/i.test(`${chunk.filePath} ${chunk.text}`))
    .slice(0, 24)
    .map((chunk) => ({
      filePath: chunk.filePath,
      lines: `${chunk.startLine}-${chunk.endLine}`,
      preview: chunk.text.slice(0, 260).replace(/\s+/g, ' ')
    }));

  return { domains, importantPaths, snippets };
}

function parseSuggestionJson(text) {
  const trimmed = String(text || '').trim();
  const jsonText = trimmed.match(/\[[\s\S]*\]/)?.[0] || trimmed;
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('Suggestion response was not a JSON array.');

  return uniqueQuestions(
    parsed
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length >= 18 && item.length <= 110 && item.endsWith('?'))
  ).slice(0, 8);
}

export async function generateRepoSuggestionsWithLlm(repo, chunks) {
  const fallback = generateRepoSuggestions(chunks);
  if (!process.env.OPENROUTER_API_KEY) return { suggestions: fallback, source: 'heuristic' };

  const signals = representativeRepoSignals(chunks);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://127.0.0.1:5173',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Codebase RAG Phase 1'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openrouter/free',
        temperature: 0.35,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'Generate useful question suggestions for a developer exploring a codebase. Return only a JSON array of 6-8 concise question strings. Questions must be specific to the repo signals, natural, and useful for architecture/debug/onboarding. Avoid generic auth/payment questions unless the repo signals mention them.'
          },
          {
            role: 'user',
            content: `Repository: ${repo.fullName}\nBranch: ${repo.branch}\nDetected domains: ${signals.domains.join(', ')}\n\nImportant paths:\n${signals.importantPaths.join('\n')}\n\nRepresentative chunks:\n${JSON.stringify(signals.snippets, null, 2)}`
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`OpenRouter suggestions failed ${response.status}`);
    const data = await response.json();
    const suggestions = uniqueQuestions([...parseSuggestionJson(data.choices?.[0]?.message?.content), ...fallback]).slice(0, 8);
    return { suggestions: suggestions.length ? suggestions : fallback, source: suggestions.length ? 'llm' : 'heuristic' };
  } catch (error) {
    console.warn(`Suggestion LLM fallback: ${error.message}`);
    return { suggestions: fallback, source: 'heuristic' };
  }
}
