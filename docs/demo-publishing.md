# 共享演示网页自动发布

固定入口：https://runwell-demo.shipstatic.com/#/forms

## 两人的日常流程

各自在开发分支上传代码，创建合并申请，目标选 `feature/project-skeleton`。合并申请自动运行检查，不改变公共网页。任意一人的代码合并到该共享分支后，GitHub Actions 自动检查、构建展示包、发布并更新固定入口。刷新同一网址即可看到合并后的界面，无需保持本机或 Codex 开启。

发布通常需要几分钟，以仓库 Actions 中的 `Update shared demo` 结果为准。检查或构建失败时不发布，固定入口保留上一版。发布串行进行，防止旧任务覆盖新版本。

## 首次连接发布账号

1. 用拥有 `runwell-demo.shipstatic.com` 的 ShipStatic 账号打开 https://my.shipstatic.com/api-key ，复制已有 API key，不要重置它。
2. 打开仓库 Settings → Secrets and variables → Actions → New repository secret，名称填 `SHIP_TOKEN`，值填上述 API key，保存。不要把密钥发到聊天、提交、Issue 或截图。
3. 在 Actions 中重新运行失败的共享分支发布任务。成功后检查固定网址和 `/version.json` 的 commit 是否对应本次合并。

固定域名切换需要 API key；仅能上传的 deploy token 不支持域名切换。账号连接插件的凭据不会自动提供给 GitHub。

## 当前演示范围

构建命令：`node scripts/build-public-demo.mjs`，输出 `dist/demo`，版本信息写入 `version.json`。只发布明确列出的前端界面和源码自带虚构测试元数据，不打包整个仓库、运行数据库、后台代码或登录模块。

展示包使用 oneaskq 的生成界面、模板目录界面和分类联动函数，移除后台操作绑定；客户输入、匹配、生成、上传、下载和启停保持禁用。历史记录展示未连接数据库的空状态。无顶部大段展示说明。原本本机表单验收入口不受影响。

如果 oneaskq 改变界面模块的导出名称、依赖或渲染结构，需要同步调整展示构建脚本。构建会对缺少的依赖或业务请求报错并停止，禁止静默发布旧界面。正式模板、真实客户数据和完整服务器部署均不在当前展示发布范围。

## 维护与回退

自动发布配置位于 `.github/workflows/deploy-demo.yml`。只识别共同仓库的共享骨架分支，不自动合并开发分支或其他仓库。需要迁移共享分支时同步修改工作流和此文档。

回退请向共享分支提交 revert，再通过同一流程发布。不要重新运行旧提交来覆盖新版本。测试用临时数据库与生成文件会在检查后清理；不读旧项目资料。

官方说明：https://docs.shipstatic.com/action ，https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets 。
