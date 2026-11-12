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

匹配字段：business_id、business_version_id、business_attribute、voice_required、package_request（原始套餐描述）、tariff_id。金额采用精确表示；手机号、身份证、银行账号保留字符串。身份证号和 E-MAIL 为生成必填；付款方式为托收时银行账号和开户银行必填。有《网络及信息安全承诺书》的已核验套餐表单生成时须填写信息安全责任人姓名、职务及联系方式。正式字段需双方确认。

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

表单页按商务专线的新装版本显示已核对的两段客户话术。回复识别和缺项回复在当前页面完成，不发送原始回复或调用外部企业接口。企查查配置暂缓。参保人数仅保留已查到的参考值；企业规模默认 31–80 人、计算机数量默认 16–40 台，三项在页面隐藏，不根据参保人数估算。测试套餐 A/B 保留既有模板，测试套餐 C 增加工商栏，语音测试套餐新增四项实名字段。两者均复用现有匹配、生成和个人下载接口。带语音模板上传及生成要求四项实名映射，格式异常的证件号阻止生成。

### 浏览器演示：已核验原表
模板管理沿用 `POST /forms/templates/inspect` 和 `POST /forms/templates/import`，已核验原表的检查结果为 `reviewed: true`，包含名称、版本和资费列表。导入创建一条默认停用的模板记录。匹配候选附带 `reviewed_controls`，担保书只提交担保资料；生成仍使用 `POST /forms/generate`，结果中的 `review` 提示手工核对事项。这些扩展只在浏览器演示中启用。

页面默认账单地址与安装地址相同；另选不同地址时单独填写。对已核验套餐原表，页面提交 `choice_billing: "1"` 和实际 `billing_address`，生成器在 Word 的“其他”栏写入该地址，而不假定安装地址等于公司地址。安装邮编只从地址中的明确邮编标记提取，无法确认时留空；相同账单地址复用安装邮编，另选不同账单地址时仍可单独填写账单邮编。申请人职务、经办人职务、传真和申请日期不在页面填写，Word 对应栏留空。信息安全责任人的姓名、联系方式默认跟随经办人，其职务默认 `IT` 并可修改。业务用途默认为“办公上网”，可修改。

内置并逐份核验的 6 份 100M/200M 套餐模板的匹配候选提供 `reviewed_controls.package_options`，其中 `fields` 列出提交字段，`speed` 列出该版原表可选的上行升速档。页面按原表分为基础套餐、增值免费可选包和收费可选包三组。`package_line_type` 默认 `new`，可在收起的修改入口选择 `existing`，并须提供 `package_existing_number`；`package_fttr`、`package_disk`、`package_free_ext`、`package_plugin` 以 `1` 表示订购，未选为空。固话、商云通、移动主卡、副卡及收费从设备数量分别使用 `package_landline_count`、`package_cloudphone_count`、`package_mobile_count`、`package_secondary_count`、`package_paid_ext_count`，留空表示不订购。`package_speed` 须为候选列出的档位之一。生成器在原表哈希校验后按选项实际勾选并填写数量，再校验从设备与 FTTR、插件与从设备的依赖、固话／商云通合计上限和主副卡数量；其他未映射项目仍须人工核对。其余导入版式、AI 及担保书不使用这一套原表选项。

不带语音的 100M/200M 原表若选择固话或移动业务，授权书业务名称按已确认的宽带／固话／手机组合填写；选商云通时业务类型留空并提示人工确认归类。选择上述语音或移动业务时，生成记录的 `review` 包含 `voice_template`、`authorization` 和 `voice_identity`，前端提示核对适用模板与带语音实名材料，不提供不带语音的材料话术；未选语音业务时不增加这些提示。

已核验套餐授权书的“本单位”和统一社会信用代码使用当前客户资料，缺失时需要补充。受托员工姓名、身份证号和授权书签署日期暂不自动填写，生成结果以 `authorization_employee` 提示待核对。带语音 100M/200M 候选的 `service_type_choice` 默认宽带，并可根据已勾选的固话、手机业务同步，工作人员可手动修改；若与已选固话或手机不一致则拒绝生成，商云通归类由工作人员核对。业务属性为新装时授权书事项写入“新装”，实际用途采用可修改的表单业务用途，默认为“办公上网”。

### AI 原表套餐选项

浏览器演示中，匹配到已核验的 `business-ai-v1` 或 `business-ai-v2-no-voice` 原表时，候选 `reviewed_controls.ai_options` 返回 `version` 和可提交的 `fields`。生成请求的 `customer` 使用这些 `ai_` 字段记录工作人员的明确选择，未勾选选项保持空白；开通类型默认为纯新装。选择在用宽带、云电脑、云脉 SASE、收费从设备或套餐附加项目时，后台验证对应号码、账号、数量、上下限与依赖关系。AI V2 选中语音类选项时，生成结果提示人工核对授权书。其他 AI 原表版本尚未核验，不返回这组映射并继续提示人工处理。

### 工作看板
联调模式的 `GET /forms/dashboard` 返回 `scope`（team / self）、员工统计和生成记录。只有管理员能读取本工作区全部账号的记录，员工仅能读取自己的记录。报价还没有业务记录，`quote_count` 返回 null。成功生成一次计一次，幂等重试不重复计数。
`GET /forms/dashboard/records/{id}/file` 按相同权限提供 Word 文件；个人历史接口仍只返回本人的记录。静态 Demo 的身份切换用于虚构数据验收，数据仅存于当前浏览器。

`GET /forms/dashboard` 支持将时间范围与 `business_id`、`business_name`、`business_attribute`、`voice`、`discount` 组合筛选。语音和折扣取 `yes`、`no` 或 `unknown`（未记录或不适用）。响应的 `business_names` 提供当前身份可见的历史业务名称，以便检索已下架业务。

时间范围按上海时间计算。`period=quarter` 使用自然季度；`period=fiscal` 使用财年，`fiscal_start_month` 可指定 1 至 12 月（默认 1 月）。两种周期均支持用 `offset` 查看往期。

看板默认本周（周一至周日，上海时间）。查询可传 `period=week|month|all|custom`，周/月可传 `offset`（0 表示本期、1 表示上一期），自定义日期传 `from`、`to`（YYYY-MM-DD，含结束日）。响应的 `range` 返回实际统计区间。列表与汇总使用同一区间，打开明细文件仍按账号权限核验。

表单生成页按业务种类、业务名称、业务属性、语音及折扣选条件；如需确认多个版式或付费周期，再单独选择。请求仍带已核对的内部资费编号。新增可选的 `discount_mode`（yes/no）和打折时的 `discount_factor`（如 8.5）。模板有核验折数时拒绝不一致的选项；无核验折数时，记录员工输入并提示在 Word 中人工核对，系统不计算折后资费。

## 托管站的 Word 套餐导入

以下路径均位于 `/api/v1/forms`。托管站从已登录用户的身份确定工作区。共享模板管理额外要求管理员验收角色和服务端授权邮箱，员工可以使用已启用模板。历史记录及生成文件仍归属于登录用户及其验收身份。

| 请求 | 用途 |
| --- | --- |
| `POST /templates/inspect` | 发送 `filename`、Base64 编码的 `file`，预览字段、分类和三档资费。遇到待确认或不支持的版式时展示原因。 |
| `POST /templates/import` | 提交同一份 Word，以及管理员确认的 `confirmed_rates`（每档包含 `key`、`bandwidth`、`amount`、`cycle`）；需要区分折扣时提交 `variant`。清理后的模板与套餐一起保存，初始停用。 |
| `PATCH /templates/{id}` | 传入 `active` 启停模板。启用后，登录用户通过 `GET /workspace` 读取对应套餐，调用现有 `/match`、`/generate` 和个人历史下载接口。 |

首批支持 512 KiB 以内的 100M 智云上海专线基础版（FTTR-B、不带语音）已识别版式。重复导入返回 `duplicate: true`，同一版式下资费或文档内容不同则要求重新核对。

## 电信宽带资源查询

报价计算的安装地址旁提供宽带资源查询入口。点击后尝试将地址复制到本机剪贴板，并打开上海电信公开查询页；员工自行粘贴地址并输入图形验证码。润网没有对接查询接口，也不会自动发送地址。

接入前向上海电信客户经理确认授权查询接口、认证方式、地址精度、是否支持政企商务专线及结果字段。正式版由已登录的工作台向润网后台发起查询，仅提交所需地址；后台调用获准的接口，不在日志记录完整地址。工作台区分未匹配地址、查询失败和电信明确返回不可办理，只显示电信实际返回的覆盖、速率及办理状态，不从套餐资费推算。

## AI 报价顾问

本机 `POST /api/v1/quotes/ai-settings` 的 `action: "save-qcc"` 接收成对的 `qccKey` 和 `qccSecret`。凭据保存在本地后台内存，`action: "status"` 只返回企查查配置状态 `qcc`，不会返回凭据。目前尚未调用企查查查询接口。

- 本机通过 `node backend/server.mjs` 启动，服务端从 `DEEPSEEK_API_KEY`（或 `AI_API_KEY`）读密钥。可用 `AI_MODEL` 指定模型，默认 `deepseek-flash`。`POST /api/v1/quotes/advisor` 只接受同源本机请求。
- 已配置 HTTPS AI Worker 的互动演示版使用 `POST /template-ai?purpose=quote`，复用已加密保存的 DeepSeek Key 或 Worker Secret，以及现有 AI 验收口令。部署 Worker 后功能才可在线调用。静态只读包不发请求。
- 请求为 `{dialogue:[string,...]}`，最多八轮，共 5000 字。提交前需移除客户姓名、号码、详细地址；对话只在报价页面内存保留，清空即移除。返回摘要、已确认、待核对、追问和明确的筛选条件。报价仍按系统资费算，未核实可装性不作承诺。
