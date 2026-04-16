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

      bodyMetrics: {
        height:       { value: Number, unit: String },
        weight:       { value: Number, unit: String },
        targetWeight: { value: Number, unit: String },
      },

      lifestyle: {
        activityLevel: { type: String },
      },

      planPreference: {
        pace: { value: Number, unit: String },
      },
    },

    // Meta
    meta: {
      platform:   { type: String },
      appVersion: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);