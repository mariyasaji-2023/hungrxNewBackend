const admin = require("../firebase");
const DeviceToken = require("../models/DeviceToken");

async function sendToToken(tokenDoc, data) {
  try {
    await admin.messaging().send({
      token: tokenDoc.token,
      data,
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { "content-available": 1 } },
      },
    });
    return true;
  } catch (err) {
    const code = err.errorInfo?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await DeviceToken.deleteOne({ _id: tokenDoc._id });
    }
    return false;
  }
}

async function sendNewRestaurantNotification(restaurant) {
  const tokens = await DeviceToken.find();
  if (!tokens.length) return;

  const data = {
    type: "new_restaurant",
    title: "New Restaurant Near You! 🍽️",
    body: `${restaurant.restaurantName} just joined HungrX. Check it out!`,
    restaurantId: String(restaurant._id),
    restaurantName: restaurant.restaurantName,
    restaurantImageUrl: restaurant.logo || "",
  };

  const results = await Promise.allSettled(tokens.map((t) => sendToToken(t, data)));
  const sent = results.filter((r) => r.value === true).length;
  console.log(`[FCM] New restaurant: ${sent}/${tokens.length} delivered`);
}

const MEAL_CONFIG = {
  breakfast: {
    title: "Good morning! 🌅",
    body:  (kcal) => `You have ${kcal} kcal remaining for today. Start your day right!`,
  },
  lunch: {
    title: "Lunch time! 🍱",
    body:  (kcal) => `You have ${kcal} kcal remaining for today. Time to refuel!`,
  },
  dinner: {
    title: "Dinner time! 🌙",
    body:  (kcal) => `You have ${kcal} kcal remaining for today. End the day strong!`,
  },
};

async function sendMealReminderToUser(userId, remainingCalories, restaurant, mealType = "lunch") {
  const tokens = await DeviceToken.find({ userId });
  if (!tokens.length) return;

  const cfg = MEAL_CONFIG[mealType] || MEAL_CONFIG.lunch;
  const data = {
    type: "calorie_reminder",
    mealType,
    title: cfg.title,
    body: cfg.body(remainingCalories),
    remainingCalories: String(remainingCalories),
    suggestedRestaurantId: String(restaurant._id),
    suggestedRestaurantName: restaurant.restaurantName,
    suggestedRestaurantImageUrl: restaurant.logo || "",
  };

  await Promise.allSettled(tokens.map((t) => sendToToken(t, data)));
}

// kept for backward compatibility
async function sendCalorieReminderToUser(userId, remainingCalories, restaurant) {
  return sendMealReminderToUser(userId, remainingCalories, restaurant, "lunch");
}

async function sendCustomNotification({ userId, title, body }) {
  const query = userId ? { userId } : {};
  const tokens = await DeviceToken.find(query);
  if (!tokens.length) return { sent: 0, total: 0 };

  const data = { type: "custom", title, body };
  const results = await Promise.allSettled(tokens.map((t) => sendToToken(t, data)));
  const sent = results.filter((r) => r.value === true).length;
  console.log(`[FCM] Custom notification: ${sent}/${tokens.length} delivered`);
  return { sent, total: tokens.length };
}

module.exports = { sendNewRestaurantNotification, sendMealReminderToUser, sendCalorieReminderToUser, sendCustomNotification };
