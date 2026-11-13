# Navio 云端开发交接

核对日期：2026-11-13。本文仅保留继续开发需要的信息，不包含完整对话、账号数据或部署凭据。

## 1. 接手摘要与 Git 基线

Navio 是基于 Clash Party / Mihomo 的 Windows 桌面客户端，产品名为 **Navio**，署名 **Built by D.E.X Studio**。本轮是源码和开发知识交接，不修改产品版本，不重新发布，不部署生产服务。

| 项目            | 已核对状态                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------- |
| 唯一桌面仓库    | <https://github.com/poniard-li/Navio>，公开仓库                                                   |
| origin          | `https://github.com/poniard-li/Navio.git`                                                         |
| 实际本地仓库    | 旧工作区内 `work/navio-publish/git-checkout-beta2`；目录名是历史名称，不代表当前版本              |
| 初始分支 / 提交 | `main` / `03e9a6338cc449547ad7f0bd14af908dc241e9f0`                                               |
| 与远端关系      | 已 fetch；开始交接时与 `origin/main` 相同，ahead 0 / behind 0                                     |
| 初始工作区      | 无未提交修改、无未跟踪文件、无本地尚未推送的分支提交                                              |
| worktree        | 一个普通 checkout，没有额外 linked worktree                                                       |
| 本轮分支        | `codex/cloud-handoff-20261113`，从上述提交建立；不合并 main、不改写历史                           |
| 当前产品版本    | `1.0.0-beta.7`，对外名称 Release 1.0.0 · Public Beta 7                                            |
| 当前公开版本    | [v1.0.0-beta.7](https://github.com/poniard-li/Navio/releases/tag/v1.0.0-beta.7)，对应上述基线提交 |

初始审计使用了 `git status --short --branch --untracked-files=all`、`git worktree list --porcelain`、`git rev-list --left-right --count HEAD...origin/main` 和 `git log --branches --not --remotes`。此文档之后的提交只属于交接分支。交接提交本身的准确 SHA 由 `git rev-parse HEAD` 获取，避免文档内自引用。

旧工作区还存在 `outputs/dex-studio-next` 和 `work/navio-publish/repository` 等旧副本。**不要以这些副本覆盖当前仓库**。当前 `node_modules` 是指向旧工作区依赖目录的本机 junction；云端必须按锁文件重新安装。

## 2. 产品目标和已确认约束

### 桌面体验

- 保留 CFW / Clash Party 所需的完整代理管理能力，以清晰层级、简便操作和具体提示降低使用门槛。借鉴 Apple 的设计原则，不复制其品牌或受保护素材。
- 首页优先连接、节点和模式；网速与订阅余量作为辅助。数据必须来自真实连接，不能用固定演示读数冒充运行状态。首页尽量在常用窗口尺寸内完整呈现。
- 标准 / 简易模式共享配置；简易模式收起高级选项，用户随时展开。侧栏主要功能归入工作区，栏目展开只影响内部滚动，不自动撑大窗口。
- 初始使用系统代理，TUN 按需启用；界面名称保留 **TUN** 并解释用途。默认不开机启动、不自动连接；关闭窗口收起托盘并保持连接，首次给提示。
- 全局例外只对全局模式生效，原订阅规则模式不被覆盖。内置国内常用应用预设默认关闭，用户选择后启用；不能为了覆盖某厂商而不加区分地放行全部域名。
- 手动节点故障时提示并让用户确认替换；候选限定当前策略组，优先测速通过的收藏节点。不得静默改变用户手选出口。
- 本地订阅修改独立保存，更新后继续应用，并提供差异 / 冲突处理。迁移助手检查 CFW Parsers / Mixin 等常见配置；不承诺任意旧脚本兼容。
- 网络信息保留 IP、ISP、ASN 等实用能力和拓扑，去掉坐标，并解释第三方查询及字段含义。不要把流量分析等同于可无限保存的网站访问历史。
- 日志应保留暂停、清空、导出、级别、搜索和诊断入口。复杂选项提供帮助；首次使用引导可关闭，无强制倒计时。
- 托盘图标保留完整 Navio logo，只改变 N 的状态颜色。账号、帮助、设置避免重复入口；首页和右上角不增加主题入口。

### 主题与材质

- 工坊保留官方 / 本地 / 在线 / 收藏 / 发布五个入口；官方主题按类型横向挑选。最新认可的视觉参考见 [design/README.md](../design/README.md)。参考中的模拟行为不能当成正式功能。
- 24 套官方主题，基础主题内置，其余首次联网下载并缓存；动态分类 8 套，角色、季节等其他分类也可有动画。整窗背景、控件细节及连接反馈共同表达主题，不额外增加无意义动画面板或重复数据。
- 玻璃是独立设置：实色 / 磨砂 / 通透，可调透明、模糊、光泽、流动，并分别用于侧栏、卡片和弹窗。当前实现是应用窗口内部材质，不等于 Windows 桌面背景透视。
- 整窗临时试用后用户选择保留 / 恢复，无倒计时。隐藏窗口时暂停动画；自动平衡、节能和减少动态效果需要遵循系统偏好。
- 用户主题通过格式检查后公开，支持举报及管理员下架；已下架作品修改后需复核。主题格式受约束，不开放任意 HTML / JS 执行。所谓联名分类不代表已取得外部 IP 合作授权。

### 账号、备份和发行

- D.E.X 是多产品统一账号。首次使用需注册 / 登录；已登录设备在账号服务暂时不可达时保留本地状态，连接功能继续可用，在线服务暂停。
- 登录方式包括邮箱 / 用户名 / 手机的适用密码或验证码方式，以及 Google / GitHub；服务端未配置的方式不可伪装为可用。第三方首次授权后创建或关联 D.E.X 账号，必要时验证联系方式。
- 官方云只处理账号、主题及收藏，**不上传订阅和节点凭据**。WebDAV / Gist 是用户自行启用的高级功能，必须说明目的地和内容。本地及 WebDAV 备份默认独立密码加密，明文需明确选择；外部引用文件纳入备份前确认。
- 解绑只移除 D.E.X 关联，不删除 Google / GitHub 的外部账号。管理员“停用”和“永久删除”分开；删除需再次核对。账号恢复需管理员核实，再由用户验证新联系方式。
- 同机其他 D.E.X 软件应显示“以此账号继续”并允许切换，不能静默替用户登录。旧 Mystery 用户主动验证两边账号后绑定并保留权益；旧桌面端接入仍未完成。
- Windows 同时提供 EXE 安装版和 ZIP 免安装版，后台分别管理更新包。检查更新展示内容，用户确认后下载 / 校验 / 退出更新 / 重启。
- GitHub 使用 Public Beta 表述，说明只列实际变更、修复、下载、许可及 SHA-256 等必要内容。保留 GPL-3.0-only、上游来源和第三方声明。历史 0.1 / 0.2 只保留源码记录，不重新分发授权未核实的 CFW Premium 内核。
- 产品总站不展示 Navio；下载使用现有 GitHub 仓库。账号操作在软件内，Navio 域名仅提供必要 API 和管理员入口。Mystery 原有网站设计不在本任务中重做。

历史中一些答复只有选项编号，缺少对应题目，无法可靠还原；本文不把这些编号补写为新需求。用户认可 Beta 7 并接受部分问题后续处理，但没有提供完整待修复 bug 清单。

## 3. 当前代码已提供什么

以下“已提供”表示代码存在；生产配套、提权和跨平台是否验收，见第 8 节。

| 范围               | 当前实现                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接 / 策略 / 配置 | Mihomo 生命周期、系统代理、TUN、策略组和节点、测速收藏、订阅与覆写、规则及全局例外、资源管理、DNS / 嗅探 / Sub-Store 等高级入口                                |
| 新界面             | 重做首页与分组侧栏、节点快捷侧栏、Ctrl+K 快捷操作、标准 / 简易模式、首次使用帮助；概览实时速率及今日 / 本次连接累计曲线                                        |
| 主题               | 24 套官方主题：6 内置、18 远程 JSON 包并校验 SHA-256；五页工坊、整窗试用与恢复、独立材质、动态场景及状态反馈；`dynamic` 分类 8 套，`dynamic: true` 的总数是 16 |
| 日志 / 网络        | 日志有界缓存、暂停、级别与关键词、脱敏导出；网络拓扑、IP 显隐、ISP / ASN 说明、查询服务切换，无坐标。日志诊断当前只是本地异常摘要，不是完整网络自动修复        |
| 账号客户端         | 注册 / 登录 / 验证码、OAuth 系统浏览器回调、离线登录缓存、绑定解绑、设备管理、账号恢复、同机继续登录和 Mystery 绑定入口                                        |
| 更新               | 安装 / 便携包分流、大小及摘要校验、退出替换和重启。便携替换有回滚路径，安装器写入阶段没有完整目录事务回滚                                                      |
| Windows 服务       | 已有 C# 服务宿主、SID / 管道归属、受保护内核副本、运行快照校验、UAC 安装卸载和按次管理员备用方式；不是仅有设计方案                                             |

账号解绑需要平台至少 `0.7.0-beta.4`；恢复、共享设备登录、旧账号绑定及主题复核等需要 `0.7.0-beta.5`。私有平台本机源码版本为 `0.7.0-beta.5`；本轮只读状态接口也自报 `0.7.0-beta.5`，但没有登录服务器核对部署文件或验收这些接口。

## 4. 最近处理过的问题

| 问题                             | 方法与结果 / 不应回退到的方案                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 早期安装后 Windows 提示无法运行  | 曾修复损坏的程序文件，用户反馈可启动；现有打包流程加入 payload 摘要与磁盘空间检查。完整安装器 UI、升级和卸载仍需独立 Windows 验收                                                                     |
| GeoIP 数据无效且被进程占用       | 历史数据不再随正式包带入；使用资源管理下载。不要直接删除运行中的 Mihomo 数据库。该历史报错不证明所有 GeoIP 资源问题已解决                                                                             |
| Windows CI 冷启动测试超时        | PowerShell 子进程可运行 15 秒，但外层 Vitest 原为 5 秒；测试时限调整到 30 秒，子进程仍有上限，清理增加重试。没有因此修改升级功能行为                                                                  |
| 官方主题在系统代理环境下下载失败 | Node 全局 fetch 未走 Windows 代理；曾试 Electron `net.fetch` 手动跳转，出现 Redirect cancelled。最终改为 `net.request` 逐跳处理，保留 URL / 主机限制、32 KiB 上限、取消和 SHA-256 校验，不使用 Cookie |
| Chromium 取消后的晚到错误        | 下载请求错误处理必须覆盖取消后的事件；request close 也可能早于响应结束，不得据此截断正文。已用真实 GitHub 302 → release-assets 200 验证                                                               |

相关提交：`abc4a86f73fa750f489236438295774e41beb842`（测试时限），`1e03f755bb72443a07cd085786be4d6a966276eb`（中间网络实现），`03e9a6338cc449547ad7f0bd14af908dc241e9f0`（最终 Chromium 跳转处理）。最后一个是本次交接基线。

## 5. 待办和优先级

1. **P1，数据保存策略**：正式流量历史仍按 host、sourceIP、outbound、process 聚合，保留约 25 小时 / 8 天 / 31 天，不是“只保留应用汇总”，也不能配置。此前项目工作指令明确的目标是：应用用量明细 30 天、每日汇总 12 个月，支持今日 / 本周 / 本月 / 自选时间、本地保存、可修改期限和清空，不额外保存逐条网站访问历史；域名 / 源 IP 排行只做当前连接即时统计，不随历史日期过滤。这些目标尚未完整落地。SQLite 和发行运行时使用的 IndexedDB 必须一起审查、迁移和清理。
2. **P1，Windows 实机验收**：新装、拒绝 UAC、升级、便携替换失败恢复、卸载、重启后恢复；TUN 服务安装 / 换核 / 卸载、多用户 SID 边界和 DNS / 代理恢复。使用隔离测试机，不在工作电脑上改真实代理状态。
3. **P1，生产配套核实**：私有平台代码、双包更新元数据、主题资产和账号接口配套。2026-11-13 的公开只读查询中，平台状态自报 `0.7.0-beta.5`，但 Windows beta 更新接口仍返回 `1.0.0-beta.6`，与 GitHub 的 Beta 7 不一致。后续核对正式产物和元数据，再按新任务授权更新后台；本轮未修改服务。
4. **P2，连接与用量页面**：正式连接页仍为 list / table，预览中的按应用 / 网站 / 逐条三视图尚未接入。用量页仍是滚动 1h / 24h / 7d / 30d 和 host 默认排行，未实现今日 / 本周 / 本月 / 自选日期及完整保存设置。
5. **P2，主题与交互改进**：逐页核对暗 / 浅色、可读性、减少动态效果、低性能设备和离线资源；用户未列出的具体 bug 先复现。不要把“更多动画”代替完整主题细节。玻璃当前不支持真正桌面透视。
6. **P2，Mystery 接入**：取得旧桌面源码后实现主动绑定及统一账号；现有适配器不能证明旧客户端已接入。保持原网页视觉和业务权益。
7. **P2，构建可复现性**：补统一的固定资源获取 / 校验流程，扩大 Windows 安装验收；正式发行复用 Party 的运行依赖，与开发锁文件不同，升级依赖需核对。Linux 原生 sysproxy / Mihomo 获取及 GUI 验证尚缺，不能宣称已支持 Linux 发行。

## 6. 代码、服务和记录位置

| 位置                                                                                             | 用途                                                                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/main/core/`                                                                                 | Mihomo 进程 / Windows 服务、配置及生命周期                                             |
| `src/native/windows-service/NavioService.cs`                                                     | 服务宿主；`scripts/build-windows-service.cjs` 编译                                     |
| `src/native/sysproxy/`                                                                           | 原生 sysproxy 的 JS / 类型封装；没有完整 Rust 源码和 Linux 二进制                      |
| `src/main/config/`、`src/main/simple/`                                                           | 配置、订阅、本地覆写、简易编辑和有效配置编译                                           |
| `src/main/resolve/dex-account.ts`、`src/main/dex-legacy/`                                        | D.E.X 客户端、会话及兼容实现                                                           |
| `src/main/resolve/official-themes.ts`、`chromium-theme-fetch.ts`                                 | 官方主题安装与网络获取；同目录 `theme*.ts` 处理媒体与主题                              |
| `src/shared/official-themes.ts`、`scripts/theme-packages/`                                       | 主题目录、固定摘要及可发布 JSON 源文件                                                 |
| `src/renderer/src/components/dex/`                                                               | 工坊、场景、主题背景及材质控件（具体文件见目录）                                       |
| `src/renderer/src/pages/`                                                                        | home、proxies、bypass、connections、traffic、logs、network、dex-themes、account 等页面 |
| `src/main/traffic/`、`src/shared/trafficUsage.ts`、`src/renderer/src/utils/legacy-traffic-db.ts` | 实时流量及 SQLite / IndexedDB 历史，两条路径都需维护                                   |
| `src/main/resolve/update-*.ts`、`release-download.ts`                                            | 更新选择、下载、校验及退出更新                                                         |
| `src/main/resolve/tray*.ts`、`resources/`                                                        | 托盘状态与品牌资源                                                                     |
| `scripts/release-windows.cjs`、`package-pinned.cjs`                                              | 正式 Windows 发行、固定上游运行时重打包                                                |
| `DEX-BUILD.txt`、`NATIVE-BUILD.txt`、`PINNED-RESOURCES.json`、`third-party/`                     | 构建、固定资源及许可证来源                                                             |
| `tools/qa/`、`scripts/cloud/`                                                                    | 本轮保留的可复用桌面验证工具与源码检查入口                                             |

`PINNED-RESOURCES.json` 和第三方说明里的 `0.6.0-beta.1` 是资源批次的历史标记，不能当作当前软件版本。`scripts/service/IMPLEMENTATION-BOUNDARY.md` 是早期服务方案，已加历史状态说明。`Navio-验证记录.txt` 是较早 Beta 7 验证快照，最终公开主题下载验证晚于该文件，见下一节。

关联服务：

- `https://navio.mydex.top/api/v1`：账号、主题和版本 API；`https://navio.mydex.top/admin`：Navio 管理入口。
- `https://mydex.top`：D.E.X 总站；`https://mystery.mydex.top`：Mystery 网站；`https://admin.mydex.top/mystery` 和 `/mystery/app`：原网站 / 软件管理入口。
- 邮件为阿里云邮件推送，短信为阿里云号码认证，Google / GitHub 为 OAuth。历史上国内服务器到 Google 不通，使用 Cloudflare Pages 认证中转。只读连通性 probe 不提供登录功能，不能直接替代正式中转。
- 平台源码旧工作区相对位置：`outputs/dex-platform`，无 `.git`，`package.json` 版本 `0.7.0-beta.5`。主要为 `server/`、`public/`、`tests/`、`deploy/`、`legacy-integration/`；有明确私有部署边界，本次不公开。
- 部署约定路径为 `/opt/dex-platform/current`、`/etc/dex-platform/platform.env`、`/etc/caddy/Caddyfile`。没有把服务器配置、账号或密钥带入仓库。
- 平台和 Mystery 的独立仓库 URL 未核实；不要猜测或自行新建仓库。已知上游为 [mihomo-party-org/clash-party](https://github.com/mihomo-party-org/clash-party)、[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)，参考资料还有 Clash Verge Rev 2.5.10。

## 7. 工具、依赖、安装和命令

锁定依赖以 `pnpm-lock.yaml` 为准：Node.js 24（本机 24.22.1）、pnpm **11.8.0**、Electron 43.8.0、electron-vite 4.0.1、electron-builder 26.15.7、Vite 7.3.7、TypeScript 5.9.3、Vitest 4.1.10、React 19.3.1、Tailwind 4.3.3、HeroUI 2.8.10、ESLint 9.39.2、Prettier 3.9.10。本机全局 pnpm 曾为 11.25.0，不能以全局版本覆盖项目约定。Monaco 插件 patch 与 `pnpm-workspace.yaml` 必须保留。

### 云端源码环境

```bash
git switch codex/cloud-handoff-20261113
bash scripts/cloud/setup.sh
node scripts/cloud/check.mjs
```

setup 使用 Node 24、项目指定 pnpm 和 frozen lockfile，不运行依赖安装脚本；check 执行格式、Lint、类型、单元、打包逻辑测试和编译，不生成 Windows 安装包、不启动 GUI、不部署。工作流 `.github/workflows/cloud-handoff.yml` 为交接分支提供 Linux / Windows 源码检查。云环境和 GitHub Actions 是两个不同环境，CI 通过不表示已创建 Codex Cloud 环境。

按 [官方云环境说明](https://learn.chatgpt.com/docs/environments/cloud-environment)，在环境中选择**现有仓库和交接分支**，配置 Node 24，setup 填 `bash scripts/cloud/setup.sh`；缓存恢复的 maintenance 也可使用这个幂等依赖安装入口。初次安装需要访问包源。不要填写生产密钥；setup shell 的临时 export 不能作为后续任务配置。该官方页面当前标为 Legacy，实际控制台选项仍需核对。本轮没有代替用户创建或验证云环境，也没有跨账号授权 GitHub。

等价的手动检查：

```bash
pnpm install --ignore-scripts --frozen-lockfile
pnpm run hooks:install
pnpm run format:check
pnpm run lint:check
pnpm run typecheck
pnpm exec vitest run
node --test scripts/release-windows.test.cjs scripts/release-windows-safety.test.cjs
node --test tools/qa/common.test.cjs
pnpm run build
```

Windows 单测按现有 CI 排除 POSIX 用例：

```powershell
pnpm exec vitest run --exclude src/main/utils/app-info/linux.test.ts
```

遇到配置打包限制可用 `node scripts/build-native.mjs`，单编译 renderer 可加 `--scope renderer`。完整发行不能用仅 renderer 产物。`pnpm run lint` 含 `--fix`；检查时用 `lint:check`。不要绕过提交钩子。

### 本机启动和 Windows 发行

开发启动：准备固定资源后执行 `pnpm run dev`；该命令会检查 / 下载 Electron。运行前确认数据目录和网络设置，不能让测试读真实账号或订阅。

Windows 正式构建：

```powershell
node scripts/release-windows.cjs "<Party 参考包解压目录>" "<不存在的新发布目录>" "<不存在的新暂存目录>"
```

参考包必须是 [Clash Party 2.0.4 Windows x64 portable](https://github.com/mihomo-party-org/clash-party/releases/download/v2.0.4/clash-party-windows-2.0.4-x64-portable.7z)，大小 175672213 字节，SHA-256：

```text
182063a60b9a06535d176742d627f8b8c95a99aae85fc8752c880efee7da5157
```

包含 `Clash Party.exe`、完整 Electron 资源、`resources/app.asar`、`resources/files` 和 `resources/sidecar`。按 `DEX-BUILD.txt` 准备 `extra/files` / `extra/sidecar`，校验 pins，不用浮动 latest 替换。参考 `app.asar` 摘要为 `801ad4a2dfd770ae4007879d8cf2d5e4f19dbfc92b02703b30b908f846e75abe`。Navio 自己的包不能直接当作 Party 参考包。

脚本使用 Windows 自带 .NET Framework C# 编译器生成服务，复用上游运行依赖，再生成 EXE / ZIP 和摘要。`pnpm run build:win` 是另一套通用 electron-builder 配置，**不等同于正式发行入口**。完整上游资源、Windows / .NET 补丁未完全固定，输出还带时间戳，不能承诺字节级可复现。

数据目录：安装版 `%APPDATA%/DEX-STUDIO-NEXT`；便携版旁的同名目录。统一账号缓存另有当前用户下 `D.E.X/Accounts` 的加密 vault。仅设 `DEX_USER_DATA` 不会隔离这个共享目录；本轮 QA 工具同时隔离 Electron appData 及子进程 APPDATA / LOCALAPPDATA。测试保持系统代理 / TUN 关闭、关闭自动订阅更新；`DEX_TEST_MODE=1` 只跳过部分托盘 / 协议行为，**不阻止提权和网络修改**。详见 [tools/qa/README.md](../tools/qa/README.md)。

## 8. 验证事实与边界

### 已查阅的发布证据

- 基线提交对应的 GitHub Windows CI 已通过；格式、Lint、类型、单元和打包逻辑检查有记录。较早 `Navio-验证记录.txt` 写 928 通过 / 1 跳过，不将它冒充最终重跑计数。
- 旧工作区保留最终公开包验证结果：安装器载荷与便携 EXE / asar 一致，源码包逐个对照 596 个 Git blob；没有把原始运行路径及日志复制到公共仓库。
- 已查阅最终独立数据目录烟测记录：虚构账号连接本地测试平台、真实 Mihomo 导入及 loopback 转发、全局例外与规则恢复、19 页面无页面错误、24 主题试用恢复、18 个公开主题通过正式 IPC 下载并 SHA-256 校验缓存、实时流量 / 动效 IPC、800×600 无横向溢出、断开账号服务器后本地离线可用、Windows 系统代理登记值未变。
- 18 个官方主题附件在 GitHub 上的 digest 与仓库 JSON 已在交接审计中逐一核对；上游参考包公开元数据的大小 / 摘要与构建文档相同。没有重新下载 175 MB 参考包从零重建。
- 历史对话中用户反馈邮箱 / Google / GitHub、注册 / 找回密码流程通过，短信测试收到；本轮没有重测生产账号服务。

### 本轮验证记录

- 初始 Git 分支、remote、worktree、工作区和未推送提交审计完成，结果见第 1 节。
- GitHub Beta 7 有 25 个公开附件；公开平台状态与更新接口均返回 HTTP 200，分别自报 `0.7.0-beta.5` 和 `1.0.0-beta.6`。这只是只读状态核查，不是登录或部署验收。
- 当前源码 Lint 检查 0 error / 32 条既有 warning，两个 TypeScript 项目检查通过。
- 本机 Windows Vitest：81 个文件，944 项通过、1 项跳过；未启动真实桌面程序或重跑完整安装流程。
- Windows 打包安全 / 路径测试 10 项通过；新 QA 工具的 8 项入口 / 路径测试通过，格式检查通过。参数化后的 QA 工具尚未重新启动 EXE 或运行完整烟测。
- 新云检查入口的 8 项隔离回归测试、Node 语法与工作流触发 / 权限检查通过；没有把模拟命令分支检查称为 Linux 安装成功。
- 独立设计副本在 Edge 检查概览、代理组、订阅、连接、用量、日志、主题、账号 8 个页面，无脚本错误、无 HTTP 请求。
- 本轮 [GitHub Actions 43372778377](https://github.com/poniard-li/Navio/actions/runs/43372778377) 已全部通过，对应源码提交 `095e4d0feeaa5e74d1a4caef1d1c0760869caafa`：Ubuntu 24.04 和 Windows 2025 均完成全新 frozen 依赖安装、格式 / Lint / 类型、单元、打包逻辑及 QA 入口检查、完整源码编译。Linux 另通过 Bash 语法检查；现有本地 `file:` 依赖路径无需为安装而改写锁文件。之后的补充提交仅更新本文的验证记录，不改变已检查源码。

### 仍未验证

- 实际 Codex Cloud 环境首次安装和完整任务；Linux GUI、Linux / macOS 发行、对应原生模块。
- 完整 Windows 安装 / 升级 / 卸载 UI、TUN UAC 及服务实机安全边界；不能用编译或单元测试替代。
- 所有真实节点协议、运营商网络、IPv6、休眠和网络切换场景。
- 生产 SMTP / SMS / Google / GitHub、管理员永久删除及恢复、真实用户主题上传和配套更新元数据。本轮不读取真实数据库、不发短信、不删除账号。
- 所有历史功能完整性：有功能清单、代码及部分烟测，但没有逐项端到端验收。设计稿、说明和演示效果不是测试结果。

## 9. 本机独有材料与未迁移项

| 材料                                                                 | 本次处理 / 后续取得方式                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 当前桌面源码、配置模板、锁文件、patch、C# 服务源码                   | 已在仓库，本轮保留；不以旧输出目录覆盖                                                                                                |
| 当前认可的交互预览                                                   | 脱敏检查后保留 `design/navio-beta7-approved.html`，明确模拟数据及实现差异；旧预览留在本机                                             |
| 桌面烟测 / 主题网络验证源码                                          | 参数化后保留在 `tools/qa/`；不带账号、日志、浏览器会话、录屏或运行目录                                                                |
| 私有平台 `outputs/dex-platform`                                      | 源码、测试、模板及部署逻辑仍留本机；需要用户指定现有私有仓库或其他受控交接位置，再单独迁移。没有擅自创建新仓库或公开私有代码          |
| Mystery 源码和业务资料                                               | 旧桌面源码未取得；其他源码与仓库关系未完整核实，需项目所有者提供。不能靠 Navio 内的绑定入口补全                                       |
| Party 固定参考包及 `extra/`                                          | 不入源码 Git；按公开链接 + SHA 重新获取。原解压包在旧工作区 `work/reference-party-binary`；下载不可用时由维护者提供原包并核验         |
| `node_modules`、`out`、服务 EXE                                      | 可重新生成，不迁移 junction 或旧编译缓存                                                                                              |
| 已发布 EXE / ZIP / 源码 / 主题附件                                   | 保留在现有 GitHub Release，可下载核验，不重复提交大文件；本机多个旧构建候选不是正式产物                                               |
| 旧版本一次性发布 / 上传 / 管理脚本                                   | 留在旧工作区 `work/navio-publish`；含固定版本、资产 ID 和本地路径，不能直接重用。正式打包逻辑已入 Git，后续整理通用发布流程再单独审查 |
| 凭据、`.env`、vault、数据库、订阅、节点、私人媒体、账号 / 浏览器状态 | 明确不迁移到公开 Git。云端开发用虚构 fixture；必要测试密钥通过受控 secret 管理另配，不发送到聊天或仓库                                |
| 生产服务器、DNS、Cloudflare、邮件 / 短信 / OAuth 控制台              | 外部资源，不随 Git 迁移。运行环境配置及权限需所有者在对应平台单独授予；本轮未变更                                                     |

## 10. 云端接手顺序

其他旧预览、截图、图标生成及调试材料仍保留本机，不整批上传；当前正式图标和主题源文件已在 Git，选定设计参考和主要 QA 工具已单独保留。

1. 从现有仓库选择交接分支，检查 HEAD、remote、Git 状态；阅读本文件和 `AGENTS.md`。不要从旧目录名猜版本，不先切 main 覆盖工作。
2. 配 Node 24 / pnpm 11.8.0，运行 setup 和源码检查，记录平台和结果。若安装失败先看 frozen lockfile / 平台依赖，不能直接删除锁文件或更新全部包。
3. 对照设计参考与正式 `pages/`，先处理第 5 节 P1 隐私 / 数据保存审计，按已确认目标设计两种数据库的迁移，保持现有配置兼容。只有确实无法还原的其他历史选项才需要再确认。
4. 需要真实 Electron / TUN / 安装验收时转独立 Windows 环境，并用公开固定资源与独立测试数据；Linux 云端继续做可验证的源码工作。
5. 需要改账号、主题审核或版本后台时，先取得私有平台源码和受控测试环境；不将正式 API 当测试数据库。
6. 以新开发分支提交修改和验证说明；是否合并、发布及部署由新的任务授权决定。本次交接分支不执行这些操作。
