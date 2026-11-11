# v0.4.0-beta.1 · Public Beta

Built by D.E.X Studio

这是历史构建的归档说明，不代表该版本此前已经公开上线。原内部版本为 `0.4.0-preview.1`，旧产品名和构建元数据按原样保留；`v0.4.0-beta.1` 是本次归档标签。下列测试数字来自随原构建保存的验证记录，不是本次重新运行的结果。

本次提供独立分发副本：移除六个历史地理/域名数据文件并补充许可证及对应源码说明。原 app.asar、三套内核及其余原文件逐项验证字节一致，原始归档未变。首次使用 Geo 规则需要联网；源码确认初始化跳过缺失数据，真实 stable 内核已经通过无数据的基本配置和本机服务按需下载 GEOSITE/GEOIP/IP-ASN 的验证。外网可达性、所有订阅和可选内核并未据此宣称全部通过。

- 更名 Navio，增加首次使用引导、简易/标准模式，以及高级功能和 ISP/ASN 等术语说明。
- 增加仅对全局意图生效的直连例外：匹配项 DIRECT，其余交给 GLOBAL；切回规则模式保留订阅规则。内置应用预设默认关闭。
- 本版网络信息调整同时收起坐标、城市和时区；这是历史行为，后续 v0.5 才恢复除坐标外的原有信息。
- 历史自动测试为 610 项通过、1 项跳过（48 个文件）；真实内核的本地域名/进程规则转发有验证记录。

边界：本版简易/标准切换仍涉及重新加载配置；共用同一订阅的完善实现见 v0.5。本版打包 UI 验证因环境 ACL 受阻，不能称为已完成实机视觉验收。没有统一账号或独立 TUN 后台服务。

English: Navio branding, onboarding and global-mode direct exceptions were introduced. The packaged UI was not fully validated because of an environment permission failure; later versions resolve additional usability issues.

原始源码 SHA256：`3d833ddb6ee6df9cb4f291a4f65f07b90d812ad5788f5592f4c9e28f725223b8`  
原始便携包 SHA256：`9b86689a24d2fa18addf4f6390d901cd4d5a5034ecf59ca091570b0d0a85df7f`

本次分发源码 SHA256：`26025ab02b6ffcdd2c79fa48cef6660eba476c5bad29f96818d6a6705156f1d9`  
本次分发便携包 SHA256：`106eb2b41da8f3516b2098b847ad160960cfc70d502a391f08d6c11d7dbaf995`

对应源码附件：`Navio-v0.3-v0.6-third-party-sources.zip`，SHA256：`258d61f71628710740aa9a805edc06079e96fd20d40a348d872153551f7a7952`。

升级建议：备份所需本地配置和修改，将 v0.6 或更新版本解压到独立目录；退出旧软件及其内核后，通过新版导入流程恢复。不要将订阅或账号凭据上传 GitHub。旧版可先使用无 Geo 规则的配置启动，再从原“外部资源”页更新 Geo 数据；直接启用相关订阅会按需下载，下载失败则该配置可能无法启动。BundleMRS 本地引用不承诺自动恢复，需要当前来源资源。
