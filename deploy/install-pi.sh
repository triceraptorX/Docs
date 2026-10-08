#!/usr/bin/env bash
# Installe Notes locales comme service sur un Raspberry Pi (ou tout Debian/Ubuntu).
# À lancer depuis le dossier du projet, avec ton utilisateur normal (pas root) :
#   bash deploy/install-pi.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="$(id -un)"

if [ "$RUN_USER" = "root" ]; then
  echo "✗ Lance ce script avec ton utilisateur normal, pas en root (il utilisera sudo quand il faut)." >&2
  exit 1
fi

# 1. Node.js (version 18 minimum)
if ! command -v node >/dev/null 2>&1; then
  echo "→ Installation de Node.js…"
  sudo apt-get update
  sudo apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node.js $("$NODE_BIN" -v) est trop ancien (18 minimum). Mets à jour Raspberry Pi OS." >&2
  exit 1
fi
echo "✓ Node.js $("$NODE_BIN" -v)"

# 2. Compte d'accès
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/data/auth.json" ]; then
  (cd "$APP_DIR" && "$NODE_BIN" server.js --set-password)
else
  echo "✓ Compte déjà configuré (npm run set-password pour le changer)"
fi

# 3. Service systemd (démarrage automatique)
sed -e "s|__USER__|$RUN_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" \
  "$APP_DIR/deploy/notes.service" | sudo tee /etc/systemd/system/notes.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now notes.service
sudo systemctl restart notes.service
sleep 2

if systemctl is-active --quiet notes.service && curl -fsS -o /dev/null http://127.0.0.1:3000/login; then
  echo "✓ Notes locales tourne sur http://127.0.0.1:3000 et démarrera automatiquement au boot."
else
  echo "✗ Le service ne répond pas. Regarde les journaux : journalctl -u notes -n 50" >&2
  exit 1
fi
