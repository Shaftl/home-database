// backend/models/ExpenseCategory.js
const mongoose = require("mongoose");

const ExpenseCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExpenseCategory", ExpenseCategorySchema);
