# BigStart CI/CD

This repository hosts reusable GitHub Actions workflows for multiple projects.

The reusable workflow is intended to be consumed by repositories in the same
GitHub Organization. Organization-level Actions Secrets are allow-listed to
each caller repository and passed explicitly through `workflow_call`; secret
values never live in this repository or in a caller repository.

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
BigStartByXuyb/cicd/.github/workflows/plugin-marketplace.yml@8dbe3ebeb4ff82bf57f66b732eaeccfaab5531a8
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

The old personal-repository Environment `plugin-cicd-prod` is not a runtime
source for a reusable workflow called by another repository. It may be kept
temporarily during migration, but it must not be treated as the shared team
configuration.

Plugin source code stays in the marketplace repository. This repository only checks out the caller repository temporarily during a run; it does not store submitted plugins.
