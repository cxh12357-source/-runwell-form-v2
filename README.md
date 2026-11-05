# 润网业务系统 V2

业务报价 → 表单填写 → 手续审核。

当前为可运行骨架：报价和审核提供占位入口；表单填写包含表单生成、历史记录、套餐模板管理。客户字段禁用，仅供布局预览。尚未连接数据库或实现登录、保存、上传、模板匹配、Word生成和审核。

## 本地运行

需要 Node.js 22+，无第三方依赖，无需安装包。

```powershell
node backend/server.mjs
```

浏览器访问 http://127.0.0.1:3000 ，Ctrl+C停止。端口冲突时先设置 `$env:PORT=3001`。仅监听本机，不用于生产。

```powershell
node --test tests/*.test.mjs
```

如已安装npm，可使用npm run dev和npm test。

## 目录

- frontend/app.js：路由与导航。
- frontend/modules/：工作台与表单页面。
- frontend/lib/：公共请求、转义工具。
- backend/app.mjs、server.mjs：应用及启动入口。
- backend/modules/：分类、表单、报价、审核模块。
- docs/：范围、接口和双人协作约定。
- tests/：隔离检查。

本地Node.js服务用于预览与接口骨架，正式后端、数据库和Word引擎待确认。旧项目和数据未迁移，未部署。
