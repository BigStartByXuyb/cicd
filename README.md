# BigStart CI/CD

This repository hosts reusable GitHub Actions workflows for multiple projects.

The reusable workflow supports two deployment modes. For the current personal
account pilot, the caller repository stores five repository-level Actions
Secrets and passes them explicitly through `workflow_call`. For team use,
both repositories can later move into one GitHub Organization and the same
names can be supplied as allow-listed Organization Secrets. Secret values
never live in this repository.

## Layout

```text
.github/workflows/                 # GitHub requires reusable workflows here
  plugin-marketplace.yml            # entry point for plugin marketplace
  desktop-app.yml                   # entry point for desktop/client apps
projects/
  plugin-marketplace/               # one complete CI/CD suite
    scripts/ci/
    docs/
  desktop-app/                      # Node backend + React frontend clients
    scripts/ci/
    docs/
shared/ci/                          # cross-suite utilities (Feishu send, PR comment)
```

The desktop-app suite gates unit tests, coverage thresholds, hardcoded machine paths, orphan
exports, layering, build-output consistency, and a DeepSeek-backed Claude semantic audit whose
contract lives in `projects/desktop-app/docs/app-semantic-audit.md`. Callers pin `ci_ref` to a
commit SHA so a change to the CI logic is always an explicit change on their side.

The marketplace repository currently calls:

```text
BigStartByXuyb/cicd/.github/workflows/plugin-marketplace.yml@d71a86e97e737f8bb48fc4f999cf1e52820bc598
```

After the repositories are transferred to the team Organization, replace the
owner in the caller workflow with that Organization slug and keep pinning a
reviewed commit SHA.

The reusable workflow requires these five Organization Secrets to be mapped
explicitly by the caller:

```text
ANTHROPIC_API_KEY
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_DEFAULT_CHAT_ID
FEISHU_RECIPIENT_MAP_JSON
```

For the personal pilot, configure the five names in the caller repository
(`BigStartByXuyb/test`) under Settings → Secrets and variables → Actions →
Repository secrets. The old Environment `plugin-cicd-prod` in `cicd` is not a
runtime source for a reusable workflow called by another repository. It may
be kept temporarily, but it must not be treated as the caller's configuration.

Plugin source code stays in the marketplace repository. This repository only checks out the caller repository temporarily during a run; it does not store submitted plugins.
