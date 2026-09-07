import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'src');
const extensions = new Set(['.ts', '.tsx', '.css']);
const forbidden = [
  /#[0-9a-f]{3,8}\b/i,
  /\brgb(?:a)?\s*\(/i,
  /\b(?:yellow|amber|gold|violet|indigo)\b/i,
  /(?:linear|radial|conic)-gradient/i,
];
const allowedShadows = new Set(['var(--focus-ring)', 'var(--shadow-raised)', 'var(--shadow-panel)', 'var(--shadow-control)', 'var(--spatial-board-shadow)', 'var(--spatial-dock-shadow)', 'var(--arena-stage-shadow)', 'var(--arena-panel-shadow)', 'var(--arena-score-shadow)']);
const allowedRadii = new Set(['var(--radius-none)', 'var(--spatial-radius-control)', 'var(--spatial-radius-dock)', 'var(--arena-radius-panel)', 'var(--arena-radius-capsule)']);

async function filesAt(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) return filesAt(target);
    return extensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [target] : [];
  }));
  return nested.flat();
}

const failures: string[] = [];
for (const file of await filesAt(sourceRoot)) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) failures.push(`${file}: ${pattern}`);
  }
  for (const match of content.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
    if (!allowedShadows.has(match[1].trim())) failures.push(`${file}: non-tokenized box-shadow`);
  }
  for (const match of content.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
    if (!allowedRadii.has(match[1].trim())) failures.push(`${file}: non-authorized border radius`);
  }
  const svgGradients = [...content.matchAll(/<linearGradient\b/g)].length;
  if (svgGradients) failures.push(`${file}: SVG gradients are prohibited by the flat gameplay contract`);
  for (const match of content.matchAll(/stopColor=\{([^}]+)\}/g)) {
    if (!match[1].includes('var(--material-')) failures.push(`${file}: non-token SVG gradient stop`);
  }
}

if (failures.length) {
  console.error('Visual contract scan failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Visual contract scan completed: src/ uses no prohibited palette literals, raw gradients, non-tokenized shadows, or unauthorized radii. This is structural evidence only, not aesthetic approval.');
}
