# GitHub Organization Secrets for Shared Plugin CI/CD

## Status

Approved design for the team rollout of the shared plugin marketplace CI/CD.

## Goal

Allow every plugin repository in the team to use one centrally maintained CI/CD implementation while keeping DeepSeek and Feishu credentials outside source repositories and available to the reusable workflow at runtime.

## Problem and constraint

The current `cicd` repository contains a reusable workflow. GitHub executes a reusable workflow in the caller repository's workflow context. An `environment` referenced by a job in the called workflow therefore resolves to the caller repository, so Environment Secrets stored only in `cicd` are not visible to a caller such as `test`.

The team also requires:

- plugin repositories contain only a thin caller workflow;
- submitted plugin content remains in the caller repository;
- the CI implementation and audit prompt remain centrally maintained;
- credentials are not committed to any repository;
- one organization-wide credential set can be restricted to approved repositories;
- deterministic validation runs before the DeepSeek semantic audit;
- Feishu receives the result in the maintenance group and, when mapped, directly to users.

## Selected architecture

Both `cicd` and each plugin marketplace repository will belong to the same GitHub Organization.

```text
GitHub Organization
├── cicd
│   ├── .github/workflows/plugin-marketplace.yml
│   └── projects/plugin-marketplace/...
├── plugin-marketplace (caller repository)
└── Organization Actions Secrets
    ├── ANTHROPIC_API_KEY
    ├── FEISHU_APP_ID
    ├── FEISHU_APP_SECRET
    ├── FEISHU_DEFAULT_CHAT_ID
    └── FEISHU_RECIPIENT_MAP_JSON
```

The Organization Secret access policy will be limited to the plugin repositories that are approved to run this workflow. The caller workflow passes only the five named secrets to the reusable workflow; it does not use `secrets: inherit`, which would pass every available secret.

## Workflow contract

The reusable workflow declares the five secrets under `on.workflow_call.secrets`, with each secret required. The caller maps each of the five names from its Organization Secret context to the same name in the called workflow. The `uses` reference and `ci_ref` are release-time constants: the caller uses the final team Organization slug and the immutable SHA of the approved central commit. No organization name or SHA is stored as a secret or inferred at runtime.

The called workflow removes job-level `environment` references for credential access. Secrets arrive through the explicit `workflow_call` contract. Pull request review and branch protection remain the approval boundary; organization secret access is restricted by repository policy.

## Feishu routing

`FEISHU_DEFAULT_CHAT_ID` is the maintenance group created for Plugin CI/CD. `FEISHU_RECIPIENT_MAP_JSON` maps GitHub logins to Feishu `open_id` values. The notification implementation always includes the default group and additionally sends direct messages to mapped submitters and requested reviewers. An unmapped user is reported in the Markdown message and does not fail the run.

## Migration

1. Create or select the team GitHub Organization.
2. Transfer `cicd` and the plugin marketplace repository into that Organization.
3. Create Organization Actions Secrets with repository access limited to the plugin repositories.
4. Add the explicit secret contract to each thin caller workflow.
5. Verify the reusable workflow can read the secrets in a test pull request.
6. Remove obsolete personal-repository Environment Secrets only after the test succeeds.

The caller workflow continues to pin both the reusable workflow reference and `ci_ref` to the same immutable commit SHA. A central implementation change requires a new commit and a caller update.

## Security boundaries

- Secret values are never written to source files, artifacts, comments, or logs.
- The caller passes secret names only; the values remain managed by GitHub Actions.
- Organization Secret repository access is allow-listed.
- `pull_request_target` materializes the PR head as read-only input and never executes code from the submitted tree.
- Deterministic validation fails closed before a secret-backed semantic audit runs.
- The Feishu App Secret and DeepSeek key must be rotated if exposed in chat or logs.

## Failure behavior

- Missing required workflow-call secrets prevents the semantic and notification jobs from starting and is visible as a configuration failure.
- Deterministic validation failure skips the semantic audit but still publishes the structured PR result and attempts the configured Feishu notification.
- A missing Feishu user mapping falls back to the default maintenance group and is included in the report.

## Verification

The implementation must include:

- YAML parsing for the central workflow and caller workflow;
- a test that the called workflow declares all five required secrets;
- a test that the caller passes exactly those five secret names;
- existing deterministic validator, changed-plugin collector, audit-report, and Feishu notification tests;
- `node --check` for every CI script;
- `git diff --check` for both repositories.

No test may print a secret value. A real GitHub Actions pull request run is the final integration check after the Organization migration and Secret access policy are configured.
