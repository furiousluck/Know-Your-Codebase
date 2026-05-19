import mongoose from 'mongoose';

const repoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    owner: { type: String, required: true },
    fullName: { type: String, required: true },
    url: { type: String, required: true },
    branch: { type: String, default: 'main' },
    status: {
      type: String,
      enum: ['idle', 'indexing', 'ready', 'failed'],
      default: 'idle'
    },
    currentSha: String,
    currentCommitMessage: String,
    currentCommittedAt: Date,
    indexingStartedAt: Date,
    lockExpiresAt: Date,
    lastReusedAt: Date,
    reuseCount: { type: Number, default: 0 },
    totalFiles: { type: Number, default: 0 },
    totalChunks: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    skippedTooLarge: { type: Number, default: 0 },
    skippedByReason: { type: Object, default: {} },
    skippedExamples: { type: [Object], default: [] },
    lastIndexedAt: Date,
    lastError: String,
    embeddingProvider: { type: String, default: 'local' }
  },
  { timestamps: true }
);

repoSchema.index({ fullName: 1, branch: 1 }, { unique: true });
repoSchema.index({ fullName: 1, branch: 1, currentSha: 1 });
repoSchema.index({ status: 1, lockExpiresAt: 1 });

export const Repo = mongoose.model('Repo', repoSchema);
