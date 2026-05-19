import crypto from 'crypto';

const repos = new Map();
const chunks = new Map();

function createId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 24);
}

export const memoryStore = {
  enabled: false,

  async upsertRepo(repo) {
    const id = createId(`${repo.fullName}:${repo.branch}`);
    const previous = repos.get(id) || {};
    const next = { ...previous, ...repo, _id: id, id, updatedAt: new Date().toISOString() };
    repos.set(id, next);
    return next;
  },

  async findRepoByIdentity(fullName, branch) {
    return Array.from(repos.values()).find((repo) => repo.fullName === fullName && repo.branch === branch) || null;
  },

  async markRepoReused(id) {
    const repo = repos.get(String(id));
    if (!repo) return null;
    const next = {
      ...repo,
      lastReusedAt: new Date().toISOString(),
      reuseCount: (repo.reuseCount || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    repos.set(String(id), next);
    return next;
  },

  async acquireIndexingRepo(repo, lockExpiresAt) {
    const id = createId(`${repo.fullName}:${repo.branch}`);
    const existing = repos.get(id);
    const now = Date.now();
    const existingLockExpiry = existing?.lockExpiresAt ? new Date(existing.lockExpiresAt).getTime() : 0;

    if (existing?.status === 'indexing' && existingLockExpiry > now) {
      return { repo: existing, acquired: false };
    }

    const next = {
      ...(existing || {}),
      ...repo,
      _id: id,
      id,
      status: 'indexing',
      indexingStartedAt: new Date().toISOString(),
      lockExpiresAt: lockExpiresAt.toISOString(),
      lastError: '',
      updatedAt: new Date().toISOString()
    };
    repos.set(id, next);
    return { repo: next, acquired: true };
  },

  async updateRepo(id, patch) {
    const repo = repos.get(String(id));
    if (!repo) return null;
    const next = { ...repo, ...patch, updatedAt: new Date().toISOString() };
    repos.set(String(id), next);
    return next;
  },

  async listRepos() {
    return Array.from(repos.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },

  async getRepo(id) {
    return repos.get(String(id)) || null;
  },

  async replaceChunks(repoId, repoKey, nextChunks) {
    for (const key of Array.from(chunks.keys())) {
      const chunk = chunks.get(key);
      if (String(chunk.repoId) === String(repoId) || chunk.repoKey === repoKey) chunks.delete(key);
    }

    nextChunks.forEach((chunk, index) => {
      const id = createId(`${repoKey}:${chunk.filePath}:${chunk.chunkIndex}:${index}`);
      chunks.set(id, { ...chunk, _id: id, id, repoId, repoKey });
    });
  },

  async findChunks(repoId) {
    return Array.from(chunks.values()).filter((chunk) => String(chunk.repoId) === String(repoId));
  }
};
