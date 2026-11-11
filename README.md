# v0.3.0-beta.1 · Public Beta

Built by D.E.X Studio

这是历史构建的归档说明，不代表该版本此前已经公开上线。原内部版本为 `0.3.0-preview.1`，旧产品名和构建元数据按原样保留；`v0.3.0-beta.1` 是本次归档标签。下列测试数字来自随原构建保存的验证记录，不是本次重新运行的结果。

本次提供独立分发副本：移除六个历史地理/域名数据文件并补充许可证及对应源码说明。原 app.asar、三套内核及其余原文件逐项验证字节一致，原始归档未变。首次使用 Geo 规则需要联网；源码确认初始化跳过缺失数据，真实 stable 内核已经通过无数据的基本配置和本机服务按需下载 GEOSITE/GEOIP/IP-ASN 的验证。外网可达性、所有订阅和可选内核并未据此宣称全部通过。

- 基于 Clash Party 2.0.4 与 Mihomo 重建完整客户端，恢复订阅、策略组、规则、外部资源、DNS、嗅探、TUN、系统代理/PAC、连接与日志等主要能力。
- 保留覆写、YAML/JavaScript 编辑、Sub-Store、备份、托盘、快捷键等高级入口；新增六套主题、主题编辑与导出、Ctrl+K 功能查找。
- 使用独立数据目录及端口；首次默认关闭系统代理、TUN、局域网访问和更新检查。恢复代理设置时检查归属，减少对其他实例的影响。
- 历史 Windows 验证为 575 项通过、1 项跳过（44 个文件），另排除不适用于该环境的 Linux symlink 文件。打包程序、13 个页面和本地 HTTP 转发有真实检查记录。

边界：未真实切换宿主系统代理/TUN/路由/DNS，未验证真实外部节点、Alpha/Smart 内核、macOS/Linux 或云端部署。CFW Parsers/Mixin 当时仍需人工迁移。

English: Rebuilt on Clash Party and Mihomo, this version restored the broader configuration and advanced-tool surface. Historical checks cover Windows and local proxy forwarding, not external providers or privileged TUN behavior.

原始源码 SHA256：`6abcd2c3411151c752bf67dfcd59d7a0861c611927e6f928984874d1feed656b`  
原始便携包 SHA256：`ea6da17f04749aa6a1e10c48f09b1460ed1ec040fb2b1cfb76fbe0492ce49e66`

本次分发源码 SHA256：`36f9f2cd7f0c3e0d7cc81dc080c6f5a9d2e4a7e031ea04c29a09bcc3fe4e58d3`  
本次分发便携包 SHA256：`0d390230a7bd66f3ecd8c93cc0b3fb51d3232b2775355557496d0872468f8196`

对应源码附件：`Navio-v0.3-v0.6-third-party-sources.zip`，SHA256：`258d61f71628710740aa9a805edc06079e96fd20d40a348d872153551f7a7952`。

升级建议：备份所需本地配置和修改，将 v0.6 或更新版本解压到独立目录；退出旧软件及其内核后，通过新版导入流程恢复。不要将订阅或账号凭据上传 GitHub。旧版可先使用无 Geo 规则的配置启动，再从原“外部资源”页更新 Geo 数据；直接启用相关订阅会按需下载，下载失败则该配置可能无法启动。BundleMRS 本地引用不承诺自动恢复，需要当前来源资源。
