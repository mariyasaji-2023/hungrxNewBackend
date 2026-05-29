const mongoose = require("mongoose");

const supportSchema = new mongoose.Schema(
  {
    userId:  { type: String, default: "" },
    email:   { type: String, required: true },
    type:    { type: String, required: true },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Support", supportSchema);
