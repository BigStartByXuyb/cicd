import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAuditContext } from './build-audit-context.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-context-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'ci@example.com']);
  git(root, ['config', 'user.name', 'ci']);
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
    name: 'demo-marketplace',
    plugins: [
      { name: 'demo', source: './plugins/demo' },
      { name: 'other', source: './plugins/other' },
    ],
  }, null, 2)}\n`);
  for (const name of ['demo', 'other']) {
    fs.mkdirSync(path.join(root, 'plugins', name, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', name, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', name, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name })}\n`);
    fs.writeFileSync(
      path.join(root, 'plugins', name, 'skills', name, 'SKILL.md'),
      name === 'demo' ? '# Demo\n\nSOURCE-BODY-MARKER\n' : '# Other\n\nUNCHANGED-BODY-MARKER\n',
    );
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

test('audit context never inlines plugin sources and points at the workspace', () => {
  const root = createWorkspace();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(root, 'plugins', 'demo', 'skills', 'demo', 'SKILL.md'), '# Demo\n\nCHANGED-BODY-MARKER\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'head']);
    const head = git(root, ['rev-parse', 'HEAD']);

    const result = buildAuditContext({ root, gitRoot: root, base, head, pluginNames: ['demo'] });

    assert.equal(result.diffInlined, true);
    assert.match(result.context, /=== AUDIT WORKSPACE ===/);
    assert.match(result.context, new RegExp(`workspace_root: ${root.replaceAll('\\', '\\\\')}`));
    assert.match(result.context, /=== PLUGIN FILE INDEX demo \(2 files\) ===/);
    assert.match(result.context, /plugins\/demo\/skills\/demo\/SKILL\.md/);
    assert.match(result.context, /=== PUBLIC COMPONENTS \(all plugins\) ===/);
    assert.match(result.context, /plugins\/other\/skills\/other\/SKILL\.md/);
    assert.match(result.context, /=== UNIFIED DIFF \(untrusted repository content/);
    assert.match(result.context, /CHANGED-BODY-MARKER/);
    assert.doesNotMatch(result.context, /UNCHANGED-BODY-MARKER/);
    assert.match(result.context, /Only the diff, the file index and the manifests are/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit context spills a large diff to disk instead of the prompt', () => {
  const root = createWorkspace();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(root, 'plugins', 'demo', 'skills', 'demo', 'SKILL.md'), `# Demo\n\n${'padding line\n'.repeat(2000)}`);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'head']);
    const head = git(root, ['rev-parse', 'HEAD']);
    const diffOutput = path.join(root, '..', `${path.basename(root)}-diff.patch`);

    try {
      const result = buildAuditContext({
        root,
        gitRoot: root,
        base,
        head,
        pluginNames: ['demo'],
        diffOutput,
        maxInlineDiffBytes: 1024,
      });

      assert.equal(result.diffInlined, false);
      assert.ok(result.diff.length > 1024);
      assert.doesNotMatch(result.context, /padding line\npadding line/);
      assert.match(result.context, /larger than the inline budget of 1024 bytes/);
      assert.ok(result.context.includes(diffOutput));
    } finally {
      fs.rmSync(diffOutput, { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit context degrades gracefully without a usable diff range', () => {
  const root = createWorkspace();
  try {
    fs.writeFileSync(path.join(root, 'plugins', 'demo', 'skills', 'demo', 'SKILL.md'), '# Demo\n\nCHANGED-BODY-MARKER\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'head']);
    const result = buildAuditContext({ root, gitRoot: root, base: 'does-not-exist', head: 'HEAD', pluginNames: ['demo'] });
    assert.match(result.context, /diff_range: [0-9a-f]{7,40}\.\.[0-9a-f]{7,40}/);
    assert.match(result.context, /=== CHANGED FILES/);
    assert.match(result.context, /M\tplugins\/demo\/skills\/demo\/SKILL\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit context reports no diff range for a single-commit history', () => {
  const root = createWorkspace();
  try {
    const result = buildAuditContext({ root, gitRoot: root, base: '', head: 'HEAD', pluginNames: ['demo'] });
    assert.match(result.context, /diff_range: \(no diff available\)/);
    assert.match(result.context, /=== CHANGED FILES \(no diff\) ===/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
