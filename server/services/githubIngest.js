import AdmZip from 'adm-zip';
import { chunkFile } from './chunker.js';
import { embedChunks, embeddingProviderName } from './embeddings.js';
import { getFileIndexDecision, looksBinary } from './fileFilters.js';

export function parseGitHubUrl(url) {
  const match = String(url).match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/#.]+)(?:\.git)?/i);
  if (!match?.groups) throw new Error('Use a GitHub repository URL like https://github.com/owner/repo.');
  return {
    owner: match.groups.owner,
    name: match.groups.repo.replace(/\.git$/, ''),
    fullName: `${match.groups.owner}/${match.groups.repo.replace(/\.git$/, '')}`
  };
}

function githubHeaders() {
  const headers = {};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  headers.Accept = 'application/vnd.github+json';
  headers['X-GitHub-Api-Version'] = '2022-11-28';
  return headers;
}

export async function resolveGitHubRef({ owner, name, branch }) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub commit lookup failed ${response.status}: ${body.slice(0, 220)}`);
  }

  const data = await response.json();
  if (!data.sha) throw new Error('GitHub commit lookup did not return a SHA.');
  return {
    sha: data.sha,
    message: data.commit?.message || '',
    committedAt: data.commit?.committer?.date || data.commit?.author?.date || null
  };
}

async function fetchRepoZip({ owner, name, ref }) {
  const headers = githubHeaders();

  const response = await fetch(`https://codeload.github.com/${owner}/${name}/zip/${encodeURIComponent(ref)}`, {
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub download failed ${response.status}: ${body.slice(0, 220)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractIndexableFiles(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const maxFiles = Number(process.env.MAX_INDEX_FILES || 800);
  const files = [];
  const skipped = {
    total: 0,
    tooLarge: 0,
    byReason: {},
    examples: []
  };

  function recordSkip(filePath, decision) {
    skipped.total += 1;
    skipped.byReason[decision.reason] = (skipped.byReason[decision.reason] || 0) + 1;
    if (decision.reason === 'too-large') skipped.tooLarge += 1;
    if (skipped.examples.length < 25) {
      skipped.examples.push({
        filePath,
        reason: decision.reason,
        byteLength: decision.byteLength,
        maxBytes: decision.maxBytes,
        language: decision.language,
        kind: decision.kind
      });
    }
  }

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const rawPath = entry.entryName.replace(/\\/g, '/');
    const filePath = rawPath.split('/').slice(1).join('/');
    const data = entry.getData();

    if (!filePath) continue;

    const decision = getFileIndexDecision(filePath, data.length);

    if (!decision.index) {
      recordSkip(filePath, decision);
      continue;
    }

    if (looksBinary(data)) {
      recordSkip(filePath, { ...decision, index: false, reason: 'binary-content' });
      continue;
    }

    files.push({
      filePath,
      content: data.toString('utf8')
    });

    if (files.length >= maxFiles) break;
  }

  return { files, skipped };
}

export async function ingestGitHubRepo({ url, branch = 'main', commitSha }) {
  const parsed = parseGitHubUrl(url);
  const ref = commitSha || branch;
  const zipBuffer = await fetchRepoZip({ ...parsed, ref });
  const { files, skipped } = extractIndexableFiles(zipBuffer);
  const chunks = files.flatMap((file) => chunkFile(file));
  const embeddedChunks = await embedChunks(chunks);

  return {
    repo: {
      ...parsed,
      url,
      branch,
      currentSha: commitSha || null,
      status: 'ready',
      totalFiles: files.length,
      totalChunks: embeddedChunks.length,
      skippedFiles: skipped.total,
      skippedTooLarge: skipped.tooLarge,
      skippedByReason: skipped.byReason,
      skippedExamples: skipped.examples,
      lastIndexedAt: new Date(),
      embeddingProvider: embeddingProviderName()
    },
    chunks: embeddedChunks
  };
}
