import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Code2,
  Database,
  FileSearch,
  Github,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ServerCrash,
  Sparkles
} from 'lucide-react';
import './styles.css';

const sampleQuestions = [
  'Where is authentication handled?',
  'Which files are involved in payment processing?',
  'Explain the flow from API route to database.',
  'Find functions related to user registration.'
];

const answerStyles = ['compact', 'detailed', 'debug', 'onboarding'];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function StatusPill({ status }) {
  const icon = status === 'ready' ? <CheckCircle2 size={14} /> : status === 'failed' ? <ServerCrash size={14} /> : <Activity size={14} />;
  return (
    <span className={`status-pill ${status || 'idle'}`}>
      {icon}
      {status || 'idle'}
    </span>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function RepoRow({ repo, selected, onSelect }) {
  const shortSha = repo.currentSha ? repo.currentSha.slice(0, 7) : 'no sha';

  return (
    <button className={`repo-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(repo)}>
      <div>
        <strong>{repo.fullName}</strong>
        <span>
          {repo.branch} / {shortSha}
        </span>
      </div>
      <StatusPill status={repo.status} />
    </button>
  );
}

function ResultCard({ result }) {
  return (
    <article className="result-card">
      <div className="result-head">
        <div>
          <strong>{result.filePath}</strong>
          <span>{`lines ${result.startLine}-${result.endLine} / ${result.kind} / ${result.language}`}</span>
        </div>
        <b>{result.score}</b>
      </div>
      <pre>{result.text}</pre>
    </article>
  );
}

function compactPath(filePath) {
  const parts = String(filePath || '').split('/');
  if (parts.length <= 3) return filePath;
  return `.../${parts.slice(-3).join('/')}`;
}

function CitationList({ citations = [] }) {
  return (
    <div className="citation-list">
      {citations.map((citation, index) => (
        <div className="citation-item" key={`${citation.filePath}:${citation.startLine}:${index}`}>
          <div>
            <strong title={citation.filePath}>{compactPath(citation.filePath)}</strong>
            <span>{citation.reason || 'retrieved context'}</span>
          </div>
          <b>
            {citation.startLine}-{citation.endLine}
          </b>
        </div>
      ))}
    </div>
  );
}

function MarkdownAnswer({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        pre: ({ node, ...props }) => <pre className="markdown-code" {...props} />,
        code: ({ node, className, children: codeChildren, ...props }) => (
          <code className={className || 'inline-code'} {...props}>
            {codeChildren}
          </code>
        )
      }}
    >
      {children || ''}
    </ReactMarkdown>
  );
}

function SuggestionChips({ loading, suggestions, onPick }) {
  if (loading) {
    return (
      <div className="question-strip" aria-label="Loading suggestions">
        {Array.from({ length: 4 }).map((_, index) => (
          <span className="suggestion-skeleton" key={index} />
        ))}
      </div>
    );
  }

  return (
    <div className="question-strip">
      {suggestions.map((item) => (
        <button key={item} type="button" onClick={() => onPick(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [health, setHealth] = useState(null);
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [answerQuestion, setAnswerQuestion] = useState(sampleQuestions[0]);
  const [answerStyle, setAnswerStyle] = useState('compact');
  const [suggestions, setSuggestions] = useState(sampleQuestions);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRepoFresh = useMemo(
    () => repos.find((repo) => String(repo._id || repo.id) === String(selectedRepo?._id || selectedRepo?.id)) || selectedRepo,
    [repos, selectedRepo]
  );

  async function refresh() {
    const [healthData, repoData] = await Promise.all([api('/api/health'), api('/api/repos')]);
    setHealth(healthData);
    setRepos(repoData.repos);
    setSelectedRepo((current) => {
      if (!repoData.repos.length) return null;
      if (!current) return repoData.repos[0];

      const currentId = String(current._id || current.id);
      return repoData.repos.find((repo) => String(repo._id || repo.id) === currentId) || current;
    });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 3500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const id = selectedRepoFresh?._id || selectedRepoFresh?.id;
    if (!id || selectedRepoFresh?.status !== 'ready') {
      setSuggestions(sampleQuestions);
      setSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestions([]);
    setSuggestionsLoading(true);

    api(`/api/repos/${id}/suggestions`)
      .then((data) => {
        if (cancelled) return;
        const next = data.suggestions?.length ? data.suggestions : sampleQuestions;
        setSuggestions(next);
        if (sampleQuestions.includes(answerQuestion)) setAnswerQuestion(next[0]);
      })
      .catch(() => {
        if (!cancelled) setSuggestions(sampleQuestions);
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRepoFresh?._id, selectedRepoFresh?.id, selectedRepoFresh?.status]);

  async function ingestRepo(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy('ingest');
    try {
      const data = await api('/api/repos/ingest', {
        method: 'POST',
        body: JSON.stringify({ url: repoUrl, branch })
      });
      setSelectedRepo(data.repo);
      setNotice(data.message || 'Index request accepted.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function runAsk(event) {
    event.preventDefault();
    if (!selectedRepoFresh) return;
    setError('');
    setNotice('');
    setBusy('ask');
    try {
      const id = selectedRepoFresh._id || selectedRepoFresh.id;
      const data = await api(`/api/repos/${id}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question: answerQuestion, answerStyle, limit: answerStyle === 'compact' ? 16 : 22 })
      });
      setAnswer(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Code2 size={24} />
          </div>
          <div>
            <h1>Codebase RAG</h1>
            <span>Phase 1 ingestion MVP</span>
          </div>
        </div>

        <form className="ingest-form" onSubmit={ingestRepo}>
          <label>
            GitHub repository
            <input
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              required
            />
          </label>
          <label>
            Branch
            <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" required />
          </label>
          <button type="submit" disabled={busy === 'ingest'}>
            {busy === 'ingest' ? <Loader2 className="spin" size={18} /> : <Github size={18} />}
            Index repository
          </button>
        </form>

        <section className="repo-list">
          <div className="section-title">
            <span>Repositories</span>
            <button className="icon-button" onClick={refresh} aria-label="Refresh repositories">
              <RefreshCw size={16} />
            </button>
          </div>
          {repos.length ? (
            repos.map((repo) => (
              <RepoRow
                key={repo._id || repo.id}
                repo={repo}
                selected={String(repo._id || repo.id) === String(selectedRepoFresh?._id || selectedRepoFresh?.id)}
                onSelect={setSelectedRepo}
              />
            ))
          ) : (
            <p className="empty">No repositories indexed yet.</p>
          )}
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{selectedRepoFresh?.fullName || 'Index a repository to begin'}</h2>
            <p>
              {selectedRepoFresh
                ? `${selectedRepoFresh.totalFiles || 0} files / ${selectedRepoFresh.totalChunks || 0} chunks / ${selectedRepoFresh.skippedFiles || 0} skipped / ${selectedRepoFresh.embeddingProvider || 'local'}`
                : 'Phase 1 covers GitHub files, docs, basic chunking, embeddings, search, and cited Q&A.'}
            </p>
          </div>
          {selectedRepoFresh && <StatusPill status={selectedRepoFresh.status} />}
        </header>

        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        <section className="metrics-grid">
          <Metric icon={<Database size={20} />} label="Store" value={health?.store || 'checking'} />
          <Metric icon={<BrainCircuit size={20} />} label="Gemini" value={health?.geminiConfigured ? 'configured' : 'local fallback'} />
          <Metric icon={<Sparkles size={20} />} label="OpenRouter" value={health?.openrouterConfigured ? 'configured' : 'retrieval only'} />
          <Metric icon={<FileSearch size={20} />} label="Commit" value={selectedRepoFresh?.currentSha?.slice(0, 7) || 'none'} />
        </section>

        {selectedRepoFresh && (
          <section className="index-detail">
            <div>
              <span>Indexed commit</span>
              <strong>{selectedRepoFresh.currentSha || 'Not resolved yet'}</strong>
            </div>
            <div>
              <span>Reused</span>
              <strong>{selectedRepoFresh.reuseCount || 0} times</strong>
            </div>
            <div>
              <span>Last indexed</span>
              <strong>{selectedRepoFresh.lastIndexedAt ? new Date(selectedRepoFresh.lastIndexedAt).toLocaleString() : 'Not indexed yet'}</strong>
            </div>
            <div>
              <span>Skipped large</span>
              <strong>{selectedRepoFresh.skippedTooLarge || 0} files</strong>
            </div>
          </section>
        )}

        {selectedRepoFresh?.skippedFiles > 0 && (
          <section className="skip-detail">
            <div className="section-title">
              <span>Skipped files</span>
            </div>
            <div className="skip-reasons">
              {Object.entries(selectedRepoFresh.skippedByReason || {}).map(([reason, count]) => (
                <span key={reason}>
                  {reason}: {count}
                </span>
              ))}
            </div>
            <div className="skip-examples">
              {(selectedRepoFresh.skippedExamples || []).slice(0, 6).map((item) => (
                <span key={`${item.filePath}:${item.reason}`}>
                  {item.reason} / {Math.round((item.byteLength || 0) / 1024)} KB / {item.filePath}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="ask-layout">
          <section className="panel ask-panel">
            <div className="panel-head">
              <div>
                <h3>Ask</h3>
                <p>Ask a codebase question. Retrieved context appears with the answer.</p>
              </div>
              <MessageSquareText size={20} />
            </div>
            <form className="query-form" onSubmit={runAsk}>
              <textarea value={answerQuestion} onChange={(event) => setAnswerQuestion(event.target.value)} rows={3} />
              <div className="segmented-control" aria-label="Answer style">
                {answerStyles.map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={answerStyle === style ? 'selected' : ''}
                    onClick={() => setAnswerStyle(style)}
                  >
                    {style}
                  </button>
                ))}
              </div>
              <SuggestionChips loading={suggestionsLoading} suggestions={suggestions} onPick={setAnswerQuestion} />
              <button type="submit" disabled={!selectedRepoFresh || busy === 'ask'}>
                {busy === 'ask' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                Ask assistant
              </button>
            </form>
          </section>
        </div>

        {answer && (
          <section className="answer-panel">
            <div className="answer-header">
              <div>
                <span className="answer-kicker">
                  <Sparkles size={14} />
                  Generated answer
                </span>
                <h3>Codebase answer</h3>
              </div>
              <div className="answer-meta">
                <span>{answer.answerStyle || 'compact'}</span>
                <span>{answer.finishReason || 'complete'}</span>
                {answer.incomplete && <span>incomplete</span>}
              </div>
            </div>
            <div className="answer-provider">{answer.provider}</div>
            <div className="answer-body">
              <div className="answer-text">
                <MarkdownAnswer>{answer.answer}</MarkdownAnswer>
              </div>
            </div>
            <div className="citations">
              <div className="citation-heading">
                <span>Sources</span>
                <b>{answer.citations.length}</b>
              </div>
              <CitationList citations={answer.citations} />
            </div>
            {answer.contexts?.length > 0 && (
              <details className="retrieved-context">
                <summary>
                  Retrieved context
                  <span>{answer.contexts.length} chunks</span>
                </summary>
                <div className="context-grid">
                  {answer.contexts.slice(0, 8).map((result) => (
                    <ResultCard key={`${result.filePath}:${result.startLine}:${result.endLine}`} result={result} />
                  ))}
                </div>
              </details>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
