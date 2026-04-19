const express = require("express");
const router = express.Router();
const admin = require("../firebase");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

router.post("/login", async (req, res) => {
  try {
    const { idToken, email, name, providerUserId, profileUrl } = req.body;  // ← extract profileUrl

    if (!idToken) {
      return res.status(400).json({ success: false, message: "ID token required" });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (providerUserId && decodedToken.uid !== providerUserId) {
      return res.status(401).json({ success: false, message: "Invalid user" });
    }

    let user = await User.findOne({ firebaseUid: decodedToken.uid });

    const isNewUser = !user;  // ← track before creating

    if (isNewUser) {
      user = await User.create({
        firebaseUid: decodedToken.uid,
        email:      email || decodedToken.email,
        name:       name  || decodedToken.name,
        profileUrl: profileUrl || decodedToken.picture,  // ← Firebase gives photo as `picture`
        provider: req.body.provider || "google",
      });
    }

    const appToken = jwt.sign(
      { id: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success:    true,
      message:    isNewUser ? "Sign-up successful" : "Sign-in successful",
      token:      appToken,
      userId:     user._id,
      profileUrl: user.profileUrl,   // ← include in response
      isNewUser,
    });

  } catch (error) {
    console.error("Google login error:", error);
    res.status(401).json({ success: false, message: "Invalid token" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const { auth, onboarding, meta } = req.body;

    // Validate required fields
    if (!auth?.idToken) {
      return res.status(400).json({ success: false, message: "ID token required" });
    }

    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(auth.idToken);

    // Match UID
    if (auth.providerUserId && decodedToken.uid !== auth.providerUserId) {
      return res.status(401).json({ success: false, message: "Invalid user" });
    }

    // Check if user already exists
    let user = await User.findOne({ firebaseUid: decodedToken.uid });

    const isNewUser = !user;

    if (isNewUser) {
      user = await User.create({
        // Auth
        firebaseUid: decodedToken.uid,
        email:       auth.email    || decodedToken.email,
        name:        auth.name     || decodedToken.name,
        photoUrl:    auth.photoUrl || decodedToken.picture,
        provider:    auth.provider || "google",

        // Onboarding
        onboarding: {
          goal: onboarding?.goal,
          sex:  onboarding?.sex,
          age:  onboarding?.age,

          bodyMetrics: {
            height:       onboarding?.bodyMetrics?.height,
            weight:       onboarding?.bodyMetrics?.weight,
            targetWeight: onboarding?.bodyMetrics?.targetWeight,
          },

          lifestyle: {
            activityLevel: onboarding?.lifestyle?.activityLevel,
          },

          planPreference: {
            pace: onboarding?.planPreference?.pace,
          },
        },

        // Meta
        meta: {
          platform:   meta?.platform,
          appVersion: meta?.appVersion,
        },
      });
    }

    // Sign JWT
    const appToken = jwt.sign(
      { id: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(isNewUser ? 201 : 200).json({
      success:   true,
      message:   isNewUser ? "Sign-up successful" : "User already exists",
      token:     appToken,
      userId:    user._id,
      isNewUser,
      user: {
        name:     user.name,
        email:    user.email,
        photoUrl: user.photoUrl,
      },
    });

  } catch (error) {
    console.error("Signup error:", error);
    res.status(401).json({ success: false, message: "Authentication failed" });
  }
});

module.exports = router;