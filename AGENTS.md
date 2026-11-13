# Navio 开发约定

先读 [docs/CLOUD_HANDOFF.md](docs/CLOUD_HANDOFF.md)、[CONTRIBUTING.md](CONTRIBUTING.md) 和 [DEX-BUILD.txt](DEX-BUILD.txt)。交接记录区分实际代码、历史验证和待办；设计参考不是实现证明。

- 当前发行目标为 Windows x64。Linux 可做源码检查和编译；不要把 Linux 单测通过写成 Windows 安装、TUN 或服务验收通过。
- 使用 Node.js 24 和 `package.json` 固定的 pnpm；依赖安装使用 `--ignore-scripts --frozen-lockfile`。不要上传或复用其他电脑的 `node_modules`。
- 提交前运行 `pnpm run format:check`、`pnpm run lint:check`、`pnpm run typecheck`，并运行与修改相关的测试。保留提交钩子，不绕过失败检查。`pnpm run lint` 会修改文件。
- 运行桌面测试时使用独立临时数据目录、虚构账号和本地测试服务。默认关闭系统代理、TUN、订阅自动更新。`DEX_TEST_MODE=1` 不是阻止网络设置变更的安全沙箱。
- 保留订阅、规则和用户修改；不要操作真实用户目录、生产数据库或系统服务来完成源码测试。
- 此仓库公开。不要提交密钥、真实订阅/节点、账号数据、运行日志、完整对话或私有平台源码。私有平台不在当前 Git 仓库，见交接清单。
- 保留上游来源、GPL 许可及第三方声明。界面及发布说明采用直接、具体的表述；未完成的功能不能写成已实现。
- 不因开发任务自动发布 Release、部署服务、合并到 main 或改写远程历史；这些操作需要当前任务的明确授权。

云端源码检查入口：`bash scripts/cloud/setup.sh`，随后 `node scripts/cloud/check.mjs`。实际 Windows 发行入口仍是 `scripts/release-windows.cjs`。
