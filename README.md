# Codebase RAG Phase 1

Phase 1 is a MERN-style MVP for ingesting a GitHub repository and asking basic codebase questions.

## What This Phase Includes

- GitHub public/private repo ingestion through downloaded zip archives
- README, docs, source, test, config, and API-ish file filtering
- Language detection from file extensions
- Token-light line chunking with overlap
- Gemini embeddings when `GEMINI_API_KEY` is configured
- Deterministic local embedding fallback for development
- Automatic local embedding fallback if Gemini quota or rate limits are hit
- MongoDB persistence through Mongoose
- In-memory fallback when MongoDB is not configured
- Hybrid-ish search using vector similarity plus keyword scoring
- OpenRouter answer generation when `OPENROUTER_API_KEY` is configured
- Cited answers with file paths and line ranges
- React dashboard for indexing, repo status, search, and Q&A
- Commit-aware index reuse for repeated access to the same repo branch
- Indexing lock to avoid duplicate work while a repo is already being indexed

## What Comes Later

Phase 2 should replace generic line chunking with AST-based, language-aware chunking using Tree-sitter.

Phase 3 should harden retrieval with better reranking, filters, and richer Q&A orchestration.

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

The client runs on `http://127.0.0.1:5173`.

The API runs on `http://127.0.0.1:8787`.

## Phase 1.5 Index Reuse

Before indexing, the server resolves the latest GitHub commit SHA for the requested branch.

If `owner/repo + branch + commitSha` is already indexed, the API returns `action: "reused"` and does not download, chunk, or embed the repository again.

If another request is already indexing the same repo branch, the API returns `action: "already-indexing"` and reuses the in-flight job.

If the branch points to a new commit SHA, the API starts a new indexing job and replaces the branch's chunks when the job completes.

## API

### Health

```http
GET /api/health
```

### Ingest a Repo

```http
POST /api/repos/ingest
Content-Type: application/json

{
  "url": "https://github.com/owner/repo",
  "branch": "main"
}
```

### List Repos

```http
GET /api/repos
```

### Search

```http
POST /api/repos/:repoId/search
Content-Type: application/json

{
  "query": "Where is authentication handled?",
  "limit": 8
}
```

### Ask

```http
POST /api/repos/:repoId/ask
Content-Type: application/json

{
  "question": "Which files are involved in payment processing?"
}
```

## Environment Notes

Gemini embeddings use the official `models.embedContent` endpoint:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
```

OpenRouter Q&A uses:

```text
https://openrouter.ai/api/v1/chat/completions
```

Free OpenRouter models have low rate limits. Keep `OPENROUTER_MODEL=openrouter/free` for easy testing, or use a specific free model slug.
