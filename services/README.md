# services/

Background/side-effect logic. Started from `server.js` after `app.listen`: `startCalorieReminderScheduler()` and `startTrialReminderScheduler()`. Both run in the API process (no cron, no queue).

## notificationService.js — FCM sender
Uses `firebase-admin` messaging (`../firebase`). **Data-only** messages (no `notification` block — the Flutter app shows banners via `flutter_local_notifications`; adding `notification` causes double banners on Android). Android `priority: high`; iOS `apns-priority 10` + `content-available`.

`sendToToken(tokenDoc, data)` → true/false; deletes the `DeviceToken` doc on `registration-token-not-registered` / `invalid-registration-token`. Other errors are swallowed silently (returns false, no log).

Exports and payload `type`s (the app routes on `data.type`):
| Function | `type` | Extra data |
|---|---|---|
| `sendMealReminderToUser(userId, remainingKcal, restaurant, mealType)` | `calorie_reminder` | `mealType, remainingCalories, suggestedRestaurantId/Name/ImageUrl` |
| `sendCalorieReminderToUser` | same (lunch; legacy alias) | |
| `sendTrialReminderToUser(userId)` | `trial_reminder` | |
| `sendNewRestaurantNotification(restaurant)` | `new_restaurant` | broadcast to all tokens; **not called anywhere currently** |
| `sendCustomNotification({userId?,title,body})` | `custom` | used by `POST /notifications/send`; omit userId = broadcast |
All values in `data` must be strings (FCM requirement) — wrap numbers with `String()`.

## calorieReminderScheduler.js — meal reminders
- Starts immediately, then aligns to the top of the next hour and runs hourly (`setTimeout` → `setInterval`).
- Windows are in **UTC hour** and only for two timezone groups:
  - `Asia/Kolkata`: breakfast @ UTC 3, lunch @ UTC 7, dinner @ UTC 14 (≈8:30/12:30/19:30 IST).
  - `America/*` (regex): breakfast UTC 13–18, lunch UTC 16–22, dinner UTC 0–5; then each user is checked against their **local hour** == 8 / 12 / 19 (`MEAL_HOUR`) via `Intl.DateTimeFormat`.
  - Users in any other timezone never get reminders.
- Per run: users with `notificationPreferences.mealReminders != false` in the active timezone groups → pick ONE random restaurant (`$sample`) for everyone → per user: needs ≥1 DeviceToken, computes remaining = goal − today's consumed kcal (local date), skips if ≤ 0, skips if already sent today (`lastBreakfast|Calorie|DinnerReminderDate == local date`), then atomically claims via `findOneAndUpdate({_id, field:{$ne:today}})` before sending.
- Unused helper `msUntilNextUTC` left in file. Per-user work is sequential (N+1 queries) — fine for current scale, slow for large user counts.
- Note FoodLog entries' `date` is UTC-based while this scheduler uses user-local date, so late-evening US logs can be attributed to the next UTC day.

## trialReminderScheduler.js — trial-ending push
- Hourly (`setInterval` + immediate run). Selects users where `subscription.trial.startedAt <= now − 2 days`, `trial.expiresAt > now`, `trial.reminderSentAt == null`, `cancelledAt == null`, `subscriptionExpired != true`.
- Atomically sets `trial.reminderSentAt` first (so overlapping runs/instances can't double-send), then pushes if the user has tokens. If the user has no tokens the reminder is still marked sent (never retried).
- Text says "Your 3-day trial ends tomorrow".
- `trial.*` is populated by the client via `POST /subscription/trial-started`.

## Adding a scheduler
Export a `startXxx()` from a new file, call it in the `app.listen` callback in `server.js`. Make sends idempotent with an atomic Mongo claim, as above, because multiple instances would each run it.
