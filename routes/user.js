const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");

// GET /api/v1/user/notification-preferences
router.get("/notification-preferences", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const prefs = user.notificationPreferences || {};
    return res.status(200).json({
      success: true,
      data: {
        mealReminders: prefs.mealReminders ?? true,
        weeklyReport:  prefs.weeklyReport  ?? true,
        promotions:    prefs.promotions    ?? false,
      },
    });
  } catch (error) {
    console.error("Get notification preferences error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

// POST /api/v1/user/notification-preferences
router.post("/notification-preferences", authMiddleware, async (req, res) => {
  try {
    const { mealReminders, weeklyReport, promotions } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          "notificationPreferences.mealReminders": !!mealReminders,
          "notificationPreferences.weeklyReport":  !!weeklyReport,
          "notificationPreferences.promotions":    !!promotions,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Save notification preferences error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong." });
  }
});

module.exports = router;
