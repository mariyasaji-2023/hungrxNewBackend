# routes/

One router per feature, mounted in `server.js` under `/api/v1/<prefix>`. Handlers contain all logic and talk to Mongoose models directly. "JWT" = `middleware/auth.js`, "Admin" = `middleware/adminAuth.js`, "Public" = no auth. "App" = called by the Flutter app today.

| Mount | File | Models |
|---|---|---|
| `/auth` | auth.js | User |
| `/food-log` | foodLog.js | FoodLog |
| `/dashboard` | dashboard.js | User, FoodLog, Restaurant |
| `/subscription` | subscription.js | User, PromoCode |
| `/profile` | profile.js | User, FoodLog, DeviceToken, Feedback, RestaurantSuggestion, Support |
| `/feedback` | feedback.js | Feedback |
| `/restaurant-suggestions` | restaurantSuggestions.js | RestaurantSuggestion |
| `/device` | device.js | DeviceToken, User |
| `/restaurants/preview` | restaurantPreview.js | Restaurant (**public**, mounted before `/restaurants`) |
| `/restaurants` | restaurants.js | Restaurant (+ Mapbox HTTP) |
| `/webhooks` | webhooks.js | User |
| `/support` | support.js | Support, User |
| `/user` | user.js | User |
| `/notifications` | notification.js | (service) DeviceToken |
| `/admin` | admin.js | PromoCode |
| `GET /health` | server.js | — |

## Endpoints

### auth.js
- `POST /auth/login` — Public. Body `{ idToken, providerUserId? }`. Verifies Firebase token (revocation checked), finds User by `firebaseUid`. 200 `{ token, userId, profileUrl }` (profileUrl is always undefined — schema has `photoUrl`). 404 if no user. Firebase error codes mapped to 400/401/404. App.
- `POST /auth/signup` — Public. Body `{ auth:{idToken, providerUserId?, email?, name?, photoUrl?, provider?}, onboarding:{goal,sex,age,unitSystem,bodyMetrics:{height,weight,targetWeight},lifestyle:{activityLevel},planPreference:{pace},howDidYouHearAboutUs}, meta:{platform,appVersion} }`. 409 if user exists (by uid or email). Computes `nutritionGoals` via utils/nutrition; pace is snapped to 0.25/0.5/1 kg/wk. 201 `{ token, userId, user, nutritionPlan }`. Any error → 401 "Authentication failed". App.

### dashboard.js
- `GET /dashboard` — JWT. Today's (UTC date) entries from FoodLog, totals vs `nutritionGoals`, `onboardingComplete`, legacy trial status (`trialDaysLeft`, sets `freeTrailExpired` as a side effect on GET), promo flags. Enriches each entry by looking up the Restaurant doc and finding the dish by **name match** to attach `dishImageUrl`, `nutrition` (protein/carbs/fat/fiber/sodium) and `restaurantLocation`. App.

### foodLog.js
- `POST /food-log` — JWT. Body `{ itemName, kcal, meal, time, restaurantId?, restaurantName?, restaurantEmoji?, emoji?, sizeLabel?, protein?, carbs?, fat?, location?{latitude,longitude,address} }`. `$push`es into the user's single FoodLog doc (upsert), id `log_<9 hex>`. `meal` ∈ Breakfast/Lunch/Dinner/Snack (schema enum; invalid → 500 not 400). App.
- `DELETE /food-log/:logId` — JWT. `$pull` by entry `id`. 404 only if user has no FoodLog doc (unknown logId still returns 200). App.

### profile.js
- `GET /profile` — JWT. Flattened profile (`heightCm`, `weightKg`, `targetWeightKg`, `pace` label, `plan`, `trialDaysLeft` (-1 = never started), promo). App.
- `PUT /profile` — JWT. All of `name,email,age,sex,heightCm,weightKg,targetWeightKg,goal,pace,activityLevel` required (`unitSystem` optional). Enums validated (`VALID_SEX/GOAL/PACE/ACTIVITY`). **Recalculates and overwrites nutritionGoals**. Returns profile + `clamped`, `weeksToGoal`. App.
- `DELETE /profile` — JWT. Deletes Firebase user (errors ignored) then User, FoodLog, DeviceToken, Feedback, RestaurantSuggestion, Support docs. App. (PromoCode.redeemedBy is not cleared.)

### subscription.js
- `POST /subscription/free-trial` — JWT. Body `{ userId }` (uses body id, not token id). Requires `eligibleFreeTrail`; sets `trialStartDate=now`, `trialDays=7`, `eligibleFreeTrail=false`. App.
- `POST /subscription/trial-started` — JWT. Body `{ trialStartedAt, trialExpiresAt }` ISO strings → `subscription.trial.*`, `reminderSentAt=null`. Drives trial reminder scheduler. App.
- `POST /subscription/verify-promo` — JWT. Body `{ code }`. Atomically claims an unredeemed, unexpired `PromoCode`, then writes `subscription.promoCode{used,code,redeemedAt,expiresAt}` with `expiresAt = now + accessDurationDays`. Response uses `{valid,message,expiresAt}`. No Flutter caller found.

### restaurants.js (largest file, ~490 lines)
- `POST /restaurants/nearby` — JWT. Body `{ latitude, longitude, cursor?, limit? (≤50, default 15) }`. Fetches Mapbox Search Box POIs (3 category groups) + reverse-geocode label, loads all DB restaurants, keeps POIs whose name fuzzy-matches a DB restaurant (`namesMatch`). Cursor-paginated (base64 cursor). App.
- `GET /restaurants/all?limit≤30&cursor` — JWT. All DB restaurants alphabetical (in-memory sort/slice), cursor = last name+id. Returns `{id,name,imageUrl,cuisine}`. App.
- `GET /restaurants/:restaurantId/menu?categoryIndex&limit≤100` — JWT. Maps nested categories via `mapCategories` (handles both flat and multilevel menus; `isMultilevel` flag), paginates by category index. Invalid ObjectId → 404. App.
- Needs `MAPBOX_TOKEN`; without it Mapbox helpers log and return empty (nearby returns nothing).

### restaurantPreview.js
- `GET /restaurants/preview?kcal=1850` — **Public (no JWT)**, called by the Flutter onboarding Sneak Peek screen (`sneak_peek/sneak_peek_api.dart`; falls back to its static data on any failure; shown before signup). Returns only the fixed `FEATURED` list (McDonald's, Chipotle, Subway, Starbucks, Chick-fil-A, Shake Shack) in that order, matched to `restaurantName` with a loose case/punctuation-insensitive regex (`McDonalds` = `McDonald's`); restaurants not found in DB or without menu data are skipped. To change the demo set, edit `FEATURED`.
- Response: `{ success, data:{ restaurants:[{ id, name, logo, cuisine, rating, fitKcal, categories:[{ name, items:[{ name, description, imageUrl, sizeLabel, kcal, protein, carbs, fat }] }] }] } }`. Uses each dish's first size with kcal > 0; subcategory items are flattened into the parent category; capped at 8 categories × 10 items.
- `fitKcal`: with `?kcal=N` (1–10000, else 400) = highest-calorie dish ≤ N (null if none fits); without it = lowest-calorie dish. No distance (no location during onboarding).
- Protection: per-IP rate limit 30 req/min (in-memory; 429 + `Retry-After`), result cached 10 min in memory (restart or wait to pick up DB edits), `Cache-Control: public, max-age=300`. `server.js` sets `trust proxy = 1` so `req.ip` is the real client behind the proxy. Because it is unauthenticated, keep the payload trimmed and never add user or private fields here.

### device.js
- `POST /device/register-token` — JWT. Body `{ userId, token, platform: ios|android, timezone? }`. Deletes stale tokens (same user+platform other token; same token other user), upserts, stores `User.timezone`. Trusts body `userId`. App.
- `POST /device/unregister-token` — JWT. `{ userId, token }`. App.

### user.js
- `GET|POST /user/notification-preferences` — JWT. `{mealReminders, weeklyReport, promotions}`. POST coerces missing fields to **false** (`!!undefined`). `mealReminders=false` disables meal pushes (scheduler filter). No Flutter caller found.

### feedback.js / restaurantSuggestions.js
- `POST /feedback` `{message}` and `POST /restaurant-suggestions` `{name}` — JWT; insert-only. App.

### support.js
- `POST /support/submit` — **Public**. `{ userId?, email, type, message }`, `type` ∈ Technical issue/Billing/Feature request/Bug report. App.
- `POST /support/bug-report` — JWT. `{ userId?, message }`, email taken from User. App.

### webhooks.js
- `POST /webhooks/revenuecat` — auth is a plain `Authorization` header equal to `REVENUECAT_WEBHOOK_SECRET` (skipped if env unset). `app_user_id` **must equal Mongo `User._id`** (client logs into RevenueCat with userId). Handles `INITIAL_PURCHASE|RENEWAL|UNCANCELLATION` (plan=pro, expiry), `EXPIRATION` (plan=free, expired), `CANCELLATION` (cancelledAt; stays pro until expiry), `BILLING_ISSUE` (store only), `TEST`. Unknown users/events return 200 so RevenueCat doesn't retry; DB error returns 500 to trigger retry.

### notification.js
- `POST /notifications/send` — **No auth.** `{ title, body, userId? }`; omit `userId` = broadcast to every device token. 404 if no tokens. Calls `sendCustomNotification`.

### admin.js
- `POST /admin/promo-codes` — Admin (`x-admin-key`). `{ note?, durationDays? (default 7) }` → code `HUNX-XXXXXX` (unambiguous charset), code itself valid 7 days (`codeExpiresAt`), grants `accessDurationDays` once redeemed.
- `GET /admin/promo-codes` — Admin. All codes with status `unused|redeemed|expired`, redeemer name.

## Adding an endpoint
1. Create/extend a router in `routes/`, `require("../middleware/auth")` for user routes.
2. Mount it in `server.js` with `app.use("/api/v1/<name>", router)`.
3. Use `req.user.id` (not body userId) for ownership.
4. Add the path to the Flutter `api_constants.dart` if the app will call it, and update this file.
