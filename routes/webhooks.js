const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Verify the secret RevenueCat sends in the Authorization header
function verifySecret(req, res) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return true; // secret not configured — skip verification
  const header = req.headers.authorization || "";
  if (header !== secret) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return false;
  }
  return true;
}

router.post("/revenuecat", async (req, res) => {
  if (!verifySecret(req, res)) return;

  const event = req.body?.event;
  if (!event || !event.type) {
    return res.status(400).json({ success: false, message: "Invalid payload" });
  }

  const { type, app_user_id, product_id, expiration_at_ms, store } = event;

  if (!app_user_id) {
    return res.status(400).json({ success: false, message: "Missing app_user_id" });
  }

  try {
    const user = await User.findById(app_user_id);
    if (!user) {
      // Return 200 so RevenueCat does not keep retrying for unknown users
      return res.status(200).json({ success: false, message: "User not found" });
    }

    const sub = user.subscription;

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION":
        sub.plan                = "pro";
        sub.subscriptionExpired = false;
        sub.cancelledAt         = null;
        if (expiration_at_ms) {
          sub.subscriptionExpiry = new Date(expiration_at_ms);
        }
        if (store) sub.store = store;
        if (type === "INITIAL_PURCHASE") {
          sub.eligibleFreeTrail = false;
        }
        break;

      case "EXPIRATION":
        sub.subscriptionExpired = true;
        sub.plan                = "free";
        sub.subscriptionExpiry  = expiration_at_ms ? new Date(expiration_at_ms) : sub.subscriptionExpiry;
        break;

      case "CANCELLATION":
        sub.cancelledAt = new Date();
        // Keep subscriptionExpired: false — user stays active until EXPIRATION fires
        break;

      case "BILLING_ISSUE":
        // Flag only — do not expire yet; RevenueCat will fire EXPIRATION if unresolved
        sub.store = store || sub.store;
        break;

      default:
        // Unknown event type — still return 200 so RevenueCat doesn't retry
        return res.status(200).json({ success: true, message: `Unhandled event: ${type}` });
    }

    await user.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("RevenueCat webhook error:", error);
    // Return 500 so RevenueCat retries
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
