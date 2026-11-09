# 接口约定

前缀/api/v1，JSON。成功为data字段；列表附meta。错误为error对象，含code和message。

## 已实现

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | /health | status、mode=skeleton、version |
| GET | /catalog | businesses、versions、attributes，版本为空 |
| GET | /forms/templates | 空data数组；meta.total=0、implementation=skeleton |
| GET | /forms/records | 空data数组；meta.total=0、implementation=skeleton |

列表未连接数据库，不提供筛选。未知接口404，非GET操作405，不伪造成功。

## 后续契约草案，尚未实现

客户字段：company_name、install_address、billing_address、contact_name、phone、id_number、email、payment_method（cash/collection）、bank_account、bank_name。

匹配字段：business_id、business_version_id、business_attribute、voice_required、package_request（原始套餐描述）、tariff_id。金额采用精确表示；手机号、身份证、银行账号保留字符串。正式字段需双方确认。

匹配返回：status（unique/ambiguous/not_found/conflict）、candidates（套餐ID、模板ID及版本、名称、依据）、missing_fields、conflicts。

生成记录保留业务分类、模板版本快照、created_by、created_at、status。写入接口必须服务端认证和授权，不能仅隐藏页面按钮。

接口变更先更新本文档，再同步双方模块。

## Issue #1 本地联调接口

显式启动表单联调模式才开放以下接口，数据仅用于虚构样例。/catalog 增加测试版本。GET /forms/mode 返回 preview 标记。其余联调接口使用启动终端发放的临时 Bearer 口令，身份和角色由服务端解析。

| 方法 | 相对 /api/v1/forms 的路径 | 用途 |
| --- | --- | --- |
| GET | /workspace | 身份、角色、虚构资费、字段字典 |
| POST | /match | 传 selection，按套餐及完整元数据查候选、依据和额外字段 |
| POST | /generate | 传 selection、match_token（匹配时返回）、template_id、customer、request_id（UUID），服务端复核后生成历史记录 |
| GET | /records、/records/{id}/file | 当前员工的记录及其 Word 文件 |
| GET | /templates、/templates/{id}/file | 管理员查看模板目录、下载当前版模板 |
| POST | /templates | 管理员上传受限 DOCX，传 name、revision、tariff_id、mapping（占位符→字段）、file（Base64）。新版本默认停用 |
| PATCH | /templates/{id} | 管理员传布尔值 active，切换启停 |

模板版本和上传内容不可覆盖。修改映射时上传新版本。重复生成请求按员工和 request_id 去重。生成记录保存分类、套餐、模板版本及文件快照。正式接口与权限待双方确认。

## 私有在线验收接口

`GET /forms/mode` 增加 `hosted: true`。平台验证当前登录者后，`POST /forms/test-session` 接受 `account`（见在线界面的模拟身份），在该登录者的独立验收空间签发 8 小时的临时会话。生成与历史记录按登录者和模拟员工共同隔离，模板管理另行校验管理员权限。

一般接口使用响应中的 Bearer 口令。两个 `GET .../{id}/file` 下载也可使用同一响应设置的 HttpOnly、Secure、SameSite=Strict Cookie。服务端复核文件归属或模板管理权限，返回可下载的 DOCX。测试账号及数据仅用于验收。

免登录 Demo 在浏览器内运行。`GET /forms/templates` 的 `custom` 标识自定义模板；管理员可对启用或停用的自定义模板调用 `DELETE /forms/templates/{id}`，内置样表禁止删除。删除不影响历史文件。
Demo 管理员可调用 `DELETE /forms/templates/samples` 批量清除当前浏览器的内置样表并停止自动创建。
Demo 模板列表返回 `imported_at`（UTC ISO 8601）；已有模板没有录入时间时为 `null`。

## 客户资料收集与虚构工商验收

表单页按商务专线的新装版本显示已核对的两段客户话术。回复识别、缺项回复与员工内部估算在当前页面完成，不发送原始回复或调用外部企业接口。企查查配置暂缓。测试套餐 A/B 保留既有模板，测试套餐 C 增加工商栏，语音测试套餐新增四项实名字段。两者均复用现有匹配、生成和个人下载接口。带语音模板上传及生成要求四项实名映射，格式异常的证件号阻止生成。

### 浏览器演示：已核验原表
模板管理沿用 `POST /forms/templates/inspect` 和 `POST /forms/templates/import`，已核验原表的检查结果为 `reviewed: true`，包含名称、版本和资费列表。导入创建一条默认停用的模板记录。匹配候选附带 `reviewed_controls`，担保书只提交担保资料；生成仍使用 `POST /forms/generate`，结果中的 `review` 提示手工核对事项。这些扩展只在浏览器演示中启用。

### 工作看板
联调模式的 `GET /forms/dashboard` 返回 `scope`（team / self）、员工统计和生成记录。只有管理员能读取本工作区全部账号的记录，员工仅能读取自己的记录。报价还没有业务记录，`quote_count` 返回 null。成功生成一次计一次，幂等重试不重复计数。
`GET /forms/dashboard/records/{id}/file` 按相同权限提供 Word 文件；个人历史接口仍只返回本人的记录。静态 Demo 的身份切换用于虚构数据验收，数据仅存于当前浏览器。

看板默认本周（周一至周日，上海时间）。查询可传 `period=week|month|all|custom`，周/月可传 `offset`（0 表示本期、1 表示上一期），自定义日期传 `from`、`to`（YYYY-MM-DD，含结束日）。响应的 `range` 返回实际统计区间。列表与汇总使用同一区间，打开明细文件仍按账号权限核验。

表单生成页按业务种类、业务名称、业务属性、语音及折扣选条件；如需确认多个版式或付费周期，再单独选择。请求仍带已核对的内部资费编号。新增可选的 `discount_mode`（yes/no）和打折时的 `discount_factor`（如 8.5）。模板有核验折数时拒绝不一致的选项；无核验折数时，记录员工输入并提示在 Word 中人工核对，系统不计算折后资费。
