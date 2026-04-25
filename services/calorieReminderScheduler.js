const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const DeviceToken = require("../models/DeviceToken");
const Restaurant = require("../models/Restaurant");
const { sendCalorieReminderToUser } = require("./notificationService");

async function runCalorieReminders() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[CalorieReminder] Running for ${today}`);

  try {
    const users = await User.find({
      $or: [{ lastCalorieReminderDate: { $ne: today } }, { lastCalorieReminderDate: null }],
    });

    const [restaurant] = await Restaurant.aggregate([{ $sample: { size: 1 } }]);
    if (!restaurant) {
      console.log("[CalorieReminder] No restaurants in DB, skipping");
      return;
    }

    for (const user of users) {
      const hasTokens = await DeviceToken.exists({ userId: user._id });
      if (!hasTokens) continue;

      const foodLog = await FoodLog.findOne({ userId: user._id });
      const consumed = foodLog
        ? foodLog.history.filter((e) => e.date === today).reduce((s, e) => s + e.kcal, 0)
        : 0;

      const remaining = (user.nutritionGoals?.calories || 2000) - consumed;
      if (remaining <= 0) continue;

      await sendCalorieReminderToUser(user._id, remaining, restaurant);
      await User.updateOne({ _id: user._id }, { lastCalorieReminderDate: today });
    }

    console.log("[CalorieReminder] Done");
  } catch (err) {
    console.error("[CalorieReminder] Error:", err);
  }
}

function startCalorieReminderScheduler() {
  function scheduleNextNoon() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(12, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    const mins = Math.round(delay / 60000);
    console.log(`[CalorieReminder] Next run in ${mins} min (${next.toISOString()})`);
    setTimeout(async () => {
      await runCalorieReminders();
      scheduleNextNoon();
    }, delay);
  }
  scheduleNextNoon();
}

module.exports = { startCalorieReminderScheduler, runCalorieReminders };
