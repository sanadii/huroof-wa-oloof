import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const extensions = new Set(['.ts', '.tsx', '.css']);
const forbidden = [
  /#[0-9a-f]{3,8}\b/i,
  /\brgb(?:a)?\s*\(/i,
  /\b(?:yellow|amber|gold|violet|indigo)\b/i,
  /\b(?:linear|radial|conic)-gradient\s*\(/i,
];
const allowedShadows = new Set(['var(--focus-ring)', 'var(--shadow-raised)', 'var(--shadow-panel)', 'var(--shadow-control)', 'var(--spatial-board-shadow)', 'var(--spatial-dock-shadow)', 'var(--arena-stage-shadow)', 'var(--arena-panel-shadow)', 'var(--arena-score-shadow)', 'var(--shadow-action-focus)', 'var(--shadow-elevated)', 'var(--shadow-compact)', 'var(--shadow-stage)', 'var(--shadow-team-focus)', 'var(--shadow-team-outline)', 'var(--shadow-board-ring)', 'var(--shadow-board-ring-strong)', 'var(--shadow-board-path)', 'var(--shadow-nav-active)', 'none']);
const allowedRadii = new Set(['var(--radius-none)', 'var(--spatial-radius-control)', 'var(--spatial-radius-dock)', 'var(--arena-radius-panel)', 'var(--arena-radius-capsule)', '0', 'inherit', '50%', 'var(--space-1)', 'calc(var(--spatial-radius-control) - var(--space-1))']);
const qrEncoderPath = 'src/routes/GameRoutes.tsx';
const qrEncoderColors = 'color: { dark: "#071d38", light: "#ffffffff" }';

async function filesAt(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) return filesAt(target);
    return extensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [target] : [];
  }));
  return nested.flat();
}

/**
 * Structural-only validation. Canonical palette declarations belong in
 * design/tokens.css; this scan deliberately rejects raw literals in src/.
 */
export async function scanVisualContract(projectRoot = process.cwd()): Promise<string[]> {
  const sourceRoot = join(projectRoot, 'src');
  const failures: string[] = [];
  for (const file of await filesAt(sourceRoot)) {
    const content = await readFile(file, 'utf8');
    const pathFromRoot = relative(projectRoot, file).replaceAll('\\', '/');
    // qrcode accepts encoded bitmap colors rather than CSS custom properties.
    // This exception is deliberately bound to its one production call and values.
    const structural = pathFromRoot === qrEncoderPath
      ? content.replace(qrEncoderColors, '')
      : content;
    for (const pattern of forbidden) {
      if (pattern.test(structural)) failures.push(`${pathFromRoot}: ${pattern}`);
    }
    for (const match of content.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      if (!allowedShadows.has(match[1].trim())) failures.push(`${pathFromRoot}: non-tokenized box-shadow`);
    }
    for (const match of content.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
      if (!allowedRadii.has(match[1].trim())) failures.push(`${pathFromRoot}: non-authorized border radius`);
    }
    for (const match of content.matchAll(/stopColor=(?:\{([^}]+)\}|"([^"]+)")/g)) {
      const value = match[1] ?? match[2] ?? '';
      if (!/^var\(--(?:arena|material)-[\w-]+\)$/.test(value.trim()))
        failures.push(`${pathFromRoot}: non-token SVG gradient stop`);
    }
  }
  return failures;
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/scan-visual-contract.ts');
if (invoked) {
  const failures = await scanVisualContract();
  if (failures.length) {
    console.error('Visual contract scan failed:\n' + failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Visual contract scan completed: src/ uses no prohibited palette literals, non-tokenized shadows, or unauthorized radii; tactile tokenized SVG gradients are structurally permitted by approved 0007. This is structural evidence only, not aesthetic approval.');
  }
}
