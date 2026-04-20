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
app.use("/api/v1/foodlog", foodLogRoutes);

const dashboardRoutes = require("./routes/dashboard");
app.use("/api/v1/dashboard", dashboardRoutes);

app.listen(5000, () => {
  console.log("Server running on port 5000");
});