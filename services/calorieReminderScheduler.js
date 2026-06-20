const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const DeviceToken = require("../models/DeviceToken");
const Restaurant = require("../models/Restaurant");
const { sendMealReminderToUser } = require("./notificationService");

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

// Meal times in UTC by timezone group:
//
// IST (UTC+5:30) — fires at next whole UTC hour after the meal:
//   breakfast 8 AM  → UTC 3  (IST = 8:30 at UTC 3:00)
//   lunch    12 PM  → UTC 7  (IST = 12:30)
//   dinner    7 PM  → UTC 14 (IST = 19:30)
//
// US (America/*, EST=UTC-5 … HST=UTC-10):
//   breakfast 8 AM  → UTC 13–18
//   lunch    12 PM  → UTC 16–22
//   dinner    7 PM  → UTC 0–5
function getActiveWindowConfig() {
  const h = new Date().getUTCHours();
  const istMeals = new Set();
  const usMeals  = new Set();

  // IST windows
  if (h === 3)  istMeals.add("breakfast");
  if (h === 7)  istMeals.add("lunch");
  if (h === 14) istMeals.add("dinner");

  // US windows
  if (h >= 13 && h <= 18) usMeals.add("breakfast");
  if (h >= 16 && h <= 22) usMeals.add("lunch");
  if (h <= 5)              usMeals.add("dinner");

  const tzConditions = [];
  const activeMeals  = new Set();
  if (istMeals.size) { tzConditions.push({ timezone: "Asia/Kolkata" });                [...istMeals].forEach(m => activeMeals.add(m)); }
  if (usMeals.size)  { tzConditions.push({ timezone: { $regex: /^America\// } });      [...usMeals].forEach(m  => activeMeals.add(m)); }

  return { tzConditions, activeMeals };
}

const MEAL_HOUR = { breakfast: 8, lunch: 12, dinner: 19 };
const MEAL_LAST_SENT_FIELD = {
  breakfast: "lastBreakfastReminderDate",
  lunch:     "lastCalorieReminderDate",
  dinner:    "lastDinnerReminderDate",
};

async function runCalorieReminders() {
  const { tzConditions, activeMeals } = getActiveWindowConfig();
  if (!tzConditions.length) return;

  console.log(`[MealReminder] Running check — active meals: ${[...activeMeals].join(", ")}`);

  try {
    const users = await User.find({
      "notificationPreferences.mealReminders": { $ne: false },
      $or: tzConditions,
    }).lean();

    if (!users.length) return;

    const [restaurant] = await Restaurant.aggregate([{ $sample: { size: 1 } }]);
    if (!restaurant) {
      console.log("[MealReminder] No restaurants in DB, skipping");
      return;
    }

    for (const user of users) {
      const timezone = user.timezone;
      const localHour = getUserLocalHour(timezone);
      const today = getUserLocalDate(timezone);

      const hasTokens = await DeviceToken.exists({ userId: user._id });
      if (!hasTokens) continue;

      const foodLog = await FoodLog.findOne({ userId: user._id }).lean();
      const consumed = foodLog
        ? foodLog.history.filter((e) => e.date === today).reduce((s, e) => s + e.kcal, 0)
        : 0;
      const remaining = (user.nutritionGoals?.calories || 2000) - consumed;
      if (remaining <= 0) continue;

      for (const meal of activeMeals) {
        if (localHour !== MEAL_HOUR[meal]) continue;

        const sentField = MEAL_LAST_SENT_FIELD[meal];
        if (user[sentField] === today) continue;

        // Atomic update — only proceeds if another process hasn't already sent it
        const updated = await User.findOneAndUpdate(
          { _id: user._id, [sentField]: { $ne: today } },
          { [sentField]: today }
        );
        if (!updated) continue;

        await sendMealReminderToUser(user._id, remaining, restaurant, meal);
        console.log(`[MealReminder] ${meal} sent to user ${user._id} (${timezone})`);
      }
    }
  } catch (err) {
    console.error("[MealReminder] Error:", err);
  }
}

function startCalorieReminderScheduler() {
  console.log("[MealReminder] Scheduler started — checking hourly for US lunch & IST breakfast/lunch/dinner");

  runCalorieReminders();

  const now = new Date();
  const msUntilNextHour =
    (60 - now.getMinutes()) * 60 * 1000
    - now.getSeconds() * 1000
    - now.getMilliseconds();

  setTimeout(() => {
    runCalorieReminders();
    setInterval(runCalorieReminders, 60 * 60 * 1000);
  }, msUntilNextHour);
}

function msUntilNextUTC(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function startTestNotificationScheduler() {
  const { sendCustomNotification } = require("./notificationService");

  // 5:12 PM IST = 11:42 UTC
  async function fireTestNotification() {
    console.log("[TestNotification] Sending 5:12 PM IST notification to all users");
    try {
      const result = await sendCustomNotification({
        title: "HungrX Test Notification 🔔",
        body: "This is a test message from HungrX!",
      });
      console.log(`[TestNotification] Delivered: ${result.sent}/${result.total}`);
    } catch (err) {
      console.error("[TestNotification] Error:", err);
    }
    setTimeout(fireTestNotification, msUntilNextUTC(11, 42));
  }

  setTimeout(fireTestNotification, msUntilNextUTC(11, 42));
  console.log("[TestNotification] Scheduler started — fires daily at 5:12 PM IST (11:42 UTC)");
}

module.exports = { startCalorieReminderScheduler, runCalorieReminders, startTestNotificationScheduler };
