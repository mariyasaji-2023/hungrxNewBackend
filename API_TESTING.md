# API Testing

**Base URL:** `http://143.198.10.72:8080/api/v1`

---

## 1. Add Food Log

```
POST /foodlog/addFoodLog
```

**Headers**
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body**
```json
{
  "restaurantId": "r1",
  "itemName": "Vegetable Biryani",
  "emoji": "🍛",
  "sizeLabel": "Half",
  "kcal": 380,
  "meal": "Lunch",
  "time": "1:00 pm"
}
```

**Response `200`**
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

---

## 2. Delete Food Log

```
DELETE /foodlog/deleteFoodLog/{logId}
```

**Headers**
```
Authorization: Bearer {token}
```

**Response `200`**
```json
{ "success": true, "message": "Food log deleted successfully" }
```

---

## 3. Dashboard

```
GET /dashboard
```

**Headers**
```
Authorization: Bearer {token}
```

**Response `200`**
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
      "protein": { "consumed": 0, "goal": 150 },
      "carbs":   { "consumed": 0, "goal": 250 },
      "fat":     { "consumed": 0, "goal": 65 }
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
