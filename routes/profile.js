const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");
const FoodLog = require("../models/FoodLog");
const DeviceToken = require("../models/DeviceToken");
const Feedback = require("../models/Feedback");
const RestaurantSuggestion = require("../models/RestaurantSuggestion");
const admin = require("../firebase");
const { calculateNutritionGoals, PACE_LABELS, PACE_VALUES } = require("../utils/nutrition");

const VALID_SEX      = ["Male", "Female", "Other"];
const VALID_GOAL     = ["Lose weight", "Maintain weight", "Gain muscle", "Maintain"];
const VALID_PACE     = Object.keys(PACE_VALUES);
const VALID_ACTIVITY = ["Sedentary", "Lightly active", "Moderately active", "Very active"];

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
    userId:        user._id,
    name:          user.name,
    email:         user.email,
    age:           ob.age                         ?? null,
    sex:           ob.sex                         ?? null,
    unitSystem:     ob.unitSystem                  ?? "metric",
    heightCm:       bm.height?.value               ?? null,
    weightKg:       bm.weight?.value               ?? null,
    targetWeightKg: bm.targetWeight?.value         ?? null,
    goal:          ob.goal                        ?? null,
    pace:          PACE_LABELS[ob.planPreference?.pace?.value] ?? null,
    activityLevel: ob.lifestyle?.activityLevel    ?? null,
    plan:          sub.plan                       || "free",
    trialDaysLeft: buildTrialDaysLeft(sub),
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
    const { name, email, age, sex, heightCm, weightKg, targetWeightKg, goal, pace, activityLevel, unitSystem } = req.body;

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
      weightKg, targetWeightKg, heightCm, age, sex, activityLevel, goal,
      paceKgPerWeek: paceData.value,
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
          ...(unitSystem && { "onboarding.unitSystem": unitSystem }),
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

    return res.status(200).json({
      success: true,
      data: {
        ...buildProfileResponse(user),
        clamped:     nutritionGoals.clamped,
        weeksToGoal: nutritionGoals.weeksToGoal,
      },
    });
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

    // Delete Firebase account first so the user loses access immediately.
    // Ignore "user-not-found" in case Firebase was already cleaned up.
    try {
      await admin.auth().deleteUser(user.firebaseUid);
    } catch (firebaseError) {
      if (firebaseError.code !== "auth/user-not-found") {
        throw firebaseError;
      }
    }

    // Delete all user data from MongoDB
    await Promise.all([
      User.findByIdAndDelete(userId),
      FoodLog.deleteMany({ userId }),
      DeviceToken.deleteMany({ userId }),
      Feedback.deleteMany({ userId }),
      RestaurantSuggestion.deleteMany({ userId }),
    ]);

    return res.status(200).json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
