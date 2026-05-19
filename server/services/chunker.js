import crypto from 'crypto';
import { classifyKind, detectLanguage } from './fileFilters.js';

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function chunkFile({ filePath, content }) {
  const targetLines = Number(process.env.CHUNK_TARGET_LINES || 80);
  const overlapLines = Number(process.env.CHUNK_OVERLAP_LINES || 12);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];

  let start = 0;
  let chunkIndex = 0;

  while (start < lines.length) {
    const end = Math.min(start + targetLines, lines.length);
    const text = lines.slice(start, end).join('\n').trim();

    if (text) {
      chunks.push({
        filePath,
        language: detectLanguage(filePath),
        kind: classifyKind(filePath),
        chunkIndex,
        startLine: start + 1,
        endLine: end,
        text,
        contentHash: hashText(`${filePath}:${start + 1}:${end}:${text}`),
        metadata: {
          lineCount: end - start
        }
      });
      chunkIndex += 1;
    }

    if (end === lines.length) break;
    start = Math.max(end - overlapLines, start + 1);
  }

  return chunks;
}
