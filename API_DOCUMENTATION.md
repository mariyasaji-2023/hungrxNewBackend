# API Documentation

**Base URL:** `http://localhost:5000/api/v1`

---

## Authentication

---

### `POST /auth/signup`

Registers a new user with Firebase token and onboarding data. Returns a JWT.

**Headers**
```
Content-Type: application/json
```

**Request Body**
```json
{
  "auth": {
    "idToken": "string (required)",
    "providerUserId": "string (optional)",
    "email": "string",
    "name": "string",
    "photoUrl": "string",
    "provider": "google | apple"
  },
  "onboarding": {
    "goal": "string",
    "sex": "string",
    "age": 25,
    "bodyMetrics": {
      "height": 170,
      "weight": 70,
      "targetWeight": 65
    },
    "lifestyle": {
      "activityLevel": "string"
    },
    "planPreference": {
      "pace": "string"
    }
  },
  "meta": {
    "platform": "ios | android",
    "appVersion": "1.0.0"
  }
}
```

**Success `201`** — new user
```json
{
  "success": true,
  "message": "Sign-up successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "664f1b2c8e1a2b3c4d5e6f7a",
  "isNewUser": true,
  "user": {
    "name": "Vishnu",
    "email": "vishnu@example.com",
    "photoUrl": "https://..."
  }
}
```

**Success `200`** — user already exists
```json
{
  "success": true,
  "message": "User already exists",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "664f1b2c8e1a2b3c4d5e6f7a",
  "isNewUser": false,
  "user": {
    "name": "Vishnu",
    "email": "vishnu@example.com",
    "photoUrl": "https://..."
  }
}
```

**Error `400`**
```json
{ "success": false, "message": "ID token required" }
```

**Error `401`**
```json
{ "success": false, "message": "Authentication failed" }
```

---

### `POST /auth/login`

Authenticates an existing user via Firebase token. Creates the user if not found.

**Headers**
```
Content-Type: application/json
```

**Request Body**
```json
{
  "idToken": "string (required)",
  "providerUserId": "string (optional)",
  "email": "string",
  "name": "string",
  "profileUrl": "string",
  "provider": "google | apple"
}
```

**Success `200`**
```json
{
  "success": true,
  "message": "Sign-in successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "664f1b2c8e1a2b3c4d5e6f7a",
  "profileUrl": "https://...",
  "isNewUser": false
}
```

**Error `400`**
```json
{ "success": false, "message": "ID token required" }
```

**Error `401`**
```json
{ "success": false, "message": "Invalid token" }
```

---

## Food Log

All food log endpoints require a valid JWT in the `Authorization` header.

```
Authorization: Bearer {token}
```

---

### `POST /foodlog/addFoodLog`

Adds a food item to the authenticated user's log history.

**Request Body**
```json
{
  "restaurantId": "r1",
  "itemName": "Vegetable Biryani",
  "emoji": "🍛",
  "sizeLabel": "Half",
  "kcal": 380,
  "meal": "Breakfast | Lunch | Dinner | Snack",
  "time": "1:00 pm"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `restaurantId` | string | yes | ID of the restaurant |
| `itemName` | string | yes | Name of the food item |
| `emoji` | string | no | Emoji representing the food |
| `sizeLabel` | string | no | Portion size e.g. `"Half"` / `"Full"` |
| `kcal` | number | yes | Calorie count |
| `meal` | string | yes | `Breakfast` / `Lunch` / `Dinner` / `Snack` |
| `time` | string | yes | Time of consumption e.g. `"1:00 pm"` |

**Success `200`**
```json
{
  "success": true,
  "data": {
    "id": "log_abc123xyz",
    "emoji": "🍛",
    "name": "Vegetable Biryani",
    "meal": "Lunch",
    "time": "1:00 pm",
    "kcal": 380
  }
}
```

**Error `400`**
```json
{ "success": false, "message": "Missing required fields" }
```

**Error `401`**
```json
{ "success": false, "message": "Invalid or expired token" }
```

---

### `DELETE /foodlog/deleteFoodLog/:logId`

Removes a specific food log entry from the user's history.

**URL Params**

| Param | Description |
|---|---|
| `logId` | The `id` returned from `addFoodLog` e.g. `log_abc123xyz` |

**Example**
```
DELETE /api/v1/foodlog/deleteFoodLog/log_abc123xyz
```

**Success `200`**
```json
{ "success": true, "message": "Food log deleted successfully" }
```

**Error `401`**
```json
{ "success": false, "message": "Invalid or expired token" }
```

**Error `404`**
```json
{ "success": false, "message": "Food log not found" }
```

---

## Dashboard

---

### `GET /dashboard`

Returns a full dashboard summary for the authenticated user — profile, subscription status, today's calorie progress, and today's food log entries.

**Headers**
```
Authorization: Bearer {token}
```

**Success `200`**
```json
{
  "success": true,
  "data": {
    "user": {
      "name": "Vishnu",
      "userId": "664f1b2c8e1a2b3c4d5e6f7a",
      "isNewUser": false,
      "onboardingComplete": true,
      "eligibleFreeTrail": true,
      "freeTrailExpired": false,
      "subscriptionExpired": false,
      "subscriptionPlan": "free",
      "trialDaysLeft": 7
    },
    "calories": {
      "consumed": 640,
      "goal": 2000,
      "protein": {
        "consumed": 0,
        "goal": 150
      },
      "carbs": {
        "consumed": 0,
        "goal": 250
      },
      "fat": {
        "consumed": 0,
        "goal": 65
      }
    },
    "foodLog": [
      {
        "id": "log_abc123xyz",
        "emoji": "🥣",
        "name": "Oatmeal with berries",
        "meal": "Breakfast",
        "time": "8:30 am",
        "kcal": 320
      }
    ]
  }
}
```

**Error `401`**
```json
{ "success": false, "message": "Invalid or expired token" }
```

**Error `404`**
```json
{ "success": false, "message": "User not found" }
```

---

## Notes

- The JWT token expires in **7 days**. After expiry the user must log in again.
- `foodLog` in the dashboard only returns **today's** entries.
- `protein`, `carbs`, `fat` consumed values are `0` until macro tracking is added to `addFoodLog`.
- Nutrition goals (`calories`, `protein`, `carbs`, `fat`) can be updated on the user's `nutritionGoals` field in the DB.
