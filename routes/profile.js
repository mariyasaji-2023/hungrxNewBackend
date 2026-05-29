const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const DeviceToken = require("../models/DeviceToken");
const admin = require("../firebase");

const PACE_LABELS = {
  0.25: "Slow (0.25 kg/wk)",
  0.5:  "Moderate (0.5 kg/wk)",
  1:    "Fast (1 kg/wk)",
};

const PACE_VALUES = {
  "Slow (0.25 kg/wk)":    { value: 0.25, unit: "kg/wk" },
  "Moderate (0.5 kg/wk)": { value: 0.5,  unit: "kg/wk" },
  "Fast (1 kg/wk)":       { value: 1,    unit: "kg/wk" },
};

const VALID_SEX      = ["Male", "Female", "Other"];
const VALID_GOAL     = ["Lose weight", "Maintain weight", "Gain muscle", "Maintain"];
const VALID_PACE     = Object.keys(PACE_VALUES);
const VALID_ACTIVITY = ["Sedentary", "Lightly active", "Moderately active", "Very active"];

const ACTIVITY_MULTIPLIERS = {
  "Sedentary":          1.2,
  "Lightly active":     1.375,
  "Moderately active":  1.55,
  "Very active":        1.725,
};

const PACE_DAILY_DEFICIT = {
  "Slow (0.25 kg/wk)":    275,
  "Moderate (0.5 kg/wk)": 550,
  "Fast (1 kg/wk)":       1100,
};

function calculateNutritionGoals({ weightKg, heightCm, age, sex, activityLevel, goal, pace }) {
  // Step 1 — BMR (Mifflin-St Jeor)
  const bmrConstant = sex === "Female" ? -161 : 5; // Male and Other both use +5
  const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + bmrConstant;

  // Step 2 — TDEE
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || 1.2;
  const tdee = bmr * multiplier;

  // Step 3 — Daily calorie target based on goal
  let dailyCalories;
  if (goal === "Lose weight") {
    const deficit = PACE_DAILY_DEFICIT[pace] || 550;
    dailyCalories = tdee - deficit;
  } else if (goal === "Gain muscle") {
    dailyCalories = tdee + 300;
  } else {
    // "Maintain" or "Maintain weight"
    dailyCalories = tdee;
  }

  // Enforce minimum 1200 kcal/day
  dailyCalories = Math.max(1200, Math.round(dailyCalories));

  // Step 4 — Macros
  const protein = Math.round((dailyCalories * 0.30) / 4);
  const carbs   = Math.round((dailyCalories * 0.45) / 4);
  const fat     = Math.round((dailyCalories * 0.25) / 9);

  return { calories: dailyCalories, protein, carbs, fat };
}

function buildTrialDaysLeft(sub) {
  if (!sub?.trialStartDate) return -1;
  if (sub.freeTrailExpired) return 0;
  const elapsed = Math.floor(
    (Date.now() - new Date(sub.trialStartDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(0, (sub.trialDays || 7) - elapsed);
}

function buildProfileResponse(user) {
  const ob  = user.onboarding   || {};
  const sub = user.subscription || {};
  const bm  = ob.bodyMetrics    || {};

  return {
    userId:         user._id,
    name:           user.name,
    email:          user.email,
    age:            ob.age                          ?? null,
    sex:            ob.sex                          ?? null,
    heightCm:       bm.height?.value                ?? null,
    weightKg:       bm.weight?.value                ?? null,
    targetWeightKg: bm.targetWeight?.value          ?? null,
    goal:           ob.goal                         ?? null,
    pace:           PACE_LABELS[ob.planPreference?.pace?.value] ?? null,
    activityLevel:  ob.lifestyle?.activityLevel     ?? null,
    plan:           sub.plan                        || "free",
    trialDaysLeft:  buildTrialDaysLeft(sub),
  };
}

// GET /api/v1/profile
router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, data: buildProfileResponse(user) });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

// PUT /api/v1/profile
router.put("/", authMiddleware, async (req, res) => {
  try {
    const { name, email, age, sex, heightCm, weightKg, targetWeightKg, goal, pace, activityLevel } = req.body;

    if (
      name == null || email == null || age == null || sex == null ||
      heightCm == null || weightKg == null || targetWeightKg == null ||
      goal == null || pace == null || activityLevel == null
    ) {
      return res.status(400).json({ success: false, message: "Invalid request body" });
    }

    if (
      !VALID_SEX.includes(sex) ||
      !VALID_GOAL.includes(goal) ||
      !VALID_PACE.includes(pace) ||
      !VALID_ACTIVITY.includes(activityLevel)
    ) {
      return res.status(400).json({ success: false, message: "Invalid request body" });
    }

    const paceData = PACE_VALUES[pace];

    // Recalculate calorie + macro goals based on updated profile
    const nutritionGoals = calculateNutritionGoals({
      weightKg, heightCm, age, sex, activityLevel, goal, pace,
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          name,
          email,
          "onboarding.goal":                        goal,
          "onboarding.sex":                         sex,
          "onboarding.age":                         age,
          "onboarding.bodyMetrics.height":          { value: heightCm,       unit: "cm" },
          "onboarding.bodyMetrics.weight":          { value: weightKg,       unit: "kg" },
          "onboarding.bodyMetrics.targetWeight":    { value: targetWeightKg, unit: "kg" },
          "onboarding.lifestyle.activityLevel":     activityLevel,
          "onboarding.planPreference.pace":         paceData,
          "nutritionGoals.calories":                nutritionGoals.calories,
          "nutritionGoals.protein":                 nutritionGoals.protein,
          "nutritionGoals.carbs":                   nutritionGoals.carbs,
          "nutritionGoals.fat":                     nutritionGoals.fat,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, data: buildProfileResponse(user) });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

// DELETE /api/v1/profile
router.delete("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Delete all associated data
    await Promise.all([
      FoodLog.deleteMany({ userId }),
      DeviceToken.deleteMany({ userId }),
    ]);

    // Delete MongoDB user and Firebase account
    await User.findByIdAndDelete(userId);
    await admin.auth().deleteUser(user.firebaseUid);

    return res.status(200).json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
