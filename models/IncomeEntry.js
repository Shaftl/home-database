const mongoose = require("mongoose");

const IncomeEntrySchema = new mongoose.Schema(
  {
    record_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Record",
      default: null,
    },
    source_name: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "AFN" },
    note: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IncomeEntry", IncomeEntrySchema);
