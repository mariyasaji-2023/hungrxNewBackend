const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();
connectDB(); // ← add this

const app = express();
app.use(express.json());

const authRoutes = require("./routes/auth");
app.use("/api/v1/auth", authRoutes);

const foodLogRoutes = require("./routes/foodLog");
app.use("/api/v1/food-log", foodLogRoutes);

const dashboardRoutes = require("./routes/dashboard");
app.use("/api/v1/dashboard", dashboardRoutes);

const subscriptionRoutes = require("./routes/subscription");
app.use("/api/v1/subscription", subscriptionRoutes);

const profileRoutes = require("./routes/profile");
app.use("/api/v1/profile", profileRoutes);

const feedbackRoutes = require("./routes/feedback");
app.use("/api/v1/feedback", feedbackRoutes);

const restaurantSuggestionRoutes = require("./routes/restaurantSuggestions");
app.use("/api/v1/restaurant-suggestions", restaurantSuggestionRoutes);

const deviceRoutes = require("./routes/device");
app.use("/api/v1/device", deviceRoutes);

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({ success: true, message: "Server is running" });
});

const { startCalorieReminderScheduler } = require("./services/calorieReminderScheduler");

app.listen(5000, () => {
  console.log("Server running on port 5000");
  startCalorieReminderScheduler();
});