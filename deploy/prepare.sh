#!/usr/bin/env bash
# Prepare an Ubuntu server (Oracle Cloud Always Free) to run the AI Chat SaaS.
# Run:   bash prepare.sh
set -e

APP_DIR="/home/ubuntu/aichat"   # <-- change to your user if not 'ubuntu'

echo "==> Installing Node 24 (needed for built-in node:sqlite) ..."
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

echo "==> Node version:"
node -v
npm -v

echo "==> Installing app dependencies ..."
cd "$APP_DIR"
npm install

echo "==> Done. Next steps:"
echo "   1. sudo cp deploy/aichat.service /etc/systemd/system/aichat.service"
echo "   2. sudo cp deploy/aichat.conf /etc/aichat.conf   (edit it, add your API key)"
echo "   3. sudo systemctl enable --now aichat"
echo "   4. sudo cp deploy/nginx.conf /etc/nginx/sites-available/default && sudo nginx -s reload"
echo "   5. sudo certbot --nginx -d divafits.com   (after your domain points to this server)"