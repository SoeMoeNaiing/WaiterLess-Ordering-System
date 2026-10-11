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
