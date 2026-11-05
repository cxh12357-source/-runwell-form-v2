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
