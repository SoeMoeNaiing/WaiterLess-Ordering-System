# restaurant-server

LAN-only QR table ordering system. Customers connect to the restaurant Wi-Fi,
scan a table QR code, browse the menu, and place an order. Orders appear in
real time on the kitchen display. Payments happen at the counter.

## Requirements

- Node.js 20 LTS or newer
- Windows PC (server) with a static LAN IP
- Wi-Fi router with AP/client isolation **disabled**

## Setup

    npm install
    cp .env.example .env
    npm start

## Scripts

- `npm start` — run the server
- `npm test`  — run tests

## Status

Iteration 0.1 — project skeleton.

## Deployment (Fedora / Linux)

### systemd service

Install the unit file:

    sudo cp deploy/restaurant-server.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now restaurant-server

Check status:

    sudo systemctl status restaurant-server
    sudo journalctl -u restaurant-server -f

### Nightly backups

Backups run automatically via cron at 3:00 AM (see `crontab -l`).
They are stored in `data/backups/` and pruned after 7 days.

To run a backup manually:

    npm run backup

### Update the app

    cd ~/WaiterLess-Ordering-System/restaurant-server
    git pull
    npm install
    sudo systemctl restart restaurant-server
