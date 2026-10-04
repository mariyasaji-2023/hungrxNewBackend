# HungrX Backend — AI Context

REST API for **HungrX**, a restaurant-calorie-tracking mobile app (Flutter client at `/Users/anonymous/development/hungrx`).
Users sign in with Firebase (Google/Apple), log restaurant dishes, track calories/macros against computed goals, get push reminders, and pay via RevenueCat.

## Stack
- Node.js, CommonJS (`require`), **Express 5**, **Mongoose 9** (MongoDB), `firebase-admin` (ID-token verification + FCM), `jsonwebtoken`, `uuid`, `dotenv`.
- No tests, no linter, no TypeScript, no build step. `npm start` → `node server.js`.
- Server listens on `process.env.PORT` (default **5000**; `server.js`). On macOS port 5000 is taken by AirPlay Receiver, so set `PORT=5001` locally. Production sits behind a proxy at `https://new.hungrx.xyz` (DigitalOcean). `API_TESTING.md` mentions `143.198.10.72:8080` (old/droplet).

## Layout (each dir has its own README.md)
| Dir | Purpose |
|---|---|
| `server.js` | Entry: dotenv → `connectDB()` → mount routes under `/api/v1/*` → listen on `PORT` → start 2 schedulers (unless `DISABLE_SCHEDULERS=true`) |
| `routes/` | One Express router per feature. Handlers hold all business logic (no controller layer) → [routes/README.md](routes/README.md) |
| `models/` | Mongoose schemas → [models/README.md](models/README.md) |
| `middleware/` | `auth.js` (user JWT), `adminAuth.js` (x-admin-key) → [middleware/README.md](middleware/README.md) |
| `services/` | FCM sender + reminder schedulers → [services/README.md](services/README.md) |
| `utils/` | `nutrition.js` calorie/macro goal math, `menuMapper.js` restaurant menu mapping → [utils/README.md](utils/README.md) |
| `config/db.js`, `firebase.js` | Mongo connect, Firebase Admin init → [config/README.md](config/README.md) |
| `script.js`, `olive_garden_migration.py` | One-off ops scripts (not part of the server) |
| `API_DOCUMENTATION.md`, `API_TESTING.md` | Older human docs; **partly stale** (e.g. says `/foodlog/addFoodLog`; real route is `/food-log`). Trust the code. |

## Environment variables (`.env`, gitignored)
`MONGO_URI`, `JWT_SECRET`, `ADMIN_API_KEY`, `MAPBOX_TOKEN`, `REVENUECAT_WEBHOOK_SECRET`.
Optional: `PORT` (default 5000), `DISABLE_SCHEDULERS=true` (skips both reminder schedulers at boot — set it for any local run against a shared/prod DB; leave unset in production).
Also needs `serviceAccountKey.json` at repo root (Firebase service account; gitignored). Note: the repo currently has a committed file named `serviceAccountKey.json.json` — `firebase.js` requires `./serviceAccountKey.json`, so on a fresh checkout it must be provided/renamed.

## Run locally
```
npm install
# create .env + serviceAccountKey.json
npm start            # http://localhost:<PORT>/api/v1/health (default 5000)
```
Startup calls `connectDB()` which `process.exit(1)` on failure. Schedulers start on boot and run an immediate check, so **a local server pointed at the prod DB will send real pushes** unless `DISABLE_SCHEDULERS=true` is set (or use a separate dev DB).

## Request/response conventions
- Base path `/api/v1`. JSON bodies. Responses: `{ success: true, data?, message? }` / `{ success: false, message }`.
- Restaurant endpoints use a different error shape: `{ success:false, error:{ code, message } }` (codes: `LOCATION_REQUIRED`, `LIMIT_EXCEEDED`, `INVALID_CURSOR`, `RESTAURANT_NOT_FOUND`).
- `/subscription/verify-promo` responds `{ valid, message }` instead of `success`.
- User auth: `Authorization: Bearer <app JWT>`; JWT payload `{ id, email, name }`, 7-day expiry, read as `req.user.id`. Frontend auto-logs-out on any 401.
- Dates: food-log `date` is a `"YYYY-MM-DD"` **string**, computed server-side with `new Date().toISOString()` → **UTC date**, not user-local.

## Auth flow
1. App signs in with Firebase → sends Firebase `idToken` to `POST /auth/login` (existing user) or `POST /auth/signup` (with onboarding data).
2. Server verifies via `admin.auth().verifyIdToken(token, true)`, looks up/creates `User` by `firebaseUid`, returns app JWT + `userId`.
3. All other user endpoints use the app JWT. `login` returns 404 if the user doesn't exist (client must sign up).

## Domain notes
- **Restaurants collection is schemaless** (`strict:false`) and pre-populated outside this API (migration scripts/Mongo). Menu shape: `categories[] → dishes[] | subCategories[].dishes[] → servingInfos[].servingInfo{size, Url, nutritionFacts{...}}`. Code defensively accepts alternate keys (`dishName|name`, `dishes|items`, `subcategories|subCategories`, `servingInfos|sizes`). No endpoint creates restaurants.
- **Public preview** `GET /restaurants/preview` (no JWT, rate-limited, cached) feeds the Flutter pre-signup Sneak Peek screen with a fixed featured list.
- **Nearby restaurants** = Mapbox Search Box POIs around lat/lon, name-matched (fuzzy prefix) against DB restaurants; only matches are returned.
- **Subscriptions** have three overlapping mechanisms: legacy 7-day in-app trial (`/free-trial`), RevenueCat 3-day annual trial reported by client (`/trial-started`, drives trial reminder push), and admin-generated promo codes (`/admin/promo-codes` create, `/subscription/verify-promo` redeem). RevenueCat webhook sets `plan` pro/free.
- **Nutrition goals** are computed server-side at signup and profile update (Mifflin-St Jeor + activity multiplier + pace; macros 30/45/25). See utils README.
- **Push (FCM)** are *data-only* messages (no `notification` block); the app renders banners itself.

## Frontend (Flutter, `/Users/anonymous/development/hungrx`)
- Clean architecture per feature (`data/datasources`, `domain`, `presentation/bloc`), Bloc + get_it + Dio. Base URL & all paths: `lib/core/constants/api_constants.dart`; auth header interceptor + 401 handler: `lib/core/network/dio_client.dart`.
- Frontend `docs/` folder holds the request specs that drove many backend endpoints (`fcm_push_notifications.md`, `promo_code_api_request.md`, `trial_reminder_backend_integration.md`, `multilevel-menu-api.md`, …). Check there when changing a contract.
- Any change to a response shape must be mirrored in the Flutter models (`*_response_model.dart`). Client-called endpoints are marked in routes/README.md.
- Timezones: client normalizes legacy IANA names (e.g. `Asia/Calcutta`→`Asia/Kolkata`, `US/Eastern`→`America/New_York`) before sending to `/device/register-token`; reminder scheduler matches on exact `Asia/Kolkata` and `^America/`.

## Known issues / gotchas (verified in code)
**Security**
- `POST /notifications/send` has **no auth** — anyone can push to all users.
- `script.js` has a hardcoded MongoDB Atlas URI with credentials (public repo) → rotate.
- Firebase service-account key was committed (public repo) → rotate.
- RevenueCat webhook skips verification if `REVENUECAT_WEBHOOK_SECRET` is unset. `/support/submit` is unauthenticated and trusts client `userId`.
- `/device/register-token`, `/free-trial`, `/unregister-token` trust `userId` from the body rather than `req.user.id` (a user could act on another user's id).
- No rate limiting, CORS config, helmet, or body validation library.

**Correctness / maintainability**
- `node_modules/` is committed to git despite being in `.gitignore`.
- `User.profileUrl` is returned by `/auth/login` but the schema field is `photoUrl` → always undefined.
- `nutrition.js` imperial handling: `/profile` PUT stores height as **feet** value with unit `ft` and converts `×30.48` (decimal feet), weights `lbs`. `toMetric` uses the same assumption. Metric fields are named `heightCm`/`weightKg` even when imperial.
- `/restaurants/nearby` & `/all` load the entire restaurants collection and paginate in memory.
- `VALID_GOAL` in profile excludes "Gain weight" though `nutrition.js` supports it.
- Schedulers run in-process with `setInterval` → with >1 server instance both run (guarded by atomic Mongo updates, so duplicates are prevented but work is duplicated).
- Reminder windows are hardcoded for `Asia/Kolkata` and `America/*` only; other timezones never get meal reminders.
- Unused endpoints in Flutter (no caller found): `/user/notification-preferences`, `/subscription/verify-promo`, `/notifications/send`, `/admin/*`, `/webhooks/revenuecat` (the last three are called by other systems/admin tools).
- Several routes are untested; there is no test suite.

## Working agreements
- Match existing style: CommonJS, 2-space indent, `try/catch` per handler with `console.error` and a generic 500 message.
- Prefer atomic Mongo updates (`findOneAndUpdate` with a condition) for anything that must happen once (promo redeem, reminders).
- Don't point dev at production Mongo; if you must, set `DISABLE_SCHEDULERS=true` so schedulers don't send real pushes.
