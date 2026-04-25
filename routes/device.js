const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const DeviceToken = require("../models/DeviceToken");

router.post("/register-token", authMiddleware, async (req, res) => {
  try {
    const { userId, token, platform } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    if (!token)  return res.status(400).json({ success: false, message: "token is required" });
    if (!platform) return res.status(400).json({ success: false, message: "platform is required" });

    await DeviceToken.findOneAndUpdate(
      { token },
      { userId, token, platform },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, message: "Token registered" });
  } catch (err) {
    console.error("Register token error:", err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

router.post("/unregister-token", authMiddleware, async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    if (!token)  return res.status(400).json({ success: false, message: "token is required" });

    await DeviceToken.deleteOne({ userId, token });

    res.status(200).json({ success: true, message: "Token removed" });
  } catch (err) {
    console.error("Unregister token error:", err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
});

module.exports = router;
