const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // Auth
    firebaseUid: { type: String, required: true, unique: true },
    email:       { type: String, required: true },
    name:        { type: String },
    photoUrl:    { type: String },
    provider:    { type: String, default: "google" },

    // Onboarding
    onboarding: {
      goal:       { type: String },
      sex:        { type: String },
      age:        { type: Number },
      unitSystem: { type: String }, // "metric" | "imperial"

      bodyMetrics: {
        height:       { value: Number, unit: String },
        weight:       { value: Number, unit: String },
        targetWeight: { value: Number, unit: String },
      },

      lifestyle: {
        activityLevel: { type: String },
      },

      planPreference: {
        pace: { value: Number, unit: String }, // unit: "kg_per_week" | "lb_per_week"
      },

      howDidYouHearAboutUs: { type: String }, // free text; fixed options enforced client-side only
    },

    // Subscription
    subscription: {
      plan:               { type: String, default: "free" },
      eligibleFreeTrail:  { type: Boolean, default: true },
      trialStartDate:     { type: Date },
      trialDays:          { type: Number, default: 7 },
      freeTrailExpired:   { type: Boolean, default: false },
      subscriptionExpired:{ type: Boolean, default: false },
      subscriptionExpiry: { type: Date },
      cancelledAt:        { type: Date },
      store:              { type: String }, // APP_STORE | PLAY_STORE
      promoCode: {
        used:       { type: Boolean, default: false },
        code:       { type: String },
        redeemedAt: { type: Date },
        expiresAt:  { type: Date }, // redeemedAt + 7 days
      },
      // RevenueCat annual-plan 3-day free trial (client-reported via /trial-started)
      trial: {
        startedAt:      { type: Date },
        expiresAt:      { type: Date },
        reminderSentAt: { type: Date, default: null },
      },
    },

    // Nutrition Goals
    nutritionGoals: {
      calories: { type: Number, default: 2000 },
      protein:  { type: Number, default: 150 },
      carbs:    { type: Number, default: 250 },
      fat:      { type: Number, default: 65 },
    },

    // Meta
    meta: {
      platform:   { type: String },
      appVersion: { type: String },
    },

    // Timezone (IANA string, e.g. "America/New_York")
    timezone: { type: String, default: "UTC" },

    // Notifications
    lastCalorieReminderDate:   { type: String }, // "YYYY-MM-DD" (lunch)
    lastBreakfastReminderDate: { type: String }, // "YYYY-MM-DD"
    lastDinnerReminderDate:    { type: String }, // "YYYY-MM-DD"

    notificationPreferences: {
      mealReminders: { type: Boolean, default: true },
      weeklyReport:  { type: Boolean, default: true },
      promotions:    { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);