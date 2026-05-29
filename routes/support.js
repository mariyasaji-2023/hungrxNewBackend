const express = require("express");
const router = express.Router();
const Support = require("../models/Support");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");

const VALID_TYPES = ["Technical issue", "Billing", "Feature request", "Bug report"];

router.post("/submit", async (req, res) => {
  const { userId, email, type, message } = req.body;

  if (!email || !type || !message) {
    return res.status(400).json({ success: false, message: "email, type, and message are required." });
  }

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: "Invalid support type." });
  }

  try {
    await Support.create({
      userId:  userId || "",
      email:   email.trim(),
      type,
      message: message.trim(),
    });

    return res.status(200).json({
      success: true,
      message: "Your message has been received. We'll get back to you shortly.",
    });
  } catch (error) {
    console.error("Support submit error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// POST /api/v1/support/bug-report
router.post("/bug-report", authMiddleware, async (req, res) => {
  const { userId, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: "message is required." });
  }

  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await Support.create({
      userId:  userId || req.user.id,
      email:   user.email,
      type:    "Bug report",
      message: message.trim(),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Bug report error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
