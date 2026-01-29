const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const ExpenseEntry = require("../models/ExpenseEntry");
const ExpenseCategory = require("../models/ExpenseCategory");
const PersonalExpense = require("../models/PersonalExpense");
const IncomeEntry = require("../models/IncomeEntry");
const { authenticateToken } = require("../middleware/auth");
const { permit } = require("../middleware/roles");

/**
 * Helper: compute monthly totals (income, expense, remaining)
 * monthStr = 'YYYY-MM' (optional) -> defaults to current month
 */
async function computeMonthlyTotals(monthStr) {
  const now = new Date();
  let year, month;
  if (monthStr) {
    const parts = monthStr.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10); // 1-12
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1); // exclusive

  // incomes sum
  const incAgg = await IncomeEntry.aggregate([
    { $match: { date: { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const incomeTotal = (incAgg[0] && incAgg[0].total) || 0;

  // expense entries sum (actual_amount)
  const expAgg = await ExpenseEntry.aggregate([
    { $match: { date: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$actual_amount", 0] } },
      },
    },
  ]);
  const expenseTotalFromEntries = (expAgg[0] && expAgg[0].total) || 0;

  // personal expenses that were approved in the month
  const peAgg = await PersonalExpense.aggregate([
    {
      $match: {
        status: "approved",
        approved_at: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$approved_amount", 0] } },
      },
    },
  ]);
  const expenseTotalFromPersonal = (peAgg[0] && peAgg[0].total) || 0;

  const totalExpenses = expenseTotalFromEntries + expenseTotalFromPersonal;
  const remaining = incomeTotal - totalExpenses;

  return {
    start,
    end,
    incomeTotal,
    expenseTotalFromEntries,
    expenseTotalFromPersonal,
    totalExpenses,
    remaining,
  };
}

/**
 * GET /api/expenses?category=&from=&to=&user=&include_monthly_balance=true&month=YYYY-MM
 */
router.get("/", async (req, res) => {
  try {
    const { category, from, to, user, include_monthly_balance, month } =
      req.query;
    const q = {};
    if (user) q.created_by = user;
    if (from || to) q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to) q.date.$lte = new Date(to);

    if (category) {
      // accept either an ObjectId or a category name (string)
      if (mongoose.Types.ObjectId.isValid(category)) {
        q.category = category;
      } else {
        // find category by name (case-insensitive)
        const cat = await ExpenseCategory.findOne({
          name: { $regex: `^${category}$`, $options: "i" },
        });
        if (cat) q.category = cat._id;
        else {
          // if category not found, return empty list
          return res.json({ items: [] });
        }
      }
    }

    const items = await ExpenseEntry.find(q)
      .populate("category", "name")
      .populate("created_by", "username display_name")
      .sort({ date: -1 });

    const out = { items };

    if (include_monthly_balance === "true") {
      const totals = await computeMonthlyTotals(month);
      out.monthlyBalance = totals;
    }

    return res.json(out);
  } catch (err) {
    console.error("GET /api/expenses error", err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * NEW: GET /api/expenses/:id
 * Return single ExpenseEntry (populated)
 * (placed after the list route to prevent conflicts)
 */
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "not found" });
    }

    const item = await ExpenseEntry.findById(id)
      .populate("category", "name")
      .populate("created_by", "username display_name email role");

    if (!item) return res.status(404).json({ message: "not found" });

    return res.json({ item });
  } catch (err) {
    console.error("GET /api/expenses/:id error", err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * POST /api/expenses
 * Allow superadmin, adminA and adminB to create public expense entries.
 * Body: { title, category (id or name), amount_min, amount_avg, amount_max, actual_amount, unit, note, date, attachments }
 */
router.post(
  "/",
  authenticateToken,
  permit("superadmin", "adminA", "adminB"),
  async (req, res) => {
    try {
      const {
        record_id,
        category,
        title,
        amount_min,
        amount_avg,
        amount_max,
        actual_amount,
        unit,
        note,
        date,
        attachments,
      } = req.body;

      if (!title) return res.status(400).json({ message: "title required" });
      if (amount_min == null || amount_avg == null || amount_max == null) {
        return res.status(400).json({
          message: "amount_min, amount_avg and amount_max are required",
        });
      }

      // category must be provided
      if (!category) {
        return res
          .status(400)
          .json({ message: "category is required for expense entries" });
      }

      // resolve category: if string id -> use; else find by name (case-insensitive)
      let categoryId = null;
      if (category) {
        if (mongoose.Types.ObjectId.isValid(category)) {
          // ensure exists
          const catExists = await ExpenseCategory.findById(category);
          if (!catExists) {
            return res.status(400).json({ message: "category not found" });
          }
          categoryId = category;
        } else {
          const cat = await ExpenseCategory.findOne({
            name: { $regex: `^${category}$`, $options: "i" },
          });
          if (cat) categoryId = cat._id;
          else {
            return res.status(400).json({ message: "category not found" });
          }
        }
      }

      const payload = {
        record_id: record_id || null,
        category: categoryId,
        title,
        amount_min,
        amount_avg,
        amount_max,
        actual_amount: actual_amount !== undefined ? actual_amount : undefined,
        unit: unit || undefined,
        note: note || "",
        date: date ? new Date(date) : undefined,
        created_by: req.user._id,
        attachments: attachments || [],
      };

      const item = await ExpenseEntry.create(payload);

      const populated = await ExpenseEntry.findById(item._id)
        .populate("category", "name")
        .populate("created_by", "username display_name");

      return res.status(201).json({ item: populated });
    } catch (err) {
      console.error("POST /api/expenses error", err);
      return res
        .status(500)
        .json({ message: "server error", error: err.message });
    }
  },
);

module.exports = router;
