import { execFileSync } from 'node:child_process';

// Tag pushes (and the first push of a branch) report an all-zero `github.event.before`,
// which is not a real object: `git diff --name-only 0000… <head>` dies with
// "fatal: bad object 0000000000000000000000000000000000000000" and the whole job fails.
// Treat an all-zero or otherwise unresolvable base the same way: fall back to the head
// commit's parent, which is the change set a tag actually carries.
const NULL_SHA = /^0{40}$/;
const NULL_SHA_SHORT = /^0{7,39}$/;

export function isNullSha(value) {
  const sha = String(value ?? '').trim();
  return NULL_SHA.test(sha) || NULL_SHA_SHORT.test(sha);
}

export function runGit(gitRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', gitRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

export function resolveDiffRange(gitRoot, base, head) {
  const candidates = [];
  if (base && !isNullSha(base)) candidates.push([base, head, `${base}..${head}`]);
  candidates.push([`${head}~1`, head, `${head}~1..${head}`]);
  for (const [from, to, label] of candidates) {
    const resolvedFrom = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`], { allowFailure: true });
    if (resolvedFrom === null) continue;
    const resolvedTo = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', `${to}^{commit}`], { allowFailure: true });
    if (resolvedTo === null) continue;
    const fromSha = resolvedFrom.trim();
    const toSha = resolvedTo.trim();
    return { from, to, label: `${fromSha}..${toSha}`, fromSha, toSha };
  }
  return null;
}

// Changed file paths for the resolved range; empty when no range can be resolved
// (for example a repository whose head commit has no parent).
export function diffNameOnly(gitRoot, base, head) {
  const range = resolveDiffRange(gitRoot, base, head);
  if (!range) return [];
  const output = runGit(gitRoot, ['diff', '--name-only', range.from, range.to], { allowFailure: true });
  if (output === null) return [];
  return output.split(/\r?\n/).filter(Boolean);
}
