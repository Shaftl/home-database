// backend/routes/notifications.js
const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const { authenticateToken } = require("../middleware/auth");

// get current user's notifications
router.get("/", authenticateToken, async (req, res) => {
  const items = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ items });
});

// mark read (accepts array of ids)
router.post("/mark-read", authenticateToken, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids))
    return res.status(400).json({ message: "ids array required" });
  await Notification.updateMany(
    { _id: { $in: ids }, user: req.user._id },
    { $set: { read: true } }
  );
  res.json({ ok: true });
});

module.exports = router;
