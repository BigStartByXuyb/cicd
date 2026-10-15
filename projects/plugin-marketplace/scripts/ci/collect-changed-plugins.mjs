import { diffNameOnly } from './lib/git-diff-range.mjs';

export function collectChangedPlugins(paths) {
  return [...new Set(paths
    .map((file) => file.replaceAll('\\', '/').match(/^plugins\/([^/]+)\/.+/)?.[1])
    .filter(Boolean))].sort();
}

if (process.argv[1]?.endsWith('collect-changed-plugins.mjs')) {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (!head) throw new Error('HEAD_SHA is required');
  // BASE_SHA is deliberately not required. Tag pushes report an all-zero
  // github.event.before, and `diffNameOnly` resolves that (and any other
  // unresolvable base) back to the head commit's parent.
  const changedFiles = diffNameOnly(process.cwd(), base, head);
  process.stdout.write(`${JSON.stringify(collectChangedPlugins(changedFiles))}\n`);
}
