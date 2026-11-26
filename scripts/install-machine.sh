#!/usr/bin/env bash
# Pasang / perbarui mesin reviewer Chef Juno di macOS dengan pola yang dianjurkan:
#   - daemon jalan dari clone khusus (default ~/.chefjuno/daemon) yang selalu di main — terpisah dari folder kerja,
#     jadi ngoding/ganti branch tidak pernah mengganggu mesin, dan pembaruan otomatis selalu bisa jalan;
#   - LaunchAgent `ai.chefjuno.daemon` (KeepAlive) menjalankan `chefjuno start`, log ke ~/.chefjuno/daemon.log.
# Kredensial mesin tetap di ~/.chefjuno/credentials.json (dari `chefjuno login`), tidak disentuh.
#
#   bash scripts/install-machine.sh [--agents claude,codex] [--no-app] [--dir <folder>] [--repo <git-url>]
#
# Aman dijalankan ulang. Daemon yang sedang jalan dihentikan saat LaunchAgent dimuat ulang; job yang terputus kembali
# ke antrean (lease habis) — jalankan saat mesin tidak sedang mengerjakan job.
set -euo pipefail

DIR="$HOME/.chefjuno/daemon"
REPO="https://github.com/NurFajarSA/chef-juno.git"
AGENTS="claude,codex"
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --agents) AGENTS="$2"; shift 2 ;;
    --no-app) EXTRA+=("--no-app"); shift ;;
    --dir) DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Opsi tidak dikenal: $1" >&2; exit 2 ;;
  esac
done

[ "$(uname)" = "Darwin" ] || { echo "Skrip ini untuk macOS (LaunchAgent). Di OS lain jalankan 'chefjuno start' lewat service manager setempat." >&2; exit 1; }

# 1) clone khusus mesin, selalu di main tanpa perubahan lokal
if [ -d "$DIR/.git" ]; then
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    echo "✗ $DIR punya perubahan lokal. Folder mesin tidak untuk ngoding — bereskan dulu (atau hapus foldernya)." >&2
    exit 1
  fi
  git -C "$DIR" fetch --quiet origin
  git -C "$DIR" switch --quiet main
  git -C "$DIR" merge --ff-only --quiet origin/main
else
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet --branch main "$REPO" "$DIR"
fi
echo "✓ clone mesin: $DIR @ $(git -C "$DIR" rev-parse --short HEAD)"

# 2) Node dari .nvmrc lewat nvm (dipasang bila belum ada)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] || { echo "✗ nvm belum terpasang (https://github.com/nvm-sh/nvm)." >&2; exit 1; }
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
cd "$DIR"
nvm install >/dev/null
nvm use >/dev/null
NODE="$(command -v node)"
echo "✓ node $("$NODE" -v) ($NODE)"

# 3) dependensi + build daemon
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent -w packages/shared -w apps/daemon
echo "✓ daemon ter-build"

[ -f "$HOME/.chefjuno/credentials.json" ] || {
  echo "✗ Mesin belum login. Buat kode di dashboard (Mesin → Tambah mesin), lalu:" >&2
  echo "  \"$NODE\" \"$DIR/apps/daemon/dist/cli.js\" login --server <functionsBaseUrl> --code XXXX-XXXX" >&2
  echo "  lalu jalankan skrip ini lagi." >&2
  exit 1
}

# 4) PATH untuk LaunchAgent: node + lokasi claude/codex + bawaan sistem
P="$(dirname "$NODE")"
for b in claude codex; do
  if command -v "$b" >/dev/null 2>&1; then P="$P:$(dirname "$(command -v "$b")")"; fi
done
P="$P:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LABEL="ai.chefjuno.daemon"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.chefjuno"
ARGS="<string>$NODE</string><string>$DIR/apps/daemon/dist/cli.js</string><string>start</string><string>--agents</string><string>$AGENTS</string>"
for e in "${EXTRA[@]+"${EXTRA[@]}"}"; do ARGS="$ARGS<string>$e</string>"; done
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>$ARGS</array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$P</string></dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/.chefjuno/daemon.log</string>
  <key>StandardErrorPath</key><string>$HOME/.chefjuno/daemon.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

# 5) muat ulang LaunchAgent
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ LaunchAgent $LABEL dimuat → log: ~/.chefjuno/daemon.log"
echo "  Mesin memperbarui dirinya sendiri setiap ada rilis daemon. Jangan ngoding di $DIR."
