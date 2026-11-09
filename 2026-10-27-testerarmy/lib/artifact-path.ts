import path from 'node:path';

const TYPES: Record<string, string> = { '.png': 'image/png', '.webm': 'video/webm', '.jpg': 'image/jpeg' };

/** Resolve a request path under baseDir; returns null if unsafe or unsupported type. */
export function resolveArtifact(baseDir: string, segments: string[]): { file: string; type: string } | null {
  if (segments.some((s) => s === '..' || s.includes('..') || s.includes('\\') || s.includes('\0'))) return null;
  const file = path.resolve(baseDir, ...segments);
  if (!file.startsWith(path.resolve(baseDir) + path.sep)) return null;
  const type = TYPES[path.extname(file).toLowerCase()];
  return type ? { file, type } : null;
}
