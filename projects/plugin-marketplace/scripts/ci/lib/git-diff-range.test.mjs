import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isNullSha, resolveDiffRange, diffNameOnly, runGit } from './git-diff-range.mjs';

const ZERO_SHA = '0'.repeat(40);

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeRepo(commits) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-diff-range-'));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'ci@example.com']);
  git(repo, ['config', 'user.name', 'CI']);
  for (const [file, content] of commits) {
    const absolute = path.join(repo, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '-m', `add ${file}`]);
  }
  return repo;
}

test('recognizes the all-zero sha used by tag pushes', () => {
  assert.equal(isNullSha(ZERO_SHA), true);
  assert.equal(isNullSha('0'.repeat(7)), true);
  assert.equal(isNullSha('5608dc4fc621014d629d71985a29d9e5f3a8a690'), false);
  assert.equal(isNullSha(''), false);
  assert.equal(isNullSha(undefined), false);
});

test('raw git diff against the all-zero sha is the failure this module exists for', () => {
  const repo = makeRepo([['plugins/demo/a.txt', '1'], ['plugins/demo/b.txt', '2']]);
  // Documents the pre-fix behavior: a tag push handed BASE_SHA = 0000… and the job died
  // with `fatal: bad object 0000000000000000000000000000000000000000`.
  assert.equal(runGit(repo, ['diff', '--name-only', ZERO_SHA, 'HEAD'], { allowFailure: true }), null);
});

test('falls back to head~1 when the base is the all-zero tag-push sha', () => {
  const repo = makeRepo([['plugins/demo/a.txt', '1'], ['plugins/demo/b.txt', '2']]);
  const range = resolveDiffRange(repo, ZERO_SHA, 'HEAD');
  assert.ok(range, 'expected the all-zero base to fall back to a resolvable range');
  assert.equal(range.from, 'HEAD~1');
  assert.deepEqual(diffNameOnly(repo, ZERO_SHA, 'HEAD'), ['plugins/demo/b.txt']);
});

test('falls back to head~1 when the base is missing entirely', () => {
  const repo = makeRepo([['plugins/demo/a.txt', '1'], ['plugins/demo/b.txt', '2']]);
  assert.deepEqual(diffNameOnly(repo, undefined, 'HEAD'), ['plugins/demo/b.txt']);
  assert.deepEqual(diffNameOnly(repo, '', 'HEAD'), ['plugins/demo/b.txt']);
});

test('uses the caller-provided base whenever it resolves', () => {
  const repo = makeRepo([
    ['plugins/alpha/a.txt', '1'],
    ['plugins/beta/b.txt', '2'],
    ['plugins/gamma/c.txt', '3'],
  ]);
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  const base = git(repo, ['rev-parse', 'HEAD~2']).trim();
  // The full range must win over the head~1 fallback.
  assert.deepEqual(diffNameOnly(repo, base, head), [
    'plugins/beta/b.txt',
    'plugins/gamma/c.txt',
  ]);
});

test('returns an empty change set when no range can be resolved', () => {
  const repo = makeRepo([['plugins/demo/a.txt', '1']]);
  assert.equal(resolveDiffRange(repo, '', 'HEAD'), null);
  assert.deepEqual(diffNameOnly(repo, ZERO_SHA, 'HEAD'), []);
});
