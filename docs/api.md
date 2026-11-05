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
