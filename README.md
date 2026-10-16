# MW 插件系统 CI/CD

MW 插件系统共享流水线仓库，包含插件市场与桌面客户端的 GitLab CI 模板、GitHub Actions 工作流和校验脚本。

## GitLab CI

调用仓库在根目录 `.gitlab-ci.yml` 中引用本仓库模板：

- `templates/common.yml` 提供阶段、触发规则和共享设置。
- `templates/plugin-marketplace.yml` 为插件市场提供检查、测试、审计、报告和通知任务。
- `templates/desktop-app.yml` 为桌面客户端提供检查、构建、测试、审计、报告和通知任务。

调用仓库需要在三个位置固定同一个已审核的提交：两个 `include` 项的 `ref` 和 `CI_IMPL_REF`。共享流水线以 Linux Docker Runner 为运行环境。

调用项目的 `CI_JOB_TOKEN` 必须获准读取本仓库。插件市场变量作用域为 `plugin-cicd`，桌面客户端变量作用域为 `app-cicd`。调用项目还需配置以下流水线变量：`ANTHROPIC_API_KEY`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DEFAULT_CHAT_ID`、`FEISHU_RECIPIENT_MAP_JSON` 和 `GITLAB_API_TOKEN`。密钥值不存放在仓库中。

## GitHub Actions

`.github/workflows/` 保留插件市场和桌面客户端的 GitHub Actions 入口；套件实现位于 `projects/`，共用实现位于 `shared/`。

## 目录

- `templates/`：GitLab 调用模板。
- `projects/plugin-marketplace/`：插件市场流水线实现、校验规则和说明。
- `projects/desktop-app/`：桌面客户端流水线实现、校验规则和说明。
- `shared/`：两套流水线共用的报告和通知实现。
