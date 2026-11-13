# Windows 桌面 QA 工具

这些工具从 Beta 7 发布验证脚本整理而来，用于检查打包后的 Navio。它们不负责构建、安装、上传或发布，也不包含私有 D.E.X 平台源码。

## 前提与参数

需要 Windows、Node.js 24+、与本仓库源码对应的完整 Navio 程序目录，以及带 `_electron` API 的 Playwright。提供的是目录内的 `Navio.exe`，不是安装器。Playwright 可在仓库外单独安装；工具不安装依赖，不修改 `package.json` 或锁文件。

从仓库根目录执行，或给脚本传入完整路径：

```powershell
node tools/qa/smoke.cjs --help
node tools/qa/download-themes.cjs --help
node tools/qa/electron-network.cjs --help
```

| 参数               | 环境变量              | 说明                                                                                          |
| ------------------ | --------------------- | --------------------------------------------------------------------------------------------- |
| `--exe PATH`       | `NAVIO_TEST_EXE`      | 必填，打包后的 `Navio.exe`                                                                    |
| `--playwright DIR` | `NAVIO_QA_PLAYWRIGHT` | Playwright 包目录；未指定时使用 Node 正常解析的 `playwright`                                  |
| `--output DIR`     | 无                    | 已存在的产物父目录，默认系统临时目录；每次新建唯一子目录，拒绝仓库内目录及指向仓库的 junction |
| `--keep-data`      | 无                    | 保留本次隔离用户数据，便于本机排查；默认测试结束后删除                                        |

以下示例中的尖括号须替换为本机路径；不应填写真实账号、订阅或服务凭据。

## 完整账号及功能烟测

```powershell
node tools/qa/smoke.cjs --exe "<Navio.exe路径>" --playwright "<Playwright包目录>" --platform "<私有平台源码目录>"
```

`--platform` 也可用 `NAVIO_QA_PLATFORM` 指定。此项必填，工具不会猜测本机旧工作区，也不会退回生产账号服务。私有平台源码必须兼容 Beta 7 的账号合同，至少提供 `server/app.mjs`、`database.mjs`、`config.mjs`、`security.mjs` 和 `public/`，并自行准备其运行依赖。工具先校验路径、模块导入和导出，再创建临时数据或启动 Electron；缺失时直接失败。不要为运行烟测而把私有平台复制进公开仓库。

平台在 `127.0.0.1` 随机端口运行，使用内存 SQLite 数据库和虚构的 `smoke@example.test` 账号。配置通过明确的测试对象传入，不读取 `.env`，不使用真实邮件、短信、OAuth 或中继凭据。测试订阅只含 loopback 主机和 `DIRECT` / `REJECT` 策略。

覆盖账号登录及服务离线、Mihomo 本地转发、全局例外与规则模式边界、19 个功能路由、24 套主题试用与恢复、快捷搜索、材质弹窗、流量和动效 IPC、简易模式及 800×600 布局。截图等待弹窗入场动画完成。

默认从本仓库 `scripts/theme-packages/` 装入 18 个主题测试包，经过正式目录校验，**不代表远程下载成功**。可用 `--theme-packages DIR` 指定对应版本的包目录，或加 `--download-themes` 改为实际下载。即使使用本地主题包，网络信息页面仍可能查询应用配置的公网信息服务；此烟测不是完全离线测试。

## 独立官方主题下载

```powershell
node tools/qa/download-themes.cjs --exe "<Navio.exe路径>" --playwright "<Playwright包目录>"
```

无需私有平台或登录。账号服务被指向本机返回 503 的测试服务；通过实际 `dexThemes` IPC 下载官方目录中的 18 个非内置包，最多同时 3 个。使用全新缓存，检查 24 项可用、正式大小 / SHA-256 / 格式校验及浅色和深色变体。此项需要访问应用版本指定的公共 GitHub Release。

## Electron 网络与跳转诊断

```powershell
node tools/qa/electron-network.cjs --exe "<Navio.exe路径>" --playwright "<Playwright包目录>"
```

无需私有平台。比较 Node `fetch`、Electron `net.fetch`、`net.fetch` 手动跳转和 `net.request` 手动跳转。默认请求 Navio GitHub Release 及 Beta 7 的一个主题附件；可用 `--url HTTPS_URL`、`--redirect-url HTTPS_URL` 更换公开测试目标。请求有 20 秒限制，不发送 Cookie，收到响应后取消正文。

Electron 普通请求成功且 `net.request` 返回 HTTPS 跳转才通过。Node `fetch` 和 `net.fetch` 手动跳转是诊断项：Beta 7 曾遇到 Node 不使用系统代理、`net.fetch` 手动跳转被取消的问题，不能把这两项失败误判为当前正式下载器失败。完整逐跳下载及包验证由上一项完成。报告不记录代理地址、完整跳转 URL 或网络错误中的敏感正文。

## 数据隔离与产物

启动时强制 `DEX_TEST_MODE=1`、新的 `DEX_USER_DATA`、loopback 账号地址；配置关闭系统代理、TUN、订阅自动更新和应用自动更新。共享账号缓存使用不同于用户配置的 `appData` 路径，因此工具还设置子进程 `APPDATA` / `LOCALAPPDATA`，并在发起任何测试登录前通过 Electron 重定向 `appData`。不会登录真实服务。使用正常关闭流程结束本次应用和本地服务。

`DEX_TEST_MODE` 并非权限或网络沙箱。完整烟测会运行真实内核、改变本次隔离配置的路由模式；请在独立 Windows 验证环境执行，不在其中手动打开系统代理、TUN、安装服务或导入私人订阅。它不覆盖安装器、服务提权、生产身份提供方及真实用户数据迁移。

每次运行输出新目录中的 `report.json`；完整烟测另含截图，失败时尝试保存 `failure.png`。默认清理隔离用户数据；指定 `--keep-data` 或应用关闭 / 清理失败时保留，需在关闭对应测试进程后手动处理。强制终止脚本也可能留下测试进程与目录。报告、截图、保留的 vault / 日志均仅供本机排查，不应直接提交到 Git。

注册表只读取并在内存中比较 Windows Internet Settings 前后是否一致，不打印或保存原始内容，也不尝试自动恢复其他进程造成的变化。测试账户、数据库和浏览器状态不随工具源码迁移。

## 本次迁移的验证边界

工具保留 Beta 7 的 24 主题 / 6 内置 / 19 路由断言。未来修改产品目录时应明确更新检查范围，不能静默接受少项。

本次仅完成参数化、路径 / 入口检查测试、Node 语法检查与局部格式 / Lint 检查，**没有重新启动 EXE、登录平台或请求远程主题**。历史发布烟测结果不能作为这些新入口已执行的证明。

可不启动应用运行入口检查：

```powershell
node --test tools/qa/common.test.cjs
```
