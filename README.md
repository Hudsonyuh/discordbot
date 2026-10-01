# Hudson Shop Discord Bot

A custom Discord management bot for **TheHudsonShop.com**.

## Included

- `/clean amount:` deletes a chosen number of messages, including messages older than Discord's 14-day bulk-delete window.
- `/clear-all` can preserve the current channel ID or recreate the channel for an instant clean reset.
- `/claim order-id:` submits an order ID for **manual staff review**. The bot does not connect to PayPal and does not automatically approve payment.
- Ticket integration for your existing ticket bot with **Purchase / Support / Claim Product** buttons.
- AutoMod for spam, repeat-message spam, mention spam, `check my bio`, suspicious giveaway/MrBeast links, impersonation-style links, and custom blocked phrases/domains.
- Recurring announcements every 1–720 hours with optional `@everyone`.
- Private moderation and claim-request logs.
- JSON persistence for settings, announcements, and submitted order IDs.
- `GET /health` endpoint for Railway health checks.

## Discord setup

Enable **MESSAGE CONTENT INTENT** in the Discord Developer Portal so AutoMod can inspect messages.

Invite the bot with the `bot` and `applications.commands` scopes. Recommended permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Messages
- Manage Channels (for `/clear-all` recreate mode)
- Mention Everyone (only if you want announcement pings)

## Environment variables

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
STORE_URL=https://thehudsonshop.com
WEB_PORT=3000
```

Never commit `.env` or your Discord bot token.

## Install / run

```bash
npm install
npm run deploy
npm start
```

`npm run deploy` registers the slash commands. Run it again after changing command definitions.

## Initial server setup

```text
/setup ticket-category category:<your ticket category>
/setup log-channel channel:<private bot logs>
/setup staff-role role:<staff role>
/setup status
```

Use `/setup ticket-category` once for each category your existing ticket system creates channels inside. New channels under those categories automatically receive the Hudson Shop ticket menu.

You can also manually post the menu with `/ticket-panel`.

## Claim flow

Customers can use:

```text
/claim order-id:YOUR-ORDER-ID
```

or press **Claim Product** in a ticket and enter the order ID.

The bot records the ID as **pending staff review**, posts a confirmation in the ticket, and sends the full order ID to the configured private log channel. The same order ID cannot be submitted twice unless you remove it from the data store manually.

This intentionally does **not** verify PayPal and does **not** auto-grant a customer role. Staff checks the order manually before giving the product.

## AutoMod

```text
/setup automod enabled:true
/automod add-phrase phrase:check my profile
/automod add-domain domain:fake-giveaway.example
/automod status
```

Staff, administrators, and members with Manage Messages bypass AutoMod.

## Announcements

```text
/announce send channel:#announcements message:New update is live! ping-everyone:true
/announce schedule channel:#announcements hours:24 message:Check out TheHudsonShop.com ping-everyone:true
/announce list
/announce remove id:ABC123
```

## Railway

Use Node 20+, start command `npm start`, and healthcheck path `/health`. Register commands once with `npm run deploy` after the service has its Discord variables.

The bot stores settings/claim IDs in `data/db.json`. Railway should mount a persistent volume at `/app/data`.
