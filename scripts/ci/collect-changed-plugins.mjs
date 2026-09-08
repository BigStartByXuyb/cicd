import { execFileSync } from 'node:child_process';

export function collectChangedPlugins(paths) {
  return [...new Set(paths
    .map((file) => file.replaceAll('\\', '/').match(/^plugins\/([^/]+)\/.+/)?.[1])
    .filter(Boolean))].sort();
}

if (process.argv[1]?.endsWith('collect-changed-plugins.mjs')) {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required');
  const changedFiles = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  process.stdout.write(`${JSON.stringify(collectChangedPlugins(changedFiles))}\n`);
}
