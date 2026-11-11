# 参与 Navio 开发

当前支持目标是 Windows x64 Public Beta。提交问题或修改前，请确认所用版本，并先搜索已有 Issue。

## 提交问题

使用错误反馈或功能建议模板。请说明可复现步骤、期望与实际结果、Navio 和 Windows 版本。日志必须先脱敏：不要上传订阅链接、节点密码、访问令牌、验证码、完整账号数据库或私人网络信息。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发环境

需要 Node.js 24+ 和 `package.json` 指定的 pnpm 版本。安装依赖和提交钩子：

```powershell
pnpm install --ignore-scripts --frozen-lockfile
pnpm run hooks:install
```

固定内核和参考运行资源的准备方式见 [DEX-BUILD.txt](DEX-BUILD.txt)。源码快照不携带这些二进制。构建或运行程序前，应按该说明核对资源哈希；不要用浮动的 `latest` 文件替代固定资源。

不要直接编辑 `pnpm-lock.yaml`；依赖变更应通过 pnpm 更新锁文件。不要手工编辑 `extra/sidecar/`、`node_modules/.temp/` 等运行资源或生成目录，应按照构建说明重新准备资源。

## 检查与提交

每次提交前必须执行并通过：

```powershell
pnpm run format:check
pnpm run lint:check
pnpm run typecheck
```

提交钩子会执行以上三项检查。检查失败时应修复原因并重试；禁止使用 `git commit --no-verify`、`git push --no-verify` 或其他方式绕过钩子。

在 Windows 上运行单元测试：

```powershell
pnpm exec vitest run --exclude src/main/utils/app-info/linux.test.ts
```

被排除的文件使用 Linux/POSIX 路径语义；它不代表 Windows 功能的测试。修改相关平台代码时，应在对应平台验证。实际系统代理、TUN、自启动、服务安装和真实订阅的验证需单独说明，不能用模拟单元测试代替。

PR 应说明解决的问题、最终行为、验证结果和尚未覆盖的部分。保留开源来源与许可声明；不要绕过提交钩子，也不要提交 `node_modules`、`out`、`extra`、私密配置或测试账号。

## 文案与发布说明

界面、帮助和文档应直接说明功能、操作结果及必要限制，避免宣传口号、绝对保证和与使用无关的开发过程。代码注释说明约束与原因，保留必要的技术术语和来源署名。

发布说明列出新增功能、变更、修复、下载方式、许可和 SHA-256 校验值。测试细节和构建过程放在对应开发文档中。描述尚未提供的功能时明确标注状态，不以计划代替已实现的能力。
