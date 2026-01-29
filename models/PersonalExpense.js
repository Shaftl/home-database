const mongoose = require("mongoose");

const PersonalExpenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // requester
    title: { type: String, required: true },
    description: { type: String, default: "" },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      default: null,
    },
    amount_min: { type: Number, required: true },
    amount_avg: { type: Number, required: true },
    amount_max: { type: Number, required: true },
    requested_amount: { type: Number }, // optional exact requested amount
    unit: { type: String, default: null },
    start_date: { type: Date },
    end_date: { type: Date },
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "cancelled"],
      default: "draft",
    },

    // attachments: array of metadata stored when uploading files
    attachments: [
      {
        filename: String,
        originalname: String,
        mime: String,
        size: Number,
        path: String, // e.g. /uploads/1234-file.jpg
      },
    ],

    required_admins_count: { type: Number, default: 2 },
    approvals_count: { type: Number, default: 0 }, // convenience

    // NEW: final approved amount / time when admins finalize approval
    approved_amount: { type: Number, default: null },
    approved_at: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PersonalExpense", PersonalExpenseSchema);
