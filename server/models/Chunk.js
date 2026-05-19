import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema(
  {
    repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repo', index: true },
    repoKey: { type: String, index: true },
    filePath: { type: String, required: true, index: true },
    language: { type: String, default: 'text', index: true },
    kind: { type: String, default: 'text', index: true },
    chunkIndex: { type: Number, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
    text: { type: String, required: true },
    contentHash: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

chunkSchema.index({ repoKey: 1, filePath: 1, chunkIndex: 1 });
chunkSchema.index(
  { text: 'text', filePath: 'text' },
  {
    default_language: 'none',
    language_override: 'mongoTextLanguage'
  }
);

export const Chunk = mongoose.model('Chunk', chunkSchema);
