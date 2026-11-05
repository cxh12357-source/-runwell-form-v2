# 共享演示网页自动发布

固定入口：https://runwell-demo.shipstatic.com/#/forms

## 两人的日常流程

各自在开发分支上传代码，创建合并申请，目标选 `feature/project-skeleton`。合并申请自动运行检查，不改变公共网页。任意一人的代码合并到该共享分支后，GitHub Actions 自动检查、构建演示包、发布并更新固定入口。刷新同一网址即可看到合并后的界面，无需保持本机或 Codex 开启。

发布通常需要几分钟，以仓库 Actions 中的 `Update shared demo` 结果为准。检查或构建失败时不发布，固定入口保留上一版。发布串行进行，防止旧任务覆盖新版本。

## 首次连接发布账号

1. 用拥有 `runwell-demo.shipstatic.com` 的 ShipStatic 账号打开 https://my.shipstatic.com/api-key ，复制已有 API key，不要重置它。
2. 打开仓库 Settings → Secrets and variables → Actions → New repository secret，名称填 `SHIP_TOKEN`，值填上述 API key，保存。不要把密钥发到聊天、提交、Issue 或截图。
3. 在 Actions 中重新运行失败的共享分支发布任务。成功后检查固定网址和 `/version.json` 的 commit 是否对应本次合并。

固定域名切换需要 API key；仅能上传的 deploy token 不支持域名切换。账号连接插件的凭据不会自动提供给 GitHub。

## 当前演示范围

固定 Demo 打开即用。表单填写支持识别客户回复、补齐必填、匹配测试套餐模板、生成和下载 Word、查询历史、导入兼容 DOCX 模板及启停。实际字段和必填条件以表单模块及所选样表为准。报价和审核仍只保留入口。

在「套餐模板管理 → 智能导入 Word」拖入智云上海专线基础版（FTTR-B）不带语音原表或已转换模板（支持 5 月版和 10 月 21 日版，按版式分别入库）。页面列出识别到的月付、年付和两年付资费；选定一档后同时保存套餐和模板，同档重复导入不会覆盖原记录。新模板默认停用，核对后在目录启用。模板保留原版式和空框，生成时按所选资费与客户选项涂黑对应方框。其他版式无法确认字段位置时会拒绝导入，可使用原有手动上传入口。

只使用虚构客户和测试模板。录入内容、导入的模板和生成文档在浏览器内处理；模板、历史和文件保存在当前浏览器。不同设备和浏览器配置不共享，刷新后可继续使用，清除站点数据会删除本地记录。支持具备 IndexedDB、Web Locks 和 WebAssembly 的新版浏览器。

本地构建：`npm ci --prefix demo --ignore-scripts`，`node --test demo/runtime.test.mjs`，`node demo/build.mjs`。构建需要 Node 24 和 Python 3；输出 `dist/demo-interactive`，`version.json` 的模式为 `browser-demo`。用本机静态服务器打开产物进行验收；浏览器不可直接打开文件路径。旧只读构建保留供回退。

交互演示复用 oneaskq 的验收页面、匹配、校验与 Word 渲染代码。`demo/` 负责静态打包和本地存储；真实客户数据、正式模板和员工权限仍由正式系统管理。本机验收模式和私有托管模式不受影响。

## 维护与回退

自动发布配置位于 `.github/workflows/deploy-demo.yml`。只识别共同仓库的共享骨架分支，不自动合并开发分支或其他仓库。需要迁移共享分支时同步修改工作流和此文档。

回退请向共享分支提交 revert，再通过同一流程发布。不要重新运行旧提交来覆盖新版本。测试用临时数据库与生成文件会在检查后清理；不读旧项目资料。

官方说明：https://docs.shipstatic.com/action ，https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets 。
