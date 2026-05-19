function styleInstruction(answerStyle = 'compact') {
  switch (answerStyle) {
    case 'detailed':
      return 'Answer in a detailed but bounded way. Use short sections, cite files/line ranges, and include small code snippets only when they clarify the flow. Stay under roughly 900 words.';
    case 'debug':
      return 'Answer like a debugging assistant. Lead with the likely cause or relevant files, then give a concise investigation path and concrete next checks. Cite files/line ranges.';
    case 'onboarding':
      return 'Answer for a new developer. Give a compact overview, the first files to read, and how the pieces connect. Cite files/line ranges.';
    case 'compact':
    default:
      return 'Answer concisely by default. Prefer 4-6 bullets or a short numbered flow. Do not paste code blocks unless the user explicitly asks. For flow questions, summarize each layer in one bullet. End with a short "Relevant files" list. Stay under roughly 250 words.';
  }
}

function looksIncomplete(answer, finishReason) {
  if (!answer || finishReason === 'length') return true;
  const trimmed = answer.trim();
  if (trimmed.length < 20) return true;
  if (/[[(][0-9]+(?:\s*(?:&|and|,)\s*\[?[0-9]*)?$/.test(trimmed)) return true;
  if (/(\*\*|__|`{1,3})$/.test(trimmed)) return true;
  if (/(\b(and|or|the|with|from|to|in|for|via|at|on|by)|[-–—:,;([{])$/i.test(trimmed)) return true;
  return false;
}

export async function answerWithOpenRouter({ question, repo, contexts, answerStyle = 'compact' }) {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      answer:
        'OpenRouter is not configured, so this is a retrieval-only answer. Review the cited chunks below; they are the most relevant matches for your question.',
      provider: 'retrieval-only',
      usage: null
    };
  }

  const contextText = contexts
    .map(
      (chunk, index) =>
        `Source ${index + 1}: ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} (${chunk.kind}, ${chunk.language})\n${chunk.text}`
    )
    .join('\n\n');

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
      temperature: 0.2,
      max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 2400),
      messages: [
        {
          role: 'system',
          content: `You are a codebase onboarding assistant. Answer only from the provided repository context. Cite files and line ranges using file paths like "StalkerApi.kt:1-80"; do not cite as [1] or [2]. Keep markdown valid: close code fences, use normal headings/lists, and avoid decorative horizontal rules. If context is insufficient, say what is missing.\n\n${styleInstruction(answerStyle)}`
        },
        {
          role: 'user',
          content: `Repository: ${repo.fullName} (${repo.branch})\nAnswer style: ${answerStyle}\n\nQuestion: ${question}\n\nContext:\n${contextText}`
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter failed ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const rawAnswer = choice?.message?.content || 'No answer returned.';
  const incomplete = looksIncomplete(rawAnswer, choice?.finish_reason || null);
  const answer = incomplete
    ? `${rawAnswer.trim()}\n\n> Answer may be incomplete because the selected free model stopped early. Try Compact style, ask a narrower question, or switch OpenRouter to a stronger model.`
    : rawAnswer;

  return {
    answer,
    provider: data.model || process.env.OPENROUTER_MODEL || 'openrouter',
    answerStyle,
    finishReason: choice?.finish_reason || null,
    incomplete,
    usage: data.usage || null
  };
}
