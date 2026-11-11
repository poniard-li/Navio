#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

# Filesystem writes stay inside this dedicated directory. Docker manages its own
# independent image, container and volume. Existing DEX/Caddy projects are untouched.
TARGET=/opt/dex-themes
PROJECT=dex-themes
MARKER=dex-themes-managed-v1
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)"

fail() { printf '\n安装未完成：%s\n' "$*" >&2; exit 1; }
trap 'printf "\n安装中止。原盲盒和 Caddy 未被修改；不要运行旧项目的 docker compose down。\n" >&2' ERR

[[ "${EUID}" -eq 0 ]] || fail '请使用 sudo bash server/install.sh，或在 root 终端运行。'
[[ "$(uname -s)" == Linux ]] || fail '本安装脚本只用于 Linux 云服务器。'
for command in docker ss curl install od tr; do
  command -v "$command" >/dev/null 2>&1 || fail "缺少命令 $command，请先在服务器安装它再重试。"
done
docker info >/dev/null 2>&1 || fail 'Docker 未运行，或当前用户无法访问 Docker。'
docker compose version >/dev/null 2>&1 || fail '需要 Docker Compose v2（docker compose 命令）。'
DOCKER_ENDPOINT="${DOCKER_HOST:-$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')}"
[[ "$DOCKER_ENDPOINT" == unix://* ]] || fail '当前 Docker 指向远程主机；请切回此服务器的本机 Docker。'

[[ ! -L "$TARGET" ]] || fail '/opt/dex-themes 是符号链接，已停止以避免修改其他目录。'
if [[ -e "$TARGET" && ! -d "$TARGET" ]]; then fail '/opt/dex-themes 已存在且不是目录。'; fi
if [[ -d "$TARGET" && -n "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  [[ -f "$TARGET/.dex-themes-install" && ! -L "$TARGET/.dex-themes-install" ]] || fail '/opt/dex-themes 已有其他内容；请先人工核对目录，脚本不会覆盖它。'
  [[ "$(cat "$TARGET/.dex-themes-install")" == "$MARKER" ]] || fail '目录标记不匹配，已停止。'
fi
for folder in server shared; do
  [[ ! -L "$TARGET/$folder" ]] || fail "$TARGET/$folder 是符号链接，已停止。"
done

OWN_IDS="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")"
if [[ -n "$OWN_IDS" && ! -f "$TARGET/.dex-themes-install" ]]; then
  fail 'Docker 中已存在名为 dex-themes 的其他 Compose 项目，脚本不会接管它。'
fi
PORT_IN_USE="$(ss -H -ltn 'sport = :17896')"
if [[ -n "$PORT_IN_USE" ]]; then
  OWN_RUNNING="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=themes' --filter 'publish=17896')"
  [[ -n "$OWN_RUNNING" && -f "$TARGET/.dex-themes-install" ]] || fail '17896 端口已被其他程序占用；未停止该程序，请先核对端口。'
fi

for file in server/index.cjs server/Dockerfile server/compose.yaml shared/themes.cjs; do
  [[ -f "$SOURCE_ROOT/$file" && ! -L "$SOURCE_ROOT/$file" ]] || fail "安装包不完整：缺少 $file。"
done
install -d -m 755 "$TARGET" "$TARGET/server" "$TARGET/shared"
for filename in .dockerignore server/index.cjs server/Dockerfile server/compose.yaml server/.env.example server/DEPLOY.txt server/theme.example.json server/install.sh server/connect-caddy.sh server/安装步骤.txt shared/themes.cjs server/compose.caddy-network.yaml; do
  [[ ! -L "$TARGET/$filename" ]] || fail "$TARGET/$filename 是符号链接，已停止。"
done
if [[ "$SOURCE_ROOT" != "$TARGET" ]]; then
  for file in index.cjs Dockerfile compose.yaml .env.example DEPLOY.txt theme.example.json install.sh connect-caddy.sh 安装步骤.txt; do
    if [[ -f "$SOURCE_ROOT/server/$file" ]]; then install -m 644 "$SOURCE_ROOT/server/$file" "$TARGET/server/$file"; fi
  done
  install -m 644 "$SOURCE_ROOT/shared/themes.cjs" "$TARGET/shared/themes.cjs"
fi
printf '%s\n' "$MARKER" > "$TARGET/.dex-themes-install"
printf 'server/.env\nserver/*.private\nserver/data/\n' > "$TARGET/.dockerignore"

if [[ -L "$TARGET/server/.env" ]]; then fail 'server/.env 是符号链接，已停止。'; fi
if [[ ! -f "$TARGET/server/.env" ]]; then
  UPLOAD_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  ADMIN_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  [[ ${#UPLOAD_SECRET} -eq 64 && ${#ADMIN_SECRET} -eq 64 && "$UPLOAD_SECRET" != "$ADMIN_SECRET" ]] || fail '随机令牌生成失败。'
  printf 'UPLOAD_TOKEN=%s\nADMIN_TOKEN=%s\nCORS_ORIGINS=\n' "$UPLOAD_SECRET" "$ADMIN_SECRET" > "$TARGET/server/.env"
  unset UPLOAD_SECRET ADMIN_SECRET
fi
chmod 600 "$TARGET/server/.env"

COMPOSE=(docker compose -p "$PROJECT" --env-file "$TARGET/server/.env" -f "$TARGET/server/compose.yaml")
if [[ -f "$TARGET/server/compose.caddy-network.yaml" ]]; then COMPOSE+=(-f "$TARGET/server/compose.caddy-network.yaml"); fi
"${COMPOSE[@]}" config --quiet
printf '\n正在启动独立主题服务（首次需要下载 Node 镜像）……\n'
"${COMPOSE[@]}" up -d --build

HEALTHY=0
for attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:17896/health >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 2
done
[[ "$HEALTHY" -eq 1 ]] || fail '主题服务未通过本机健康检查。可运行 docker compose -p dex-themes --env-file /opt/dex-themes/server/.env -f /opt/dex-themes/server/compose.yaml logs --tail=30 themes 检查。'

printf '\n✓ 主题服务已安装并通过本机健康检查。\n'
printf '  目录：/opt/dex-themes\n  本机入口：http://127.0.0.1:17896\n'
printf '  令牌已安全生成到 /opt/dex-themes/server/.env（权限 600，未显示）。\n'
printf '  https://mydex.top/dex-api 仍需接入 Caddy；当前尚未公开。\n\n'
printf '可能的 Caddy 容器（名称 | 镜像 | 网络）：\n'
FOUND=0
while IFS='|' read -r cname cimage cnet cports; do
  if [[ "$cname $cimage" == *caddy* || "$cports" == *443* ]]; then
    printf '  %s | %s | %s\n' "$cname" "$cimage" "$cnet"
    FOUND=1
  fi
done < <(docker ps --format '{{.Names}}|{{.Image}}|{{.Networks}}|{{.Ports}}')
if [[ "$FOUND" -eq 1 ]]; then
  printf '\n下一步：从上面选择实际 Caddy 容器名及它的一个网络名，执行：\n'
  printf '  sudo bash /opt/dex-themes/server/connect-caddy.sh CADDY容器名 网络名\n'
  printf '脚本会接入主题服务，并给出应插入的 Caddy 片段及校验命令。\n'
else
  printf '  未找到候选容器。若 Caddy 在主机运行，请按 DEPLOY.txt 方案 A 添加路径分流。\n'
fi
printf '\n需要我继续协助时，可发送上面的容器/网络列表；不要发送 .env 或令牌。\n'
