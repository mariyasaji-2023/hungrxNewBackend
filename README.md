# HungrX Backend

Express 5 + MongoDB (Mongoose) API for the HungrX app. Base path: `/api/v1`.
Architecture notes live in `CLAUDE.md`.

## Setup (first time)

```
npm install
```

Create these two files in the project root (both are gitignored):

- `.env`
- `serviceAccountKey.json` — Firebase Admin key for project `hungrx-new`
  (Firebase Console → Project settings → Service accounts → Generate new private key)

Example `.env`:

```
JWT_SECRET=<secret>
MONGO_URI=<mongodb connection string>
ADMIN_API_KEY=<key>
MAPBOX_TOKEN=<token>
# REVENUECAT_WEBHOOK_SECRET=<secret>   # webhook skips verification if unset

PORT=5001                  # optional, default 5000 (macOS AirPlay uses 5000)
DISABLE_SCHEDULERS=true    # optional, skips push reminder schedulers
```

## Start the server

```
cd hungrxNewBackend
npm start
```

Runs in the foreground; stop it with `Ctrl+C`.

To run in the background and keep logs in a file:

```
nohup node server.js > server.log 2>&1 &
```

Check that it is up (replace the port if you changed `PORT`):

```
curl http://localhost:5001/api/v1/health
```

Expected: `{"success":true,"message":"Server is running"}`

## Stop the server

Foreground: `Ctrl+C`.

Background (or if the terminal was closed), stop whatever is listening on the port:

```
lsof -ti :5001 | xargs kill
```

## Restart the server

The server does not auto-reload, so restart after any code or `.env` change:

```
lsof -ti :5001 | xargs kill; npm start
```

Background version:

```
lsof -ti :5001 | xargs kill; nohup node server.js > server.log 2>&1 &
```

Check the log:

```
tail -f server.log
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE` | Port is taken. Stop the old process (see above) or change `PORT`. |
| `Database connection failed` and exit | Wrong `MONGO_URI`, or Atlas IP allowlist blocks you. |
| Login returns 401 `Invalid token` | Check the server log for the real error. `invalid_grant: Invalid JWT Signature` means `serviceAccountKey.json` was revoked — generate a new key. |
| `Cannot find module './serviceAccountKey.json'` | Add the Firebase key file to the project root. |

## Safety when running locally

- If `MONGO_URI` points at the production database, every write (signups, food logs, promo redemptions) is real data. Use a test account.
- On boot the reminder schedulers run immediately and send real push notifications to real users. Set `DISABLE_SCHEDULERS=true` for any local run against shared or production data. Leave it unset in production.
- Never commit `.env` or `serviceAccountKey.json`.
