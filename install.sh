#!/usr/bin/env bash
# =====================================================================
#  SMARTFUZE AQUA - cloud installer (Ubuntu 24.04 / 22.04)
#  Run in the DigitalOcean Droplet Console:
#    curl -fsSL https://raw.githubusercontent.com/<USER>/<REPO>/main/cloud/install.sh | sudo REPO=<USER>/<REPO> bash
#  Safe to run again (it keeps existing data and logins).
# =====================================================================
set -euo pipefail

REPO="${REPO:-}"
BRANCH="${BRANCH:-main}"
APP=/opt/aqua
DATA=/var/lib/aqua
ETC=/etc/aqua
TZNAME="${TZNAME:-Asia/Kuala_Lumpur}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m错误：%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（命令里要有 sudo）"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "只支持 Ubuntu（建议 24.04 LTS）"
[ -n "$REPO" ] || die "命令里缺少 REPO=你的GitHub用户名/仓库名"
exec 3</dev/tty || die "请在服务器的 Console 窗口里直接运行"

ask()   { local v; read -r -p "$1" v <&3; printf '%s' "$v"; }
askpw() { local v; read -r -s -p "$1" v <&3; printf '\n' >&2; printf '%s' "$v"; }

echo
echo "=============================================="
echo "   SMARTFUZE AQUA 云端安装"
echo "=============================================="
echo "只需要回答 3 个问题，其余全部自动完成（约 5 到 10 分钟）。"
echo

SUB="$(ask '1/3  DuckDNS 名字（只填前面部分，例如 myshrimp）: ')"
SUB="${SUB%%.duckdns.org}"
SUB="$(printf '%s' "$SUB" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
[ -n "$SUB" ] || die "DuckDNS 名字不能为空"
TOKEN="$(ask '2/3  DuckDNS token（网页上方那串字母数字）: ')"
TOKEN="$(printf '%s' "$TOKEN" | tr -cd 'a-fA-F0-9-')"
[ -n "$TOKEN" ] || die "token 不能为空"

if [ -f "$DATA/state.json" ] && grep -q '"username": "admin"' "$DATA/state.json"; then
  CHANGE_PW="$(ask '3/3  已有登录密码。要重新设置吗？(y/N): ')"
else
  CHANGE_PW=y
fi
PW=""
if [ "$CHANGE_PW" = "y" ] || [ "$CHANGE_PW" = "Y" ]; then
  while :; do
    PW="$(askpw '3/3  设置仪表盘登录密码（至少 10 位，输入时不会显示）: ')"
    [ "${#PW}" -ge 10 ] || { warn "密码太短，至少 10 位"; continue; }
    PW2="$(askpw '      再输入一次: ')"
    [ "$PW" = "$PW2" ] && break
    warn "两次输入不一样，请重新输入"
  done
fi
DOMAIN="$SUB.duckdns.org"

step "1/8 设置时区：$TZNAME"
timedatectl set-timezone "$TZNAME" || warn "时区设置失败（不影响运行）"

step "2/8 让 $DOMAIN 指向这台服务器"
R="$(curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=" || true)"
[ "$R" = "OK" ] || die "DuckDNS 更新失败。请检查名字和 token 是否正确（返回：$R）"
printf '*/5 * * * * root curl -fsS "https://www.duckdns.org/update?domains=%s&token=%s&ip=" >/dev/null 2>&1\n' "$SUB" "$TOKEN" > /etc/cron.d/aqua-duckdns
chmod 600 /etc/cron.d/aqua-duckdns
ok "DuckDNS 已更新"

step "3/8 安装所需软件（Node.js、Caddy、防火墙）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl tar ufw gnupg
apt-get install -y nodejs npm || true
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "系统自带 Node.js 太旧，改用 NodeSource 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v npm >/dev/null || die "npm 安装失败"
if ! apt-get install -y caddy; then
  warn "改用 Caddy 官方软件源"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
ok "Node.js $(node -v)，$(caddy version | head -n1)"

step "4/8 下载 AQUA 程序（$REPO）"
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$TMP" --strip-components=1 \
  || die "下载失败。请确认 GitHub 仓库是 Public，名字是 $REPO"
[ -f "$TMP/server.js" ] || die "仓库最外层没有 server.js。上传时要上传压缩包里面的文件，不是外层文件夹"
id aqua >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin aqua
mkdir -p "$DATA" "$ETC/tls" /var/backups/aqua
rm -rf "$APP.new"; mkdir -p "$APP.new"
cp -a "$TMP"/. "$APP.new"/
rm -rf "$APP.new/data" "$APP.new/node_modules" "$TMP"
( cd "$APP.new" && { npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund; } ) || die "依赖安装失败"
rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"; mv "$APP.new" "$APP"
chown -R root:root "$APP"
chown -R aqua:aqua "$DATA"
chown root:aqua "$ETC/tls"; chmod 750 "$ETC/tls"
printf '%s\n%s\n' "$REPO" "$BRANCH" > "$ETC/repo"
ok "AQUA 已安装到 $APP"

step "5/8 写入配置、登录密码和设备账号"
cat > "$ETC/aqua.env" <<ENV
AQUA_MODE=cloud
AQUA_DATA_DIR=$DATA
AQUA_HTTP_HOST=127.0.0.1
AQUA_HTTP_PORT=3000
AQUA_MQTT_HOST=127.0.0.1
AQUA_MQTT_PORT=1883
AQUA_MQTTS_PORT=8883
AQUA_TLS_CERT=$ETC/tls/cert.pem
AQUA_TLS_KEY=$ETC/tls/key.pem
AQUA_PUBLIC_HOST=$DOMAIN
AQUA_PUBLIC_URL=https://$DOMAIN
TZ=$TZNAME
ENV
systemctl stop aqua 2>/dev/null || true
if [ -n "$PW" ]; then
  runuser -u aqua -- env AQUA_DATA_DIR="$DATA" AQUA_NEW_PASSWORD="$PW" node "$APP/tools/admin.js" set-password admin >/dev/null
  ok "登录密码已设置（用户名 admin）"
fi
DEV_OUT="$(runuser -u aqua -- env AQUA_DATA_DIR="$DATA" node "$APP/tools/admin.js" add-device POND-A dev-pond-a)"
DEV_USER="dev-pond-a"; DEV_PASS=""
case "$DEV_OUT" in
  CREATED*) DEV_PASS="$(printf '%s' "$DEV_OUT" | awk '{print $3}')" ;;
  EXISTS*)  DEV_PASS="(沿用第一次安装时的密码，见 /root/aqua-setup.txt；忘记了可在仪表盘 Settings > Device logins 重新建立)" ;;
esac

step "6/8 HTTPS 证书和防火墙"
cat > /etc/caddy/Caddyfile <<CADDY
{
	key_type rsa2048
	cert_issuer acme
}
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 8883/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

cat > /usr/local/bin/aqua-cert-sync <<SYNC
#!/bin/sh
# Copy Caddy's Let's Encrypt certificate for $DOMAIN to AQUA (for encrypted MQTT on 8883).
SRC=\$(find /var/lib/caddy -path '*certificates*' -name '$DOMAIN.crt' 2>/dev/null | head -n1)
[ -n "\$SRC" ] || exit 0
KEY="\${SRC%.crt}.key"
if ! cmp -s "\$SRC" $ETC/tls/cert.pem 2>/dev/null; then
  install -m 640 -o root -g aqua "\$KEY" $ETC/tls/key.pem
  install -m 640 -o root -g aqua "\$SRC" $ETC/tls/cert.pem
fi
SYNC
chmod 755 /usr/local/bin/aqua-cert-sync
echo "等待证书签发（最多 3 分钟）..."
for _ in $(seq 1 36); do
  /usr/local/bin/aqua-cert-sync
  [ -s "$ETC/tls/cert.pem" ] && break
  sleep 5
done
if [ -s "$ETC/tls/cert.pem" ]; then ok "HTTPS 证书已就绪"; else warn "证书还没签发。AQUA 会每小时自动重试，通常几分钟内完成。"; fi

step "7/8 开机自启、证书自动更新、每日备份"
cat > /etc/systemd/system/aqua.service <<UNIT
[Unit]
Description=SMARTFUZE AQUA
After=network-online.target
Wants=network-online.target

[Service]
User=aqua
Group=aqua
EnvironmentFile=$ETC/aqua.env
WorkingDirectory=$APP
ExecStart=/usr/bin/env node $APP/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/aqua-cert-sync.service <<UNIT
[Unit]
Description=Copy HTTPS certificate to SMARTFUZE AQUA
[Service]
Type=oneshot
ExecStart=/usr/local/bin/aqua-cert-sync
UNIT
cat > /etc/systemd/system/aqua-cert-sync.timer <<UNIT
[Unit]
Description=Hourly certificate copy for SMARTFUZE AQUA
[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
UNIT
cat > /usr/local/bin/aqua-backup <<'BK'
#!/bin/sh
# Daily backup of all AQUA data, 14 days kept in /var/backups/aqua
set -e
tar czf "/var/backups/aqua/aqua-$(date +%F).tar.gz" -C /var/lib aqua
find /var/backups/aqua -name 'aqua-*.tar.gz' -mtime +14 -delete
BK
chmod 755 /usr/local/bin/aqua-backup
cat > /etc/systemd/system/aqua-backup.service <<UNIT
[Unit]
Description=SMARTFUZE AQUA daily backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/aqua-backup
UNIT
cat > /etc/systemd/system/aqua-backup.timer <<UNIT
[Unit]
Description=SMARTFUZE AQUA daily backup at 03:30
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
install -m 755 "$APP/cloud/aqua-update" /usr/local/bin/aqua-update
install -m 755 "$APP/cloud/aqua-reset-password" /usr/local/bin/aqua-reset-password
systemctl daemon-reload
systemctl enable --now aqua-cert-sync.timer aqua-backup.timer >/dev/null 2>&1
systemctl enable aqua >/dev/null 2>&1
systemctl restart aqua

step "8/8 检查"
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/api/auth/status >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/auth/status >/dev/null 2>&1 && ok "AQUA 运行中" || die "AQUA 没有启动。运行 journalctl -u aqua -n 50 查看原因"
if curl -fsS "https://$DOMAIN/api/auth/status" >/dev/null 2>&1; then ok "https://$DOMAIN 可以访问"; else warn "https://$DOMAIN 暂时打不开，等证书签发后（几分钟）再试"; fi

SUMMARY=/root/aqua-setup.txt
{
  echo "SMARTFUZE AQUA 云端安装结果  $(date '+%F %T')"
  echo
  echo "【手机 / 电脑打开】 https://$DOMAIN"
  echo "  用户名：admin    密码：你刚才设置的密码"
  echo
  echo "【ESP32 固件里填写】"
  echo "  #define USE_TLS 1"
  echo "  MQTT_HOST = \"$DOMAIN\""
  echo "  MQTT_PORT = 8883"
  echo "  MQTT_USER = \"$DEV_USER\""
  echo "  MQTT_PASS = \"$DEV_PASS\""
  echo "  SITE_ID   = \"SITE-01\""
  echo "  POND_ID   = \"POND-A\""
  echo "  DEVICE_ID = \"AQUA-POND-A-01\""
  echo
  echo "【常用命令】"
  echo "  更新程序：      sudo aqua-update"
  echo "  忘记登录密码：  sudo aqua-reset-password"
  echo "  查看运行记录：  journalctl -u aqua -n 100"
  echo "  每日备份位置：  /var/backups/aqua （保留 14 天）"
} > "$SUMMARY"
chmod 600 "$SUMMARY"

echo
echo "=============================================="
ok "   安装完成！"
echo "=============================================="
cat "$SUMMARY"
echo
warn "请拍照或抄下上面的 ESP32 资料（设备密码只显示这一次）。以后可用 cat /root/aqua-setup.txt 再看。"
