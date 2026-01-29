const mongoose = require("mongoose");

const ApprovalSchema = new mongoose.Schema(
  {
    personal_expense: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalExpense",
      required: true,
    },
    admin_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    decision: { type: String, enum: ["approve", "reject"], required: true },
    comment: { type: String, default: "" },
    decided_at: { type: Date, default: Date.now },

    // NEW: allow admin to specify an approved amount when approving
    approved_amount: { type: Number, default: null },
  },
  { timestamps: true }
);

// ensure one decision per admin per personal expense
ApprovalSchema.index({ personal_expense: 1, admin_user: 1 }, { unique: true });

module.exports = mongoose.model("Approval", ApprovalSchema);
