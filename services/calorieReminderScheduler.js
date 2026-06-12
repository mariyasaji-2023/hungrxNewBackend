const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const DeviceToken = require("../models/DeviceToken");
const Restaurant = require("../models/Restaurant");
const { sendCalorieReminderToUser } = require("./notificationService");

function getUserLocalHour(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    return parseInt(parts.find((p) => p.type === "hour").value, 10);
  } catch {
    return null;
  }
}

function getUserLocalDate(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year:  "numeric",
      month: "2-digit",
      day:   "2-digit",
    }).format(new Date()); // "YYYY-MM-DD"
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

// Noon across all US timezones falls between 16:00–22:00 UTC — skip outside that window
function isWithinUSNoonWindow() {
  const utcHour = new Date().getUTCHours();
  return utcHour >= 16 && utcHour <= 22;
}

async function runCalorieReminders() {
  if (!isWithinUSNoonWindow()) return;

  console.log("[CalorieReminder] Running check");

  try {
    const users = await User.find({
      "notificationPreferences.mealReminders": { $ne: false },
      timezone: { $regex: /^America\// },
    }).lean();

    if (!users.length) return;

    const [restaurant] = await Restaurant.aggregate([{ $sample: { size: 1 } }]);
    if (!restaurant) {
      console.log("[CalorieReminder] No restaurants in DB, skipping");
      return;
    }

    for (const user of users) {
      const timezone = user.timezone;
      const localHour = getUserLocalHour(timezone);

      // Only fire at noon in the user's local time
      if (localHour !== 12) continue;

      const today = getUserLocalDate(timezone);
      if (user.lastCalorieReminderDate === today) continue;

      const hasTokens = await DeviceToken.exists({ userId: user._id });
      if (!hasTokens) continue;

      const foodLog  = await FoodLog.findOne({ userId: user._id }).lean();
      const consumed = foodLog
        ? foodLog.history.filter((e) => e.date === today).reduce((s, e) => s + e.kcal, 0)
        : 0;

      const remaining = (user.nutritionGoals?.calories || 2000) - consumed;
      if (remaining <= 0) continue;

      await sendCalorieReminderToUser(user._id, remaining, restaurant);
      await User.updateOne({ _id: user._id }, { lastCalorieReminderDate: today });
      console.log(`[CalorieReminder] Sent to user ${user._id} (${timezone})`);
    }
  } catch (err) {
    console.error("[CalorieReminder] Error:", err);
  }
}

function startCalorieReminderScheduler() {
  console.log("[CalorieReminder] Scheduler started — checking hourly between 16:00–22:00 UTC");
  setInterval(runCalorieReminders, 60 * 60 * 1000);
}

module.exports = { startCalorieReminderScheduler, runCalorieReminders };
