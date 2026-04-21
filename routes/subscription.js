const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");

router.post("/free-trial", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const sub = user.subscription || {};

    if (!sub.eligibleFreeTrail) {
      return res.status(400).json({ success: false, message: "User not eligible for free trial" });
    }

    user.subscription = {
      ...sub,
      trialStartDate:    new Date(),
      trialDays:         7,
      freeTrailExpired:  false,
      eligibleFreeTrail: false,
    };

    await user.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Free trial error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
