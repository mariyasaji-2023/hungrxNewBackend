const express = require("express");
const router = express.Router();
const admin = require("../firebase");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { calculateNutritionGoals, toMetric } = require("../utils/nutrition");

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

    const unitSystem = onboarding?.unitSystem || "metric";

    const onboardingData = {
      goal:       onboarding?.goal,
      sex:        onboarding?.sex,
      age:        onboarding?.age,
      unitSystem,
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
    };

    // Compute personalised nutrition goals from onboarding data
    const { heightCm, weightKg, targetWeightKg, paceKgPerWeek } = toMetric({
      height:       onboarding?.bodyMetrics?.height,
      weight:       onboarding?.bodyMetrics?.weight,
      targetWeight: onboarding?.bodyMetrics?.targetWeight,
      pace:         onboarding?.planPreference?.pace,
      unitSystem,
    });

    const nutritionGoals = (heightCm && weightKg && onboarding?.age)
      ? calculateNutritionGoals({
          heightCm,
          weightKg,
          targetWeightKg,
          paceKgPerWeek,
          age:           onboarding.age,
          sex:           onboarding.sex,
          activityLevel: onboarding?.lifestyle?.activityLevel,
          goal:          onboarding.goal,
        })
      : null;

    // Upsert: create if new, update onboarding if the user was pre-created by /login
    let user = await User.findOneAndUpdate(
      { firebaseUid: decodedToken.uid },
      {
        $set: {
          email:      auth.email    || decodedToken.email,
          name:       auth.name     || decodedToken.name,
          photoUrl:   auth.photoUrl || decodedToken.picture,
          provider:   auth.provider || "google",
          onboarding: onboardingData,
          "meta.platform":   meta?.platform,
          "meta.appVersion": meta?.appVersion,
          ...(nutritionGoals && {
            "nutritionGoals.calories": nutritionGoals.calories,
            "nutritionGoals.protein":  nutritionGoals.protein,
            "nutritionGoals.carbs":    nutritionGoals.carbs,
            "nutritionGoals.fat":      nutritionGoals.fat,
          }),
        },
        $setOnInsert: {
          firebaseUid: decodedToken.uid,
        },
      },
      { upsert: true, new: true }
    );

    const isNewUser = !user.onboarding?.goal; // treat as new if no prior onboarding

    // Sign JWT
    const appToken = jwt.sign(
      { id: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success:   true,
      message:   "Sign-up successful",
      token:     appToken,
      userId:    user._id,
      isNewUser: true,
      user: {
        name:     user.name,
        email:    user.email,
        photoUrl: user.photoUrl,
      },
      nutritionPlan: nutritionGoals
        ? {
            calories:     nutritionGoals.calories,
            protein:      nutritionGoals.protein,
            carbs:        nutritionGoals.carbs,
            fat:          nutritionGoals.fat,
            clamped:      nutritionGoals.clamped,
            weeksToGoal:  nutritionGoals.weeksToGoal,
          }
        : null,
    });

  } catch (error) {
    console.error("Signup error:", error);
    res.status(401).json({ success: false, message: "Authentication failed" });
  }
});

module.exports = router;