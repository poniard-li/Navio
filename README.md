# Navio

Built by D.E.X Studio · Windows x64 · Public Beta（公测版）

当前客户端版本：`0.6.0-beta.5`。已发布版本的安装包、免安装包和对应源码见 [GitHub Releases](https://github.com/poniard-li/Navio/releases)。

Navio 基于 Clash Party 2.0.4 客户端与 Mihomo 内核开发。上游及第三方来源见 [鸣谢与许可说明](DEX-THIRD-PARTY-NOTICES.txt)，客户端遵循 [GPL-3.0-only](LICENSE)。

## 使用与构建

- 安装版：运行 `setup.exe`，本机数据保存在 `%APPDATA%\DEX-STUDIO-NEXT`，卸载时保留。
- 免安装版：解压完整 `portable.zip` 后运行 `Navio.exe`，本机数据保存在程序旁的 `DEX-STUDIO-NEXT` 目录。
- 首次使用需要可用的 D.E.X 账号服务。注册、密码或验证码登录、找回密码、绑定和设备管理在软件内完成。Google / GitHub 授权使用系统浏览器。
- 在“设置 → 账号”中解除邮箱、手机号或 Google / GitHub 绑定，需要当前密码或已绑定联系方式的验证码；请保留另一种联系方式。解绑后本机继续登录，其他设备需要重新登录。此功能需要 D.E.X Platform 0.7.0-beta.4 及以上版本。
- 已登录设备在账号服务暂时不可用时保留本机离线使用；订阅和节点凭据不上传 D.E.X 官方云。
- 构建流程及固定资源来源见 [DEX-BUILD.txt](DEX-BUILD.txt)。测试范围和未验证项见 [Navio-验证记录.txt](Navio-验证记录.txt)。

该公测版仍需继续调试。正式邮件、短信、OAuth 提供商、Windows 后台服务与各类真实网络场景的验证状态，以对应版本记录为准。

0.6 公开分发包不附带历史 GeoIP / ASN / GeoSite / BundleMRS 数据。内核尚未启动时，可在“外部资源 → 下载最新数据库”中按需获取当前数据，默认从 MetaCubeX 的 GitHub 数据发布下载；这些请求不包含订阅或节点凭据。内核运行期间请使用原有的内核数据更新功能。依赖缺失数据的规则可能暂时无法启动，网络不可达时需检查资源来源后重试。下载成功后按需重启内核；下载失败不会开启系统代理。

升级前先从托盘退出 Navio。安装版运行新版安装程序；免安装版解压到新目录，再复制旧版的 `DEX-STUDIO-NEXT` 数据目录，保留原目录作为备份。不要同时运行两个版本，也不要将安装版装入免安装版目录。

从免安装版切换到安装版，可使用本地备份导出和恢复配置，之后重新登录。详细说明见 [Navio-使用说明.txt](Navio-使用说明.txt)。
