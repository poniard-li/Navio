#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

TARGET=/opt/dex-themes
fail() { printf '\n未接入：%s\n' "$*" >&2; exit 1; }
[[ "${EUID}" -eq 0 ]] || fail '请使用 sudo bash 运行。'
[[ $# -ge 2 && $# -le 3 ]] || fail '用法：sudo bash /opt/dex-themes/server/connect-caddy.sh CADDY容器名 网络名 [容器内Caddyfile路径]'
CADDY_CONTAINER="$1"
CADDY_NETWORK="$2"
CADDY_CONFIG="${3:-/etc/caddy/Caddyfile}"
[[ "$CADDY_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || fail '容器名格式不正确。'
[[ "$CADDY_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || fail '网络名格式不正确。'
[[ "$CADDY_CONFIG" =~ ^/[a-zA-Z0-9_./-]+$ && "$CADDY_CONFIG" != *'/../'* ]] || fail '配置路径必须为容器内不含空格的绝对路径。'
[[ -f "$TARGET/.dex-themes-install" && "$(cat "$TARGET/.dex-themes-install")" == dex-themes-managed-v1 ]] || fail '请先运行安装脚本。'
[[ ! -L "$TARGET" && ! -L "$TARGET/server" && ! -L "$TARGET/server/.env" ]] || fail '安装目录出现符号链接，已停止。'
command -v docker >/dev/null 2>&1 || fail '未找到 Docker。'
docker compose version >/dev/null 2>&1 || fail '未找到 Docker Compose v2。'
DOCKER_ENDPOINT="${DOCKER_HOST:-$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')}"
[[ "$DOCKER_ENDPOINT" == unix://* ]] || fail '当前 Docker 指向远程主机，已停止。'
[[ "$(docker inspect --format '{{.State.Running}}' "$CADDY_CONTAINER" 2>/dev/null)" == true ]] || fail '指定的 Caddy 容器未运行。'
docker exec "$CADDY_CONTAINER" caddy version >/dev/null 2>&1 || fail '指定容器中未检测到 Caddy。'
docker network inspect "$CADDY_NETWORK" >/dev/null 2>&1 || fail '指定的 Docker 网络不存在。'
DRIVER="$(docker network inspect --format '{{.Driver}}' "$CADDY_NETWORK")"
[[ "$DRIVER" == bridge || "$DRIVER" == overlay ]] || fail '需选择可供独立容器加入的 bridge/overlay 网络，不能使用 host/none。'
MEMBER=0
while IFS= read -r network; do
  if [[ "$network" == "$CADDY_NETWORK" ]]; then MEMBER=1; fi
done < <(docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$CADDY_CONTAINER")
[[ "$MEMBER" -eq 1 ]] || fail '指定网络并未连接到该 Caddy 容器。'
while IFS= read -r peer; do
  [[ -n "$peer" ]] || continue
  PEER_PROJECT="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$peer")"
  while IFS= read -r alias; do
    if [[ "$alias" == dex-theme-api && "$PEER_PROJECT" != dex-themes ]]; then
      fail '该网络的 dex-theme-api 别名已被其他容器使用；未更改网络。'
    fi
  done < <(docker inspect --format "{{range (index .NetworkSettings.Networks \"$CADDY_NETWORK\").Aliases}}{{println .}}{{end}}" "$peer")
done < <(docker network inspect --format '{{range $id, $value := .Containers}}{{println $id}}{{end}}' "$CADDY_NETWORK")

OVERRIDE="$TARGET/server/compose.caddy-network.yaml"
[[ ! -L "$OVERRIDE" ]] || fail '网络配置文件是符号链接，已停止。'
if [[ -f "$OVERRIDE" ]] && ! head -n 1 "$OVERRIDE" | grep -qx '# Managed by D.E.X STUDIO connect-caddy.sh'; then
  fail '已有自定义网络配置，请人工核对后处理；脚本不会覆盖。'
fi
OVERRIDE_TEMP="$(mktemp "$TARGET/server/compose.caddy-network.yaml.XXXXXX")"
cat > "$OVERRIDE_TEMP" <<EOF
# Managed by D.E.X STUDIO connect-caddy.sh
services:
  themes:
    networks:
      dex-existing:
        aliases:
          - dex-theme-api
networks:
  dex-existing:
    external: true
    name: "$CADDY_NETWORK"
EOF
mv -- "$OVERRIDE_TEMP" "$OVERRIDE"
COMPOSE=(docker compose -p dex-themes --env-file "$TARGET/server/.env" -f "$TARGET/server/compose.yaml" -f "$OVERRIDE")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --no-build themes
THEME_CONTAINER="$("${COMPOSE[@]}" ps -q themes)"
[[ -n "$THEME_CONTAINER" ]] || fail '未找到已启动的主题容器。'
READY=0
for attempt in {1..20}; do
  if docker exec "$THEME_CONTAINER" node -e "fetch('http://127.0.0.1:17896/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[[ "$READY" -eq 1 ]] || fail '主题容器未通过健康检查；Caddy 配置未被修改。'

SNIPPET="$TARGET/server/caddy-dex-api.fragment"
[[ ! -L "$SNIPPET" ]] || fail 'Caddy 片段文件是符号链接，已停止。'
cat > "$SNIPPET" <<'EOF'
# Insert INSIDE the existing mydex.top site block, before the fallback route.
# Preserve all existing handlers; this is a fragment, not a replacement Caddyfile.
@dex_api_root path /dex-api
redir @dex_api_root /dex-api/ 308
handle_path /dex-api/* {
    reverse_proxy dex-theme-api:17896
}
EOF

printf '\n✓ 独立主题容器已加入 %s；现有 Caddy/盲盒容器未重启。\n' "$CADDY_NETWORK"
printf '\n请将下面片段插入已有 mydex.top { ... } 站点块，保留所有原有配置。\n'
printf '若原配置使用 route/handle，须让该路径先于兜底处理；不可替换整份文件。\n\n'
cat "$SNIPPET"
printf '\n指定 Caddy 容器的挂载位置（主机路径 -> 容器路径）：\n'
docker inspect --format '{{range .Mounts}}{{println .Source " -> " .Destination}}{{end}}' "$CADDY_CONTAINER"
printf '\n请在对应的主机挂载文件中备份并编辑配置，不要在容器临时层直接修改。\n'
if docker exec "$CADDY_CONTAINER" sh -c 'test -f "$1"' sh "$CADDY_CONFIG" >/dev/null 2>&1; then
  printf '\n确认已插入片段后执行以下命令；前项校验成功才会重载：\n'
  printf '  docker exec %q caddy validate --config %q --adapter caddyfile && docker exec %q caddy reload --config %q --adapter caddyfile\n' "$CADDY_CONTAINER" "$CADDY_CONFIG" "$CADDY_CONTAINER" "$CADDY_CONFIG"
else
  printf '\n未找到容器内配置 %s；不要运行猜测的 reload 命令。\n' "$CADDY_CONFIG"
  printf '确认实际 Caddyfile 路径后，把它作为本脚本第三个参数重跑即可。\n'
fi
printf '\n重载后验证：\n  curl --fail https://mydex.top/dex-api/health\n'
printf '成功后在桌面软件中填写：https://mydex.top/dex-api\n'
printf '\n片段保存在 %s。本脚本没有编辑或重载 Caddy 配置。\n' "$SNIPPET"
