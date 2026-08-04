const User = require("../models/User");
const DeviceToken = require("../models/DeviceToken");
const { sendTrialReminderToUser } = require("./notificationService");

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const REMINDER_OFFSET_MS = 2 * 24 * 60 * 60 * 1000; // trialStartedAt + 2 days

async function runTrialReminders() {
  const now = new Date();
  const startedBefore = new Date(now.getTime() - REMINDER_OFFSET_MS);

  try {
    const users = await User.find({
      "subscription.trial.startedAt":     { $exists: true, $lte: startedBefore },
      "subscription.trial.expiresAt":     { $gt: now },
      "subscription.trial.reminderSentAt": null,
      "subscription.cancelledAt":         null,
      "subscription.subscriptionExpired": { $ne: true },
    }).lean();

    if (!users.length) return;

    for (const user of users) {
      // Atomic claim so two overlapping runs can't both send it
      const claimed = await User.findOneAndUpdate(
        { _id: user._id, "subscription.trial.reminderSentAt": null },
        { $set: { "subscription.trial.reminderSentAt": new Date() } }
      );
      if (!claimed) continue;

      const hasTokens = await DeviceToken.exists({ userId: user._id });
      if (!hasTokens) continue;

      await sendTrialReminderToUser(user._id);
      console.log(`[TrialReminder] Sent to user ${user._id}`);
    }
  } catch (err) {
    console.error("[TrialReminder] Error:", err);
  }
}

function startTrialReminderScheduler() {
  console.log("[TrialReminder] Scheduler started — checking hourly");

  runTrialReminders();
  setInterval(runTrialReminders, CHECK_INTERVAL_MS);
}

module.exports = { startTrialReminderScheduler, runTrialReminders };
