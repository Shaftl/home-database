const mongoose = require("mongoose");

const ExpenseEntrySchema = new mongoose.Schema(
  {
    record_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Record",
      default: null,
    },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseCategory" },
    title: { type: String, required: true },
    amount_min: { type: Number },
    amount_avg: { type: Number },
    amount_max: { type: Number },
    actual_amount: { type: Number },
    unit: { type: String },
    note: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    attachments: [{ filename: String, mime: String, storagePath: String }],
  },
  { timestamps: true },
);

module.exports = mongoose.model("ExpenseEntry", ExpenseEntrySchema);
