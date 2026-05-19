const languageByExtension = new Map([
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.py', 'python'],
  ['.java', 'java'],
  ['.go', 'go'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
  ['.cs', 'csharp'],
  ['.cpp', 'cpp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.rs', 'rust'],
  ['.swift', 'swift'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.md', 'markdown'],
  ['.mdx', 'markdown'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.sql', 'sql'],
  ['.graphql', 'graphql'],
  ['.gql', 'graphql'],
  ['.html', 'html'],
  ['.css', 'css'],
  ['.scss', 'scss']
]);

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'vendor',
  'target',
  '__pycache__'
]);

const ignoredExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.mp4',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.lock'
]);

const alwaysSkipPatterns = [
  /(^|\/)[^/]+\.min\.(js|css)$/i,
  /(^|\/)(package-lock|yarn\.lock|pnpm-lock|bun\.lockb|poetry\.lock|cargo\.lock|composer\.lock)$/i,
  /(^|\/)(generated|__generated__|snapshots?|fixtures?)\//i,
  /(^|\/).*\.snap$/i,
  /(^|\/).*\.map$/i
];

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.rs', '.swift', '.kt']);
const docExtensions = new Set(['.md', '.mdx']);
const configExtensions = new Set(['.json', '.yaml', '.yml', '.toml', '.graphql', '.gql', '.conf', '.properties', '.gradle', '.kts']);

function numberEnv(name, fallback) {
  return Number(process.env[name] || fallback);
}

export function getExtension(filePath) {
  const name = filePath.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

export function detectLanguage(filePath) {
  const extension = getExtension(filePath);
  return languageByExtension.get(extension) || 'text';
}

export function classifyKind(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes('/test/') || lower.includes('/tests/') || /\.(test|spec)\.[jt]sx?$/.test(lower)) return 'test';
  if (lower.endsWith('readme.md') || lower.includes('/docs/') || lower.includes('/doc/')) return 'doc';
  if (lower.includes('/routes/') || lower.includes('/api/')) return 'api';
  if (lower.includes('package.json') || lower.includes('requirements.txt') || lower.includes('dockerfile')) return 'config';
  return 'source';
}

function fileBudget(filePath, extension, kind) {
  const lower = filePath.toLowerCase();

  if (sourceExtensions.has(extension)) return numberEnv('MAX_SOURCE_FILE_BYTES', 600000);
  if (kind === 'test') return numberEnv('MAX_TEST_FILE_BYTES', 450000);
  if (docExtensions.has(extension)) return numberEnv('MAX_DOC_FILE_BYTES', 300000);
  if (lower.endsWith('package.json')) return numberEnv('MAX_MANIFEST_FILE_BYTES', 250000);
  if (configExtensions.has(extension)) return numberEnv('MAX_CONFIG_FILE_BYTES', 140000);
  if (extension === '.sql') return numberEnv('MAX_SCHEMA_FILE_BYTES', 350000);

  return numberEnv('MAX_FILE_BYTES', 400000);
}

export function getFileIndexDecision(filePath, byteLength) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const extension = getExtension(normalized);
  const kind = classifyKind(normalized);
  const maxBytes = fileBudget(normalized, extension, kind);
  const language = detectLanguage(normalized);

  if (parts.some((part) => ignoredDirs.has(part))) {
    return { index: false, reason: 'ignored-directory', maxBytes, byteLength, kind, language };
  }

  if (ignoredExtensions.has(extension)) {
    return { index: false, reason: 'ignored-extension', maxBytes, byteLength, kind, language };
  }

  if (alwaysSkipPatterns.some((pattern) => pattern.test(normalized))) {
    return { index: false, reason: 'generated-or-low-value', maxBytes, byteLength, kind, language };
  }

  const recognized =
    languageByExtension.has(extension) ||
    /(^|\/)(readme|license|dockerfile|makefile|requirements\.txt|\.gitignore|\.gitattributes)$/i.test(normalized);

  if (!recognized) {
    return { index: false, reason: 'unsupported-file-type', maxBytes, byteLength, kind, language: 'text' };
  }

  if (byteLength > maxBytes) {
    return { index: false, reason: 'too-large', maxBytes, byteLength, kind, language };
  }

  return { index: true, reason: 'included', maxBytes, byteLength, kind, language };
}

export function shouldIndexFile(filePath, byteLength) {
  return getFileIndexDecision(filePath, byteLength).index;
}

export function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}
