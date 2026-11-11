# v0.5.0-beta.1 · Public Beta

Built by D.E.X Studio

这是历史构建的归档说明，不代表该版本此前已经公开上线。原内部版本为 `0.5.0-preview.1`，旧产品名和构建元数据按原样保留；`v0.5.0-beta.1` 是本次归档标签。下列测试数字来自随原构建保存的验证记录，不是本次重新运行的结果。

本次提供独立分发副本：移除六个历史地理/域名数据文件并补充许可证及对应源码说明。原 app.asar、三套内核及其余原文件逐项验证字节一致，原始归档未变。首次使用 Geo 规则需要联网；源码确认初始化跳过缺失数据，真实 stable 内核已经通过无数据的基本配置和本机服务按需下载 GEOSITE/GEOIP/IP-ASN 的验证。外网可达性、所有订阅和可选内核并未据此宣称全部通过。

- 首页快速连接与节点侧栏，支持搜索、收藏和测速；简易/标准模式共用同一订阅，高级设置可以展开。
- 本地修改与订阅原文分离，增加更新差异、冲突处理和草稿一致性检查；提供常见 CFW Mixin 迁移及旧脚本兼容性检查。
- 恢复网络信息原有城市、时区、ISP、ASN 等功能，仅移除坐标；保留全局模式直连例外及功能说明。
- 增加加密本地/WebDAV 备份；WebDAV、Gist、自定义托盘脚本默认关闭。提供主题发布、收藏、举报及管理员处理能力。
- 首次接入 D.E.X 账号设备授权与本地离线状态；本版登录仍通过网页账号门户。更新需用户确认并校验文件，便携包由用户手动替换。
- 历史客户端验证为 704 项通过、1 项跳过（55 个文件）；本地服务端 25 项通过。实际打包程序、账号登录/离线、本地 Mihomo 转发、全局例外和 800×600 窗口有记录。

边界：旧账号门户现已退出产品方案，因此本历史版在新服务端上的首次登录不保证可用，请新用户使用最新版本。正式 SMTP/短信/Google/GitHub、阿里云部署及管理员 TUN 未完成生产实测；独立 Windows 后台服务尚未实现。

English: Local overrides, migration guidance, encrypted backups, theme community features and D.E.X account integration were added. This historical version still depends on the former browser account portal and is retained for archival reference, not recommended for new installations.

原始源码 SHA256：`9a36b704a234f344165550df214a027818e233eb539fcef28794c65424b3b48a`  
原始便携包 SHA256：`dfc9346c2b7a901b2b87467be4e6488912ecb8eb5e5cc6b461af113c9c3e447a`

本次分发源码 SHA256：`564c1eafae807d7511623ec117ab82404d9a85662aa4b30f55c86af759044721`  
本次分发便携包 SHA256：`c7a90662572f6df4d178edf6341e67f547ac0c167ca444598485c5545f3efa7b`

对应源码附件：`Navio-v0.3-v0.6-third-party-sources.zip`，SHA256：`258d61f71628710740aa9a805edc06079e96fd20d40a348d872153551f7a7952`。

升级建议：备份所需本地配置和修改，将 v0.6 或更新版本解压到独立目录；退出旧软件及其内核后，通过新版导入流程恢复。不要将订阅或账号凭据上传 GitHub。旧版可先使用无 Geo 规则的配置启动，再从原“外部资源”页更新 Geo 数据；直接启用相关订阅会按需下载，下载失败则该配置可能无法启动。BundleMRS 本地引用不承诺自动恢复，需要当前来源资源。

v0.5 的网页账号门户已退出服务方案，新设备请直接升级 v0.6，使用软件内登录和密码找回。
