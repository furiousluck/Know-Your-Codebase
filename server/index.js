import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDb } from './config/db.js';
import {
  acquireIndexingRepo,
  findRepoByIdentity,
  findRepoChunks,
  getRepo,
  listRepos,
  markRepoReused,
  replaceRepoChunks,
  updateRepo,
  upsertRepo,
  useMemoryStore,
  usingMemoryStore
} from './repositories/repoRepository.js';
import { ingestGitHubRepo, parseGitHubUrl, resolveGitHubRef } from './services/githubIngest.js';
import { answerWithOpenRouter } from './services/openrouter.js';
import { embeddingStatus } from './services/embeddings.js';
import { rankChunks, retrieveAnswerContexts } from './services/search.js';
import { generateRepoSuggestionsWithLlm } from './services/suggestions.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

useMemoryStore(true);
connectDb().then((mongoConnected) => {
  useMemoryStore(!mongoConnected);
});

app.get('/api/health', (_req, res) => {
  const embeddings = embeddingStatus();

  res.json({
    ok: true,
    store: usingMemoryStore() ? 'memory' : 'mongodb',
    openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    geminiConfigured: embeddings.remoteConfigured,
    embeddingProvider: embeddings.provider,
    embeddingFallbackActive: embeddings.fallbackActive
  });
});

app.get('/api/repos', async (_req, res, next) => {
  try {
    res.json({ repos: await listRepos() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/repos/ingest', async (req, res, next) => {
  const { url, branch = 'main', force = false } = req.body;

  try {
    const parsed = parseGitHubUrl(url);
    const ref = await resolveGitHubRef({ ...parsed, branch });
    const existing = await findRepoByIdentity(parsed.fullName, branch);

    if (!force && existing?.status === 'ready' && existing.currentSha === ref.sha) {
      const repo = await markRepoReused(existing._id || existing.id);
      return res.json({
        repo,
        action: 'reused',
        message: 'This repo branch is already indexed at the latest commit. Reusing existing chunks.'
      });
    }

    if (!force && existing?.status === 'indexing' && existing.currentSha === ref.sha) {
      return res.status(202).json({
        repo: existing,
        action: 'already-indexing',
        message: 'This exact repo commit is already being indexed. Reusing the in-flight job.'
      });
    }

    const lockExpiresAt = new Date(Date.now() + Number(process.env.INDEX_LOCK_TTL_MS || 15 * 60 * 1000));
    const lock = await acquireIndexingRepo(
      {
        ...parsed,
        url,
        branch,
        currentSha: ref.sha,
        currentCommitMessage: ref.message,
        currentCommittedAt: ref.committedAt,
        totalFiles: existing?.totalFiles || 0,
        totalChunks: existing?.totalChunks || 0,
        skippedFiles: existing?.skippedFiles || 0,
        skippedTooLarge: existing?.skippedTooLarge || 0,
        skippedByReason: existing?.skippedByReason || {},
        skippedExamples: existing?.skippedExamples || []
      },
      lockExpiresAt
    );

    if (!lock.acquired) {
      return res.status(202).json({
        repo: lock.repo,
        action: 'already-indexing',
        message: 'An index job is already running for this repo branch.'
      });
    }

    let repo = lock.repo;

    res.status(202).json({
      repo,
      action: force ? 'forced-reindex' : existing?.currentSha && existing.currentSha !== ref.sha ? 'started-new-commit' : 'started',
      message: 'Indexing started. Refresh status in a moment.'
    });

    try {
      const result = await ingestGitHubRepo({ url, branch, commitSha: ref.sha });
      repo = await upsertRepo({
        ...result.repo,
        currentSha: ref.sha,
        currentCommitMessage: ref.message,
        currentCommittedAt: ref.committedAt
      });
      await replaceRepoChunks(repo, result.chunks);
      await updateRepo(repo._id || repo.id, {
        currentSha: ref.sha,
        currentCommitMessage: ref.message,
        currentCommittedAt: ref.committedAt,
        status: 'ready',
        totalFiles: result.repo.totalFiles,
        totalChunks: result.repo.totalChunks,
        skippedFiles: result.repo.skippedFiles,
        skippedTooLarge: result.repo.skippedTooLarge,
        skippedByReason: result.repo.skippedByReason,
        skippedExamples: result.repo.skippedExamples,
        lastIndexedAt: result.repo.lastIndexedAt,
        embeddingProvider: result.repo.embeddingProvider,
        lockExpiresAt: null,
        lastError: ''
      });
    } catch (error) {
      await updateRepo(repo._id || repo.id, {
        status: 'failed',
        lockExpiresAt: null,
        lastError: error.message
      });
      console.error(error);
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/repos/:repoId/status', async (req, res, next) => {
  try {
    const repo = await getRepo(req.params.repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });
    return res.json({ repo });
  } catch (error) {
    next(error);
  }
});

app.post('/api/repos/:repoId/search', async (req, res, next) => {
  try {
    const { query, limit = 8 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const repo = await getRepo(req.params.repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });

    const chunks = await findRepoChunks(req.params.repoId);
    const results = await rankChunks(query, chunks, Number(limit));
    return res.json({ repo, results });
  } catch (error) {
    next(error);
  }
});

app.get('/api/repos/:repoId/suggestions', async (req, res, next) => {
  try {
    const repo = await getRepo(req.params.repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });

    const chunks = await findRepoChunks(req.params.repoId);
    const result = await generateRepoSuggestionsWithLlm(repo, chunks);
    return res.json({ repo, ...result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/repos/:repoId/ask', async (req, res, next) => {
  try {
    const { question, limit = 18, answerStyle = 'compact' } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    const repo = await getRepo(req.params.repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });

    const chunks = await findRepoChunks(req.params.repoId);
    const contexts = await retrieveAnswerContexts(question, chunks, Number(limit));
    const completion = await answerWithOpenRouter({ question, repo, contexts, answerStyle });

    return res.json({
      repo,
      question,
      answer: completion.answer,
      provider: completion.provider,
      answerStyle: completion.answerStyle,
      finishReason: completion.finishReason,
      incomplete: completion.incomplete,
      usage: completion.usage,
      citations: contexts.map((chunk) => ({
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        reason: `${chunk.kind} ${chunk.language} match`,
        score: chunk.score
      })),
      contexts
    });
  } catch (error) {
    next(error);
  }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});
