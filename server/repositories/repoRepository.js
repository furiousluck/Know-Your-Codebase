import mongoose from 'mongoose';
import { Chunk } from '../models/Chunk.js';
import { Repo } from '../models/Repo.js';
import { memoryStore } from '../store/memoryStore.js';

export function useMemoryStore(enabled) {
  memoryStore.enabled = enabled;
}

export function usingMemoryStore() {
  return memoryStore.enabled || mongoose.connection.readyState !== 1;
}

export async function upsertRepo(repo) {
  if (usingMemoryStore()) return memoryStore.upsertRepo(repo);

  return Repo.findOneAndUpdate(
    { fullName: repo.fullName, branch: repo.branch },
    repo,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export async function findRepoByIdentity(fullName, branch) {
  if (usingMemoryStore()) return memoryStore.findRepoByIdentity(fullName, branch);
  return Repo.findOne({ fullName, branch }).lean();
}

export async function markRepoReused(repoId) {
  if (usingMemoryStore()) return memoryStore.markRepoReused(repoId);
  return Repo.findByIdAndUpdate(
    repoId,
    {
      $inc: { reuseCount: 1 },
      $set: { lastReusedAt: new Date() }
    },
    { new: true }
  ).lean();
}

export async function acquireIndexingRepo(repo, lockExpiresAt) {
  if (usingMemoryStore()) return memoryStore.acquireIndexingRepo(repo, lockExpiresAt);

  const now = new Date();
  const doc = await Repo.findOneAndUpdate(
    {
      fullName: repo.fullName,
      branch: repo.branch,
      $or: [{ status: { $ne: 'indexing' } }, { lockExpiresAt: { $lte: now } }, { lockExpiresAt: { $exists: false } }]
    },
    {
      $set: {
        ...repo,
        status: 'indexing',
        indexingStartedAt: now,
        lockExpiresAt,
        lastError: ''
      },
      $setOnInsert: {
        reuseCount: 0
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (doc) return { repo: doc, acquired: true };

  const existing = await Repo.findOne({ fullName: repo.fullName, branch: repo.branch }).lean();
  return { repo: existing, acquired: false };
}

export async function updateRepo(repoId, patch) {
  if (usingMemoryStore()) return memoryStore.updateRepo(repoId, patch);
  return Repo.findByIdAndUpdate(repoId, patch, { new: true }).lean();
}

export async function listRepos() {
  if (usingMemoryStore()) return memoryStore.listRepos();
  return Repo.find().sort({ updatedAt: -1 }).lean();
}

export async function getRepo(repoId) {
  if (usingMemoryStore()) return memoryStore.getRepo(repoId);
  return Repo.findById(repoId).lean();
}

export async function replaceRepoChunks(repo, chunks) {
  const repoId = repo._id || repo.id;
  const repoKey = `${repo.fullName}:${repo.branch}:${repo.currentSha || 'unknown'}`;
  const docs = chunks.map((chunk) => ({ ...chunk, repoId, repoKey }));

  if (usingMemoryStore()) {
    await memoryStore.replaceChunks(repoId, repoKey, docs);
    return;
  }

  await Chunk.deleteMany({ repoId });
  if (docs.length) await Chunk.insertMany(docs, { ordered: false });
}

export async function findRepoChunks(repoId) {
  if (usingMemoryStore()) return memoryStore.findChunks(repoId);
  return Chunk.find({ repoId }).lean();
}
