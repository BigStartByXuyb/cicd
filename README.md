# BigStart CI/CD

This repository hosts reusable GitHub Actions workflows for multiple projects.

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

The marketplace repository calls:

```text
BigStartByXuyb/cicd/.github/workflows/plugin-marketplace.yml@v2
```

Plugin source code stays in the marketplace repository. This repository only checks out the caller repository temporarily during a run; it does not store submitted plugins.
