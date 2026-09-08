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
projects/
  plugin-marketplace/               # one complete CI/CD suite
    scripts/ci/
    docs/
shared/                             # future cross-project utilities
```

The marketplace repository currently calls:

```text
BigStartByXuyb/cicd/.github/workflows/plugin-marketplace.yml@392dcb1edf474392221f04fd88e47a64af80576b
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
