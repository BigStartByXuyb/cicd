# GitHub Organization Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared plugin CI/CD workflow consume five explicitly passed Organization Secrets so every team plugin repository can use one centrally maintained implementation without storing credential values in source repositories.

**Architecture:** The central `cicd` repository declares a strict `workflow_call.secrets` contract. Each caller repository passes exactly those five secret names from Organization Secret context. The called workflow removes job-level Environment Secret dependencies; Feishu routing and deterministic/semantic audit behavior remain unchanged.

**Tech Stack:** GitHub Actions YAML, Node.js 22, Node built-in test runner, PowerShell, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-09-08-github-organization-secrets-design.md`

## Global Constraints

- Secret values never enter source files, artifacts, comments, or logs.
- The caller passes exactly five named secrets; do not use `secrets: inherit`.
- The called workflow must not use job-level `environment` for credential access.
- The caller keeps the reusable workflow reference and `ci_ref` pinned to an immutable commit SHA.
- Deterministic validation remains before the DeepSeek semantic audit.
- Feishu notification keeps both default group delivery and mapped direct delivery.

---

### Task 1: Add and verify the strict secret contract

**Files:**
- Modify: `cicd-worktree/.github/workflows/plugin-marketplace.yml`
- Modify: `plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml`
- Create: `cicd-worktree/projects/plugin-marketplace/scripts/ci/workflow-contract.test.mjs`

**Interfaces:**
- Produces: central workflow `on.workflow_call.secrets` entries for `ANTHROPIC_API_KEY`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_DEFAULT_CHAT_ID`, and `FEISHU_RECIPIENT_MAP_JSON`.
- Produces: caller `jobs.plugin-ci.secrets` mapping with exactly the same five keys.

- [ ] **Step 1: Write the failing contract test**

Create `workflow-contract.test.mjs` that reads both YAML files as text and asserts. The test is run with the central worktree as the current directory, so the sibling caller worktree path is deterministic:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const central = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/plugin-marketplace.yml'), 'utf8');
const caller = fs.readFileSync(path.resolve(process.cwd(), '..', 'plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml'), 'utf8');
const names = ['ANTHROPIC_API_KEY', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DEFAULT_CHAT_ID', 'FEISHU_RECIPIENT_MAP_JSON'];

test('central workflow declares every required workflow-call secret', () => {
  for (const name of names) {
    assert.match(central, new RegExp(`^\\s{8}${name}:\\s*$`, 'm'));
  }
  assert.doesNotMatch(central, /environment:\s*plugin-cicd-prod/);
});

test('caller passes exactly the required secret names', () => {
  const block = caller.match(/\n\s+secrets:\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? '';
  const actual = [...block.matchAll(/^\s{6}([A-Z0-9_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(actual, names);
  assert.doesNotMatch(caller, /secrets:\s*inherit/);
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing contract**

Run from `D:\MasterGo_WPF_Codex\cicd-worktree`:

```powershell
node --test projects/plugin-marketplace/scripts/ci/workflow-contract.test.mjs
```

Expected: FAIL because the central workflow currently has no `workflow_call.secrets` block and the caller has no `secrets` mapping.

- [ ] **Step 3: Declare explicit secrets in the central workflow**

Under `on.workflow_call`, add:

```yaml
    secrets:
      ANTHROPIC_API_KEY:
        required: true
      FEISHU_APP_ID:
        required: true
      FEISHU_APP_SECRET:
        required: true
      FEISHU_DEFAULT_CHAT_ID:
        required: true
      FEISHU_RECIPIENT_MAP_JSON:
        required: true
```

Remove `environment: plugin-cicd-prod` from the `semantic-audit` and `notify-feishu` jobs. Keep the existing `secrets.NAME` references in steps; they now resolve from the caller-provided contract.

- [ ] **Step 4: Pass exactly five secrets from the caller**

Add the following `secrets` mapping under `jobs.plugin-ci` in the caller workflow. Keep the existing immutable SHA and `ci_ref` unchanged until the central release is committed:

```yaml
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      FEISHU_APP_ID: ${{ secrets.FEISHU_APP_ID }}
      FEISHU_APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
      FEISHU_DEFAULT_CHAT_ID: ${{ secrets.FEISHU_DEFAULT_CHAT_ID }}
      FEISHU_RECIPIENT_MAP_JSON: ${{ secrets.FEISHU_RECIPIENT_MAP_JSON }}
```

The final caller path must use the team Organization slug selected during migration; no credential value is added to the file.

- [ ] **Step 5: Run the contract test and verify it passes**

Run the same `node --test` command. Expected: PASS for both tests.

- [ ] **Step 6: Commit the contract change**

```powershell
git add .github/workflows/plugin-marketplace.yml projects/plugin-marketplace/scripts/ci/workflow-contract.test.mjs
git commit -m "feat: pass organization secrets to reusable workflow"
```

### Task 2: Document organization migration and caller setup

**Files:**
- Modify: `cicd-worktree/README.md`
- Modify: `cicd-worktree/projects/plugin-marketplace/docs/plugin-marketplace-github-cicd-design.md`
- Modify: `plugin-marketplace-worktree/docs/plugin-cicd-consumer.md`

**Interfaces:**
- Produces: one consistent setup path that identifies the Organization as the Secret owner and the caller workflow as a names-only adapter.

- [ ] **Step 1: Add the migration explanation to the central README**

Document that reusable workflows execute in the caller repository context, that Organization Secrets must be allow-listed to plugin repositories, and that central-repository Environment Secrets are not the runtime source for this contract.

- [ ] **Step 2: Update the GitHub design document**

Replace personal-repository Environment Secret instructions with the Organization migration sequence from the approved spec. Include the exact five names and explain that `FEISHU_RECIPIENT_MAP_JSON` maps GitHub login to Feishu `open_id` while `FEISHU_DEFAULT_CHAT_ID` targets the maintenance group.

- [ ] **Step 3: Update the caller consumer document**

Show the thin caller workflow with explicit secret names, immutable central SHA pinning, and the requirement that the caller repository belongs to the same Organization as `cicd`. State that no secret values or full CI implementation are committed to the caller.

- [ ] **Step 4: Run documentation consistency checks**

```powershell
rg -n "plugin-cicd-prod|Environment Secrets|Organization Secrets|secrets: inherit|workflow_call" README.md projects/plugin-marketplace/docs
git diff --check
```

### Task 3: Validate, release, and update the pinned caller

**Files:**
- Modify: `plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml` after the central commit is released

**Interfaces:**
- Consumes: central commit produced by Task 1.
- Produces: caller pinned to the new immutable central SHA.

- [ ] **Step 1: Run all central tests before release**

```powershell
node --test projects/plugin-marketplace/scripts/ci/lib/*.test.mjs projects/plugin-marketplace/scripts/ci/validate-marketplace.test.mjs projects/plugin-marketplace/scripts/ci/collect-changed-plugins.test.mjs projects/plugin-marketplace/scripts/ci/workflow-contract.test.mjs
Get-ChildItem projects/plugin-marketplace/scripts/ci -Recurse -Filter *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Expected: all tests pass, all Node checks pass, and no diff-check output.

- [ ] **Step 2: Push the central commit and resolve its immutable SHA**

```powershell
git push origin main
$centralSha = git rev-parse HEAD
```

Record the full 40-character SHA; it is the only value used for both the caller `uses` reference and `ci_ref`.

- [ ] **Step 3: Update the caller to the released central SHA and Organization slug**

Modify `plugin-marketplace-worktree/.github/workflows/plugin-cicd.yml` so both references use `$centralSha` and the repository owner is the final team Organization. Keep the explicit five-secret mapping from Task 1.

- [ ] **Step 4: Validate the caller and commit it**

```powershell
git -C ..\plugin-marketplace-worktree diff --check
git -C ..\plugin-marketplace-worktree add .github/workflows/plugin-cicd.yml docs/plugin-cicd-consumer.md
git -C ..\plugin-marketplace-worktree commit -m "feat: pass organization secrets to central ci"
git -C ..\plugin-marketplace-worktree push origin plugin-marketplace-layout
```

- [ ] **Step 5: Perform the integration check after Organization migration**

Open a test pull request in the caller repository after the repositories have been transferred and Organization Secret access has been allow-listed. Verify that deterministic validation, semantic audit, PR comment, and Feishu group notification all complete. Confirm logs contain no secret values.
