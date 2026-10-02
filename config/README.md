# config/ (and root `firebase.js`)

## config/db.js
`connectDB()` → `mongoose.connect(process.env.MONGO_URI)`; logs host; on failure logs and `process.exit(1)`. Called once from `server.js` right after `dotenv.config()` (not awaited — routes mount immediately; schedulers' first run may race the connection, Mongoose buffers commands meanwhile).

## firebase.js (repo root, not in config/)
`firebase-admin` initialized with `require("./serviceAccountKey.json")` and exported as `admin`. Used for:
- `admin.auth().verifyIdToken(idToken, true)` — login/signup (checkRevoked = true).
- `admin.auth().deleteUser(uid)` — account deletion.
- `admin.messaging().send(...)` — FCM (services/notificationService.js).
Firebase project: `hungrx-new`. The service-account JSON is gitignored under the name `serviceAccountKey.json`, but a copy named `serviceAccountKey.json.json` was committed to the public repo — treat that key as compromised and rotate it. Requiring `./firebase` anywhere throws at load time if the file is missing, so the server won't boot without it.

## Not in this directory but config-related
- Env vars: see root CLAUDE.md. Port is hardcoded to 5000 in `server.js`.
- The Flutter app's own Firebase config lives in the frontend repo (`lib/firebase_options.dart`, `firebase.json`); both must be in the same Firebase project for token verification to work.
- Infra: DigitalOcean (API host and Spaces for restaurant images — see `olive_garden_migration.py`, env `DO_SPACES_*`). Mongo appears to be MongoDB Atlas.
