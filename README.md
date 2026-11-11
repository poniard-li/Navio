# Navio

Built by D.E.X Studio · Windows x64 · Public Beta（公测版）

当前客户端版本：`0.6.0-beta.1`。程序和对应版本源码通过 [GitHub Releases](https://github.com/poniard-li/Navio/releases) 发布；本仓库不提供代理线路或订阅。

Navio 基于 Clash Party 2.0.4 客户端与 Mihomo 内核开发。上游及第三方来源见 [鸣谢与许可说明](DEX-THIRD-PARTY-NOTICES.txt)，客户端遵循 [GPL-3.0-only](LICENSE)。

## 使用与构建

- 解压完整 Windows 便携包后运行 `Navio.exe`。本机数据使用独立的 `DEX-STUDIO-NEXT` 目录。
- 首次使用需要可用的 D.E.X 账号服务。注册、密码或验证码登录、找回密码、绑定和设备管理在软件内完成。Google / GitHub 授权使用系统浏览器。
- 已登录设备在账号服务暂时不可用时保留本机离线使用；订阅和节点凭据不上传 D.E.X 官方云。
- 构建流程及固定资源来源见 [DEX-BUILD.txt](DEX-BUILD.txt)。测试范围和未验证项见 [Navio-验证记录.txt](Navio-验证记录.txt)。

该公测版仍需继续调试。正式邮件、短信、OAuth 提供商、Windows 后台服务与各类真实网络场景的验证状态，以对应版本记录为准。

0.6 公开分发包不附带历史 GeoIP / ASN / GeoSite / BundleMRS 数据。在“外部资源 → 下载最新数据库”中按需获取当前数据，默认从 MetaCubeX 的 GitHub 数据发布下载；这些请求不包含订阅或节点凭据。内核未启动也能下载。依赖缺失数据的规则可能暂时无法启动，网络不可达时需检查资源来源后重试。下载成功后按需重启内核；下载失败不会开启系统代理。原有内核数据更新功能仍保留。
