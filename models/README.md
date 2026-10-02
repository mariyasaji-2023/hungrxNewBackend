# models/

Mongoose models (one file each, `module.exports = mongoose.model(...)`). All user-owned collections reference `User._id`. Database name is whatever `MONGO_URI` specifies (`script.js` suggests `hungerX`).

## Relationships
```
User (1) ── (1) FoodLog          FoodLog.userId, entries embedded in history[]
User (1) ── (N) DeviceToken      FCM tokens, token unique
User (1) ── (N) Feedback / RestaurantSuggestion / Support(userId as String)
User (1) ── (0..1) PromoCode.redeemedBy
Restaurant: standalone, schemaless, referenced from FoodLog entries by restaurantId (string of _id)
```
Account deletion (`DELETE /profile`) removes User, FoodLog, DeviceToken, Feedback, RestaurantSuggestion, Support — **not** PromoCode.redeemedBy.

## User.js — central document
- Auth: `firebaseUid` (required, unique), `email` (required, **not unique** — uniqueness is enforced in signup code), `name`, `photoUrl`, `provider` (default `google`).
- `onboarding`: `goal, sex, age, unitSystem ("metric"|"imperial"), bodyMetrics{height,weight,targetWeight: {value,unit}}, lifestyle.activityLevel, planPreference.pace{value,unit}, howDidYouHearAboutUs`.
  Units stored as given (`cm|ft`, `kg|lbs`); pace normalized to `kg_per_week`.
- `subscription`:
  - `plan` (`free`|`pro`, default free), `store` (APP_STORE|PLAY_STORE), `subscriptionExpired`, `subscriptionExpiry`, `cancelledAt` — set by RevenueCat webhook.
  - Legacy in-app trial: `eligibleFreeTrail` (sic), `trialStartDate`, `trialDays` (7), `freeTrailExpired` (sic).
  - `promoCode{used,code,redeemedAt,expiresAt}`.
  - RevenueCat 3-day trial: `trial{startedAt,expiresAt,reminderSentAt}` (client-reported).
  - Spelling "Trail" in field names is intentional legacy — don't "fix" without migrating data and the Flutter client.
- `nutritionGoals{calories=2000, protein=150, carbs=250, fat=65}` — overwritten at signup / profile update.
- `meta{platform,appVersion}`, `timezone` (IANA, default `UTC`).
- Reminder bookkeeping (local date strings `YYYY-MM-DD`): `lastBreakfastReminderDate`, `lastCalorieReminderDate` (= lunch), `lastDinnerReminderDate`.
- `notificationPreferences{mealReminders=true, weeklyReport=true, promotions=false}`.
- timestamps on. No indexes beyond `firebaseUid` unique. `subscription` is replaced wholesale in some routes (`user.subscription = {...toObject(), ...}`), so keep new subscription fields inside the object spread pattern.

## FoodLog.js
One doc per user: `{ userId, history: [entry] }`. Entry (no `_id`): `id` (`log_xxxxxxxxx`), `restaurantId`, `restaurantName`, `restaurantEmoji`, `emoji`, `name`, `meal` (Breakfast|Lunch|Dinner|Snack), `time` (display string e.g. "1:00 pm"), `date` ("YYYY-MM-DD", UTC at insert), `kcal`, `sizeLabel`, `protein, carbs, fat, fiber, sodium`, `location{latitude,longitude,address}`.
Caveat: unbounded array growth in one document (16 MB Mongo limit) and every read filters in JS; no index on `date`.

## Restaurant.js
`strict:false`, collection `restaurants`; declared fields `restaurantName, logo, cuisine, rating` only. Real docs also carry `categories[]` (menu), optionally `location{latitude,longitude,address}` or top-level `latitude/longitude/address`, `imageUrl`, `name`. Populated by external migration scripts (see `olive_garden_migration.py`: images moved to DigitalOcean Spaces and URLs rewritten). Always `.lean()` it in reads.

## DeviceToken.js
`{ userId, token (unique), platform: ios|android }`. Invalid FCM tokens are deleted automatically by `notificationService.sendToToken`.

## PromoCode.js
`{ code (unique, uppercase, "HUNX-XXXXXX"), note, createdAt, codeExpiresAt, accessDurationDays=7, redeemedBy, redeemedAt }`. Redemption is atomic via conditional `findOneAndUpdate`.

## Feedback.js / RestaurantSuggestion.js / Support.js
Insert-only inbox collections (no read API except via DB). `Support.userId` is a **String** (may be empty for anonymous submissions), unlike the others (ObjectId).
