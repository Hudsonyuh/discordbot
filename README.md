# Hudson Shop Discord Bot — v2

Tickets, staff delivery, moderation, recurring announcements, and quick answers to common shop questions. No paid AI API required.

## Run and verify

Use **Node 24 LTS** (minimum 22.12). Copy `.env.example` to `.env`, configure Discord credentials, then:

```sh
npm ci
npm run verify
npm start
```

Slash commands register at startup in guilds, restricted to `DISCORD_GUILD_ID` if set. To manage registration manually, set `AUTO_REGISTER_COMMANDS=false` and run `npm run deploy`. That script registers guild commands if `DISCORD_GUILD_ID` is set, otherwise global commands. Avoid registering both global and guild copies accidentally.

## Discord setup

Enable **Message Content Intent** in the Developer Portal for AutoMod and automatic FAQ replies. Enable **Server Members Intent** only when using `ENABLE_MEMBER_INTENT=true` for member-join welcomes. The join-system-message fallback remains available without that intent.

Invite with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Embed Links, Read Message History, Manage Messages, and Send Messages in Threads. Also grant Manage Channels for recreate mode, Manage Roles for delivery, and Mention Everyone only for announcement pings. The bot role must be above customer/product roles. Private tickets must allow the bot access.

| Command | User permission |
| --- | --- |
| `/clean` | Manage Messages or configured staff role |
| `/clear-all` | Manage Channels |
| `/deliver`, `/product-role` | Manage Roles; website-enabled delivery also requires Manage Server |
| Setup, announcements, AutoMod, welcome, manual ticket panel | Manage Server |
| FAQ configuration/custom answers | Manage Server |
| `/claim`, `/faq ask` | Any member |

These checks run inside the bot as well as Discord's command defaults. Delivery roles must be below the invoking member's highest role (server owner excepted), below the bot, and must not grant Administrator, Manage Roles, or Manage Server. The staff role alone no longer grants role-assignment/configuration authority. Discord may need a command override to expose `/clean` to staff without Manage Messages.

## Tickets and delivery

```text
/setup ticket-category category:<ticket category>
/setup ticket-parent channel:<parent for ticket threads>
/setup log-channel channel:<private staff log>
/setup staff-role role:<staff>
/setup customer-role role:<customer>
/product-role set product:Among Us role:<Among Us customer>
/setup tutorial-channel product:Among Us channel:<tutorial>
/setup vouches-channel channel:<vouches>
/setup status
```

Configure the categories/parents your existing ticket bot uses. The Hudson menu offers Purchase, Support, and Claim Product. It records support details and order claims; **staff still verify actual payments and customer identity before running `/deliver`**. The command grants roles and posts download/tutorial instructions. With website delivery enabled, it first invokes the shop admin's **Confirm & Deliver** action, which can issue access/keys and email through the website. It does not independently check bank or PayPal transactions. Claims belonging to another customer or already delivered are rejected. Public order references are masked; full references go to ephemeral responses and the private log.

### Website Confirm & Deliver

Configure these **secret Railway variables**, not source files:

```text
SHOP_DELIVERY_ENABLED=true
SHOP_ADMIN_EMAIL=<shop administrator email>
SHOP_ADMIN_PASSWORD=<shop administrator password>
SHOP_SUPABASE_URL=<the shop's authentication project URL>
SHOP_SUPABASE_ANON_KEY=<the shop's public authentication key>
```

`DISCORD_GUILD_ID` restricts website fulfillment to your server; optionally override that scope using `SHOP_DELIVERY_GUILD_ID`. Website fulfillment requires both Manage Roles and Manage Server. Do not give those permissions to untrusted staff.

```text
/deliver member:<customer> product:Among Us order-id:HUD-ABC123
```

The bot signs into the same shop admin backend, looks up the exact public order reference, checks the selected product, and calls the same server action as Payments → Confirm & Deliver. It then reads the order again and assigns Discord roles only after the website reports completed delivery. Staff are responsible for matching the selected Discord customer to the purchaser; the bot does not independently prove ownership of a receipt.

If the website is already delivered, the bot skips confirmation and synchronizes Discord access. If Discord fails after website success, fix role permissions and retry the same command. If the website result is uncertain, the bot records that state and refuses to repeat the mutation until staff resolve the order in Payments. This avoids automatically issuing duplicate keys or emails. Existing locally completed claims are not replayed against the website.

The integration discovers the current authenticated admin actions from the site's published client modules. A changed or unrecognized API stops delivery rather than guessing. Website secrets remain in Railway variables and short-lived sessions stay in memory. The startup connection check is read-only. No real customer order was confirmed during implementation testing.

Panel IDs persist across restarts. Configured categories are scanned at startup and active ticket threads every minute. Existing panels in the latest 100 messages are adopted; panels buried deeper can receive one replacement during migration. Archived threads are left alone. `/ticket-panel` deliberately posts a fresh menu to replace a deleted panel.

Name-based thread detection was removed: configure `/setup ticket-parent` explicitly. Uncategorized-channel handling remains opt-in and covers all new uncategorized text channels. Original tutorial/vouch IDs remain as defaults for this shop; change them through setup when needed.

## Automatic FAQ replies

Replies start **OFF**. Configure a channel first, then enable:

```text
/faq channel channel:<help channel> enabled:true
/faq toggle enabled:true
/faq status
/faq ask question:Where do I find my downloads?
/faq toggle enabled:false
```

The channel list is an allowlist; parent channels cover their threads. **Empty means all visible channels.** Removing the final channel returns to all channels. Turn replies off first if you want them nowhere.

Cooldowns: 60 seconds per user and repeated answer per channel, plus 15 seconds between any FAQ replies in a channel. Bots, webhooks, long messages, links, and quoted code are ignored. AutoMod runs first. Ambiguous/unrecognized questions get no automatic answer. `/faq ask` is private and works even when automatic replies are off.

### Menu keys and custom answers

The public website did **not** verify the opening key. Confirm it in the product tutorial, then configure it; use this example **only if Delete is correct**:

```text
/faq keybind product:Among Us key:Delete
/faq ask question:What key opens the Among Us menu?
/faq add id:among-us-setup title:Among Us setup triggers:install among us|among us installation answer:<verified instructions>
/faq remove id:among-us-setup
```

The bot uses the product named in the question or channel name; otherwise it asks which menu. Unconfigured keys direct users to tutorials/support. Up to 50 custom answers are supported. Separate trigger phrases with `|`; matching ignores punctuation/case and respects phrase boundaries. One matching custom answer overrides built-ins. Preview with `/faq ask`.

Built-in answers were reviewed on **2026-10-01** using the [FAQ](https://thehudsonshop.com/faq) and its public client content, [Among Us product page](https://thehudsonshop.com/order/among-us-private), and [Downloads](https://thehudsonshop.com/downloads). Availability questions link to [Status](https://thehudsonshop.com/status): the FAQ's availability statement conflicts with the Among Us product page. Prices, compatibility versions, and unverified keys are not hardcoded. This is a reviewed local knowledge base, not a live crawler; edit `src/faq.js` or add custom answers when details change.

## Recurring announcements

```text
/announce send channel:<announcements> message:An update is live!
/announce schedule channel:<announcements> hours:1 message:Visit the shop! send-now:true
/announce schedule channel:<announcements> hours:2 message:Need help? Open a ticket.
/announce schedule channel:<announcements> hours:3 message:Check Downloads for your products.
/announce list page:1
/announce edit id:ABC123 hours:2 message:Updated announcement text
/announce pause id:ABC123
/announce resume id:ABC123
/announce remove id:ABC123
```

Any whole-hour interval from 1–720 is supported, repeating indefinitely until paused/removed. `send-now:true` makes the first send due within 30 seconds. Changing the interval or resuming starts a fresh interval. `ping-everyone:true` requires Mention Everyone for both the invoking member and bot; other role/user mentions are suppressed.

Schedules survive restarts and skip missed intervals rather than replaying a backlog. The next run is reserved on disk before delivery to reduce duplicates. A crash between reservation and delivery can skip that occurrence; exactly-once delivery is not guaranteed. Failures back off and pause after five attempts. `/announce list` shows failures; fix permissions/destination, then resume.

Run **one bot instance / Railway replica** with this JSON backend. Multiple processes sharing a volume or overlapping deployments can conflict. Stop any local copy before running the hosted bot with the same token.

## Cleanup

```text
/clean amount:100
/clean amount:100 include-pinned:true
/clear-all method:preserve
/clear-all method:recreate
```

`/clean` supports 1–5000 messages and preserves pins by default. `/clear-all` includes pins and requires confirmation within two minutes. Preserve mode processes history up to the operation's start; new messages survive. Jobs cannot overlap in the same channel. Recent messages are bulk-deleted; messages older than Discord's bulk-delete window need slower individual requests. Progress updates periodically; final counts go to the log channel even if the interaction expires.

Recreate changes the channel ID and remaps this bot's announcements, welcome/log/FAQ channels, tutorials/vouches, and ticket parents. External ticket bots, webhooks, old links, and integrations still need their own references updated. Child threads are not migrated.

## Railway deployment and migration

1. Preserve the **existing Railway volume's `db.json`**. On the first v2 startup, the bot automatically creates `db.json.pre-v2.bak` beside it before migrating legacy data. The local empty data directory is not your production database.
2. Push source changes and the lockfile to the GitHub repository/branch connected to Railway (`Hudsonyuh/discordbot`, `main`).
3. Keep the existing persistent volume, normally `/app/data`, and set `DATA_DIR=/app/data`. Do not replace the production database with an empty local copy. Existing settings, claims, and announcements migrate without being reset.
4. Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATA_DIR`, and optional intent/registration flags in Railway Variables. Keep credentials there or in an ignored local `.env`, never in chat or Git.
5. Use Node 24, one replica, `npm start`, and health path `/health`. `railway.json` provides start/health/restart defaults. Railway supplies `PORT`. Health returns 503 before Discord is ready, then 200.
6. Check login/command registration logs and run `/setup status`, `/announce list`, `/faq status`.
7. Test a panel, FAQ reply, cleanup, and announcement in disposable channels. Verify delivery with a non-privileged product role and staff-approved test order.

To connect deployment, provide the **GitHub repository URL/branch** and **Railway project/service name/volume path**. Authenticate with those services' browser or CLI sign-in. Do not paste tokens or passwords. Alternatively, push the code yourself and let the existing Railway GitHub integration deploy.

## Tests

`npm run verify` checks syntax, validates all slash command definitions, and runs regression tests for cleanup, announcements, FAQs, permissions, migrations/backups, website order validation, single confirmation, and partial-failure recovery. `npm audit --omit=dev` checks dependencies. Automated tests do not make live Discord or payment requests; the separate live connection probe performs an authenticated read-only lookup.
