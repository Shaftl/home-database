// backend/routes/reports.js
const express = require("express");
const router = express.Router();
const PersonalExpense = require("../models/PersonalExpense");
const ExpenseCategory = require("../models/ExpenseCategory");
const User = require("../models/User");
const IncomeEntry = require("../models/IncomeEntry");
const ExpenseEntry = require("../models/ExpenseEntry");
const mongoose = require("mongoose");

/**
 * GET /api/reports/approved-expenses
 * (unchanged from before — returns personal expense items (approved) in JSON or CSV)
 */
router.get("/approved-expenses", async (req, res) => {
  try {
    const { from, to, category, user, format } = req.query;
    const q = { status: "approved" };

    if (from || to) q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to) {
      const endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
      q.createdAt.$lte = endDate;
    }

    if (user) {
      if (mongoose.Types.ObjectId.isValid(user)) q.user = user;
    }

    let categoryId = null;
    if (category) {
      if (mongoose.Types.ObjectId.isValid(category)) {
        categoryId = category;
      } else {
        const cat = await ExpenseCategory.findOne({
          name: { $regex: `^${category}$`, $options: "i" },
        });
        if (cat) categoryId = cat._id;
      }
    }
    if (categoryId) q.category = categoryId;

    const items = await PersonalExpense.find(q)
      .populate("user", "username display_name email")
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .lean();

    if ((format || "").toLowerCase() === "csv") {
      const cols = [
        "id",
        "title",
        "description",
        "user",
        "user_email",
        "category",
        "amount_min",
        "amount_avg",
        "amount_max",
        "requested_amount",
        "approved_amount",
        "start_date",
        "end_date",
        "status",
        "createdAt",
        "updatedAt",
      ];
      const esc = (v) => {
        if (v == null) return "";
        const s = String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const lines = [cols.join(",")];
      for (const it of items) {
        const row = [
          esc(it._id),
          esc(it.title),
          esc(it.description),
          esc(it.user ? it.user.display_name || it.user.username : ""),
          esc(it.user ? it.user.email : ""),
          esc(it.category ? it.category.name : ""),
          esc(it.amount_min),
          esc(it.amount_avg),
          esc(it.amount_max),
          esc(it.requested_amount),
          esc(it.approved_amount),
          esc(it.start_date ? new Date(it.start_date).toISOString() : ""),
          esc(it.end_date ? new Date(it.end_date).toISOString() : ""),
          esc(it.status),
          esc(it.createdAt ? new Date(it.createdAt).toISOString() : ""),
          esc(it.updatedAt ? new Date(it.updatedAt).toISOString() : ""),
        ];
        lines.push(row.join(","));
      }
      const csv = lines.join("\r\n");
      const filename = `approved-expenses-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.send(csv);
    }

    return res.json({ items });
  } catch (err) {
    console.error("GET /api/reports/approved-expenses error", err);
    return res
      .status(500)
      .json({ message: "server error", error: err.message });
  }
});

/**
 * Helper to build a date range object from optional from/to query params.
 */
function buildRange(from, to) {
  if (from || to) {
    const q = {};
    if (from) q.start = new Date(from);
    if (to) {
      const dt = new Date(to);
      dt.setHours(23, 59, 59, 999);
      q.end = dt;
    }
    return {
      start:
        q.start || new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end:
        q.end ||
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0,
          23,
          59,
          59,
          999
        ),
    };
  } else {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    return { start, end };
  }
}

/**
 * GET /api/reports/remaining?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns server-side sums:
 * { start, end, totalIncome, totalGlobalExpenses, totalPersonalApproved, totalExpenses, remaining }
 *
 * IMPORTANT: when summing ExpenseEntry for totalGlobalExpenses, exclude entries that are clearly personal-backed:
 * - note contains "Approved personal expense"
 * - OR title starts with "[Personal]"
 */
router.get("/remaining", async (req, res) => {
  try {
    const { from, to } = req.query;
    const { start, end } = buildRange(from, to);

    // Sum incomes
    const incAgg = await IncomeEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalIncome = (incAgg[0] && incAgg[0].total) || 0;

    // Sum global expenses (ExpenseEntry) BUT exclude rows that appear to be personal (title starts with "[Personal]" or note contains "Approved personal expense")
    const expMatch = {
      date: { $gte: start, $lte: end },
      $and: [
        // either note doesn't exist OR note does not include "Approved personal expense"
        {
          $or: [
            { note: { $exists: false } },
            { note: { $eq: null } },
            { note: { $not: /Approved personal expense/i } },
          ],
        },
        // and title either doesn't exist OR doesn't start with "[Personal]"
        {
          $or: [
            { title: { $exists: false } },
            { title: { $eq: null } },
            { title: { $not: /^\[Personal\]/ } },
          ],
        },
      ],
    };

    const expAgg = await ExpenseEntry.aggregate([
      { $match: expMatch },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: [{ $ifNull: ["$actual_amount", "$amount_avg"] }, 0],
            },
          },
        },
      },
    ]);
    const totalGlobalExpenses = (expAgg[0] && expAgg[0].total) || 0;

    // Sum approved PersonalExpense inside range (match approved via status and approved_at/updatedAt/createdAt)
    const peAgg = await PersonalExpense.aggregate([
      {
        $match: {
          status: "approved",
          $or: [
            { approved_at: { $gte: start, $lte: end } },
            { updatedAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: [
                { $ifNull: ["$approved_amount", "$requested_amount"] },
                "$amount_avg",
              ],
            },
          },
        },
      },
    ]);
    const totalPersonalApproved = (peAgg[0] && peAgg[0].total) || 0;

    const totalExpenses =
      Number(totalGlobalExpenses || 0) + Number(totalPersonalApproved || 0);
    const remaining = Number(totalIncome || 0) - Number(totalExpenses || 0);

    return res.json({
      start,
      end,
      totalIncome,
      totalGlobalExpenses,
      totalPersonalApproved,
      totalExpenses,
      remaining,
    });
  } catch (err) {
    console.error("GET /api/reports/remaining error", err);
    return res
      .status(500)
      .json({ message: "server error", error: err.message });
  }
});

module.exports = router;
