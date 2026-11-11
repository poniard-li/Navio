# Historical Public Beta redistribution

Public tag: v0.4.0-beta.1. Original internal version: 0.4.0-preview.1.
原始包 SHA256：`9b86689a24d2fa18addf4f6390d901cd4d5a5034ecf59ca091570b0d0a85df7f`。

此分发副本只移除六个历史数据文件（ASN.mmdb、country.mmdb、geoip.dat、geoip.metadb、geosite.dat、BundleMRS.7z），并添加许可证、对应源码说明和本记录。程序 app.asar、启动器、三套内核及其他原文件保持字节不变，原始 ZIP 未修改。旧内部名和 preview 版本不代表一个额外的新功能版本。

这六个历史地理/域名规则数据文件不随本包分发。原客户端在初始化与配置复制时会跳过不存在的源文件；原 Mihomo stable 内核在首次需要 GeoSite、GeoIP/MMDB 或 ASN 时尝试按配置下载数据。因此首次使用相关规则需要可访问的数据源；离线、下载失败或指定了不存在的本地规则资源时，配置可能无法校验或启动。

可先使用不依赖 Geo 数据的配置启动内核，再在原“外部资源”页的 GeoData 更新入口更新；该入口依赖运行中的内核，不是 v0.6 新增的独立下载器。直接启用依赖 Geo 的订阅也会触发内核首次下载。原 BundleMRS 的自动补取没有在本次验证中确认；依赖其本地文件的自定义配置需要用户提供当前合法来源的资源。数据及数据服务有各自条款，应用 GPL 不替代它们。

本次重新验证：同一 stable 内核在全空工作目录可通过无 Geo 规则配置校验；包含 GEOSITE/GEOIP/IP-ASN 的配置从本机隔离 HTTP 服务下载相应文件后校验通过。测试不访问外网，不修改系统代理或开启 TUN。此验证不等于所有网络环境、订阅和可选 Alpha/Smart 都已测试；历史 UI 验证边界见发行说明。

推荐升级到 v0.6.0-beta.1 或更新版本：先在旧版中保存本地配置/订阅与个人修改的备份，将新便携包解压到独立目录，退出旧版本和它的内核后启动新版，按新版导入流程恢复所需配置。不要把订阅凭据、账号凭据或整份个人数据目录上传 GitHub。v0.5 依赖的旧网页账号门户已经退出服务方案，新的首次登录不保证可用；请使用 v0.6 的软件内登录和找回密码流程。

English: This redistribution preserves all application and core binaries but removes historical geodata snapshots. First use of geo rules requires a reachable download source. A minimal offline configuration and native on-demand downloads were checked locally; this is not a new feature build or a promise that every old subscription works offline. Upgrade to v0.6 or later for current in-app account workflows.
