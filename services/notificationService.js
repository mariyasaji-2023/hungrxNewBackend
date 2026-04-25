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

async function sendCalorieReminderToUser(userId, remainingCalories, restaurant) {
  const tokens = await DeviceToken.find({ userId });
  if (!tokens.length) return;

  const data = {
    type: "calorie_reminder",
    title: "Lunch time! 🍱",
    body: `You have ${remainingCalories} kcal left today. Try ${restaurant.restaurantName} nearby!`,
    remainingCalories: String(remainingCalories),
    suggestedRestaurantId: String(restaurant._id),
    suggestedRestaurantName: restaurant.restaurantName,
    suggestedRestaurantImageUrl: restaurant.logo || "",
  };

  await Promise.allSettled(tokens.map((t) => sendToToken(t, data)));
}

module.exports = { sendNewRestaurantNotification, sendCalorieReminderToUser };
