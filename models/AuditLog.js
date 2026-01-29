// backend/models/AuditLog.js
const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema({
  entity_type: { type: String, required: true }, // e.g., 'personal_expense'
  entity_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true }, // create/update/submit/approve/reject/cancel/...
  performed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // extra contextual info
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AuditLog", AuditLogSchema);
