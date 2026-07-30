const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const User = require("../models/User");
const PromoCode = require("../models/PromoCode");

const DAY_MS = 24 * 60 * 60 * 1000;

router.post("/free-trial", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const sub = user.subscription?.toObject() || {};

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

router.post("/verify-promo", authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ valid: false, message: "Invalid promo code." });
    }

    const normalizedCode = code.trim().toUpperCase();
    const now = new Date();

    const existing = await PromoCode.findOne({ code: normalizedCode });
    if (!existing) {
      return res.status(404).json({ valid: false, message: "Invalid promo code." });
    }

    const redeemedAt = now;

    // Atomic conditional update so two concurrent redemptions of the same
    // single-use code can't both succeed.
    const promo = await PromoCode.findOneAndUpdate(
      { code: normalizedCode, redeemedBy: null, codeExpiresAt: { $gt: now } },
      { $set: { redeemedBy: req.user.id, redeemedAt } },
      { new: true }
    );

    if (!promo) {
      const fresh = await PromoCode.findOne({ code: normalizedCode });
      if (fresh?.redeemedBy) {
        return res.status(400).json({ valid: false, message: "This promo code has already been used." });
      }
      return res.status(400).json({ valid: false, message: "This promo code has expired." });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ valid: false, message: "User not found" });
    }

    const accessDurationDays = promo.accessDurationDays || 7;
    const expiresAt = new Date(redeemedAt.getTime() + accessDurationDays * DAY_MS);

    user.subscription = {
      ...(user.subscription?.toObject() || {}),
      promoCode: {
        used:       true,
        code:       normalizedCode,
        redeemedAt,
        expiresAt,
      },
    };
    await user.save();

    return res.status(200).json({
      valid:      true,
      message:    `Promo code applied. Enjoy ${accessDurationDays} days of full access!`,
      expiresAt:  expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Verify promo error:", error);
    res.status(500).json({ valid: false, message: "Something went wrong" });
  }
});

router.post("/trial-started", authMiddleware, async (req, res) => {
  try {
    const { trialStartedAt, trialExpiresAt } = req.body;

    const startedAt = new Date(trialStartedAt);
    const expiresAt = new Date(trialExpiresAt);
    if (isNaN(startedAt) || isNaN(expiresAt)) {
      return res.status(400).json({ success: false, message: "trialStartedAt and trialExpiresAt must be valid ISO 8601 dates" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.subscription = {
      ...(user.subscription?.toObject() || {}),
      trial: {
        startedAt,
        expiresAt,
        reminderSent: false,
      },
    };
    await user.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Trial started error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
