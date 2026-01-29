// backend/routes/incomes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const IncomeEntry = require("../models/IncomeEntry");
const { authenticateToken } = require("../middleware/auth");
const { permit } = require("../middleware/roles");

/**
 * GET /api/incomes?from=&to=
 * Public: anyone (guest/user) can view incomes.
 */
router.get("/", async (req, res) => {
  try {
    const { from, to } = req.query;
    const q = {};
    if (from || to) q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to) q.date.$lte = new Date(to);

    const items = await IncomeEntry.find(q)
      .sort({ date: -1 })
      .populate("created_by", "username display_name");

    return res.json({ items });
  } catch (err) {
    console.error("GET /api/incomes error", err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * POST /api/incomes
 * Only superadmin may create public income entries.
 */
router.post("/", authenticateToken, permit("superadmin"), async (req, res) => {
  try {
    const { source_name, amount, currency, note, date } = req.body;
    if (!source_name || amount == null)
      return res.status(400).json({ message: "source and amount required" });

    const item = await IncomeEntry.create({
      source_name,
      amount,
      currency: currency || "AFN",
      note: note || "",
      date: date ? new Date(date) : undefined,
      created_by: req.user._id,
    });

    const populated = await IncomeEntry.findById(item._id).populate(
      "created_by",
      "username display_name"
    );

    return res.status(201).json({ item: populated });
  } catch (err) {
    console.error("POST /api/incomes error", err);
    return res
      .status(500)
      .json({ message: "server error", error: err.message });
  }
});

module.exports = router;
