const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");
const FoodLog = require("../models/FoodLog");

router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const today = new Date().toISOString().split("T")[0];

    const foodLogDoc = await FoodLog.findOne({ userId: user._id });
    const todayEntries = foodLogDoc
      ? foodLogDoc.history.filter((e) => e.date === today)
      : [];

    const caloriesConsumed = todayEntries.reduce((sum, e) => sum + e.kcal, 0);

    const onboardingComplete = !!(
      user.onboarding?.goal &&
      user.onboarding?.sex &&
      user.onboarding?.age &&
      user.onboarding?.bodyMetrics?.height &&
      user.onboarding?.bodyMetrics?.weight
    );

    const sub = user.subscription || {};
    let trialDaysLeft = 0;
    if (sub.trialStartDate && !sub.freeTrailExpired) {
      const elapsed = Math.floor(
        (Date.now() - new Date(sub.trialStartDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      trialDaysLeft = Math.max(0, (sub.trialDays || 7) - elapsed);
    }

    const goals = user.nutritionGoals || {};

    return res.status(200).json({
      success: true,
      data: {
        user: {
          name:                user.name,
          userId:              user._id,
          isNewUser:           !onboardingComplete,
          onboardingComplete,
          eligibleFreeTrail:   sub.eligibleFreeTrail ?? true,
          freeTrailExpired:    sub.freeTrailExpired ?? false,
          subscriptionExpired: sub.subscriptionExpired ?? false,
          subscriptionPlan:    sub.plan || "free",
          trialDaysLeft,
        },
        calories: {
          consumed: caloriesConsumed,
          goal:     goals.calories || 2000,
          protein: {
            consumed: 0,
            goal:     goals.protein || 150,
          },
          carbs: {
            consumed: 0,
            goal:     goals.carbs || 250,
          },
          fat: {
            consumed: 0,
            goal:     goals.fat || 65,
          },
        },
        foodLog: todayEntries.map((e) => ({
          id:    e.id,
          emoji: e.emoji,
          name:  e.name,
          meal:  e.meal,
          time:  e.time,
          kcal:  e.kcal,
        })),
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
