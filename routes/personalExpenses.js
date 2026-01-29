const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const ExpenseEntry = require("../models/ExpenseEntry");
const ExpenseCategory = require("../models/ExpenseCategory");
const PersonalExpense = require("../models/PersonalExpense");
const IncomeEntry = require("../models/IncomeEntry");
const Approval = require("../models/Approval");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const Notification = require("../models/Notification");

const { authenticateToken } = require("../middleware/auth");
const { permit } = require("../middleware/roles");

/**
 * Helper: create audit log
 */
async function createAudit({
  entity_type,
  entity_id,
  action,
  performed_by = null,
  meta = {},
}) {
  try {
    await AuditLog.create({
      entity_type,
      entity_id,
      action,
      performed_by,
      meta,
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}

/** small helper to validate :id params */
function isValidObjectId(id) {
  return mongoose && mongoose.Types.ObjectId.isValid(String(id));
}

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
 * GET /api/personal-expenses
 * - user: returns their own personal expenses
 * - admin (adminA/adminB/superadmin): returns all (with optional filters)
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { from, to, status, user: userFilter } = req.query;
    const q = {};

    // if normal user -> only own
    if (!["adminA", "adminB", "superadmin"].includes(req.user.role)) {
      q.user = req.user._id;
    } else {
      // admin can filter by user
      if (userFilter) q.user = userFilter;
    }

    if (status) q.status = status;
    if (from || to) q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to) q.createdAt.$lte = new Date(to);

    const items = await PersonalExpense.find(q)
      .populate("user", "username display_name email role")
      .populate("category")
      .sort({ createdAt: -1 });

    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * POST /api/personal-expenses
 * Create a new personal expense (initially draft)
 */
router.post("/", authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description,
      category, // <-- can be ObjectId or a string name now
      amount_min,
      amount_avg,
      amount_max,
      requested_amount,
      start_date,
      end_date,
      attachments,
    } = req.body;
    if (
      !title ||
      amount_min == null ||
      amount_avg == null ||
      amount_max == null
    ) {
      return res
        .status(400)
        .json({ message: "title and amount_min/avg/max required" });
    }

    // Resolve category: accept either ObjectId or string name; if string and not exist -> create it
    let categoryId = null;
    if (category) {
      // if category looks like an ObjectId, validate and set
      if (mongoose.Types.ObjectId.isValid(category)) {
        const catExists = await ExpenseCategory.findById(category);
        if (catExists) categoryId = catExists._id;
        else {
          // invalid id -> treat as not found
          return res.status(400).json({ message: "category not found" });
        }
      } else if (typeof category === "string") {
        // find by name (case-insensitive)
        let cat = await ExpenseCategory.findOne({
          name: { $regex: `^${category}$`, $options: "i" },
        });
        if (!cat) {
          // create it (idempotent if race occurs)
          try {
            cat = await ExpenseCategory.create({ name: category });
          } catch (err) {
            // possible duplicate/race, try to find again
            cat = await ExpenseCategory.findOne({
              name: { $regex: `^${category}$`, $options: "i" },
            });
          }
        }
        if (cat) categoryId = cat._id;
      }
    }

    const pe = await PersonalExpense.create({
      user: req.user._id,
      title,
      description,
      category: categoryId || null,
      amount_min,
      amount_avg,
      amount_max,
      requested_amount,
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      status: "draft",
      attachments: Array.isArray(attachments) ? attachments : [],
    });

    await createAudit({
      entity_type: "personal_expense",
      entity_id: pe._id,
      action: "create",
      performed_by: req.user._id,
      meta: { payload: req.body },
    });

    const populated = await PersonalExpense.findById(pe._id)
      .populate("user", "username display_name email role")
      .populate("category");

    return res.status(201).json({ item: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * PUT /api/personal-expenses/:id
 * Edit — only allowed by owner and only if status === 'draft'
 */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "not found" });
    }

    const pe = await PersonalExpense.findById(req.params.id);
    if (!pe) return res.status(404).json({ message: "not found" });
    if (String(pe.user) !== String(req.user._id))
      return res.status(403).json({ message: "not owner" });
    if (pe.status !== "draft")
      return res.status(400).json({ message: "only editable in draft state" });

    const updatable = [
      "title",
      "description",
      "category",
      "amount_min",
      "amount_avg",
      "amount_max",
      "requested_amount",
      "start_date",
      "end_date",
      "attachments",
    ];
    updatable.forEach((field) => {
      if (req.body[field] !== undefined) pe[field] = req.body[field];
    });
    await pe.save();

    await createAudit({
      entity_type: "personal_expense",
      entity_id: pe._id,
      action: "update",
      performed_by: req.user._id,
      meta: { payload: req.body },
    });

    const populated = await PersonalExpense.findById(pe._id)
      .populate("user", "username display_name email role")
      .populate("category");

    return res.json({ item: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * POST /api/personal-expenses/:id/submit
 * Owner submits -> status becomes 'pending' and admins are notified
 */
router.post("/:id/submit", authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "not found" });
    }

    const pe = await PersonalExpense.findById(req.params.id);
    if (!pe) return res.status(404).json({ message: "not found" });
    if (String(pe.user) !== String(req.user._id))
      return res.status(403).json({ message: "not owner" });
    if (pe.status !== "draft")
      return res.status(400).json({ message: "only draft can be submitted" });

    pe.status = "pending";
    await pe.save();

    await createAudit({
      entity_type: "personal_expense",
      entity_id: pe._id,
      action: "submit",
      performed_by: req.user._id,
      meta: {},
    });

    // notify admins
    const admins = await User.find({ role: { $in: ["adminA", "adminB"] } });
    for (const a of admins) {
      try {
        await Notification.create({
          user: a._id,
          title: "New personal expense pending approval",
          body: `User ${
            req.user.display_name || req.user.username
          } submitted "${pe.title}".`,
          link: `/personal/${pe._id}`,
          meta: { personal_expense: pe._id, from: req.user._id },
        });
      } catch (nerr) {
        console.error("Failed to create notification for admin", a._id, nerr);
      }

      await createAudit({
        entity_type: "notification",
        entity_id: pe._id,
        action: "notify_admin_new_pending",
        performed_by: req.user._id,
        meta: { notifyTo: a._id, message: "New personal expense pending" },
      });

      console.info(
        `Notify admin ${a.username} about personal expense ${pe._id}`,
      );
    }

    const populated = await PersonalExpense.findById(pe._id)
      .populate("user", "username display_name email role")
      .populate("category");

    return res.json({
      item: populated,
      message: "submitted and admins notified",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * POST /api/personal-expenses/:id/approve
 * Admin endpoint to approve/reject
 * body: { decision: 'approve'|'reject', comment: '...', approved_amount: Number|null }
 * Only roles adminA and adminB allowed.
 */
router.post(
  "/:id/approve",
  authenticateToken,
  permit("adminA", "adminB"),
  async (req, res) => {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(404).json({ message: "not found" });
      }

      const { decision, comment } = req.body;
      // Note: approved_amount must be provided when decision === 'approve'
      const rawApproved = req.body.approved_amount;

      if (!["approve", "reject"].includes(decision))
        return res.status(400).json({ message: "invalid decision" });

      // If approving, require approved_amount and it must be a valid number
      if (decision === "approve") {
        if (rawApproved === undefined || rawApproved === null) {
          return res.status(400).json({
            message: "approved_amount is required for approve decision",
          });
        }
        const numeric = Number(rawApproved);
        if (Number.isNaN(numeric)) {
          return res
            .status(400)
            .json({ message: "approved_amount must be a valid number" });
        }
      }

      // convert approved_amount into normalized value (could be null for rejects)
      const approved_amount =
        rawApproved !== undefined && rawApproved !== null
          ? Number(rawApproved)
          : null;

      const pe = await PersonalExpense.findById(req.params.id);
      if (!pe) return res.status(404).json({ message: "not found" });
      if (pe.status !== "pending") {
        return res
          .status(400)
          .json({ message: "can only approve/reject pending items" });
      }

      // create or update Approval record (unique index ensures one per admin)
      let approval;
      try {
        approval = await Approval.create({
          personal_expense: pe._id,
          admin_user: req.user._id,
          decision,
          comment: comment || "",
          approved_amount,
        });
      } catch (err) {
        // if unique index violation -> admin already decided, update instead
        if (err.code === 11000) {
          approval = await Approval.findOneAndUpdate(
            { personal_expense: pe._id, admin_user: req.user._id },
            { decision, comment, decided_at: new Date(), approved_amount },
            { new: true },
          );
        } else {
          throw err;
        }
      }

      await createAudit({
        entity_type: "personal_expense",
        entity_id: pe._id,
        action: `admin_${decision}`,
        performed_by: req.user._id,
        meta: { comment, approved_amount },
      });

      // if any reject -> set rejected and notify owner
      if (decision === "reject") {
        pe.status = "rejected";
        // update approvals_count (count only approve decisions)
        const approveCount = await Approval.countDocuments({
          personal_expense: pe._id,
          decision: "approve",
        });
        pe.approvals_count = approveCount;
        await pe.save();

        await createAudit({
          entity_type: "personal_expense",
          entity_id: pe._id,
          action: "rejected_final",
          performed_by: req.user._id,
          meta: { by: req.user._id },
        });

        // notify owner
        try {
          await Notification.create({
            user: pe.user,
            title: "Your personal expense request was rejected",
            body: `Request "${pe.title}" was rejected by ${
              req.user.display_name || req.user.username
            }. Comment: ${comment || "-"}`,
            link: `/personal/${pe._id}`,
            meta: {
              personal_expense: pe._id,
              by: req.user._id,
              decision: "reject",
            },
          });
        } catch (nerr) {
          console.error("Failed to notify owner of rejection", nerr);
        }

        await createAudit({
          entity_type: "notification",
          entity_id: pe._id,
          action: "notify_owner_rejected",
          performed_by: req.user._id,
          meta: { owner: pe.user, comment },
        });

        return res.json({ item: pe, approval, message: "rejected" });
      }

      // decision is 'approve' -> get all approvals with decision approve
      const approvals = await Approval.find({
        personal_expense: pe._id,
        decision: "approve",
      }).populate("admin_user", "role username display_name");

      // count unique approver IDs (guarantees two different admins count as 2)
      const uniqueApprovers = new Set(
        approvals
          .map((a) => (a.admin_user ? String(a.admin_user._id) : null))
          .filter(Boolean),
      );

      // update approvals_count on the personal expense (helpful UI)
      pe.approvals_count = approvals.length;
      await pe.save();

      // if enough unique approvers => finalize approval
      if (uniqueApprovers.size >= (pe.required_admins_count || 2)) {
        // gather provided approved_amounts from approvals (non-null)
        const providedAmounts = approvals
          .map((a) =>
            a.approved_amount != null ? Number(a.approved_amount) : null,
          )
          .filter((v) => v != null);

        let finalApprovedAmount = null;
        if (providedAmounts.length > 0) {
          // if all provided amounts are identical -> use that exact value
          const allSame = providedAmounts.every(
            (v) => v === providedAmounts[0],
          );
          if (allSame) {
            finalApprovedAmount = providedAmounts[0];
          } else {
            // otherwise use deterministic rounded average
            const sum = providedAmounts.reduce((s, v) => s + v, 0);
            finalApprovedAmount = Math.round(sum / providedAmounts.length);
          }
        } else if (pe.requested_amount != null) {
          finalApprovedAmount = Number(pe.requested_amount);
        } else {
          finalApprovedAmount = Number(pe.amount_avg || 0);
        }

        pe.status = "approved";
        pe.approved_amount = finalApprovedAmount;
        pe.approved_at = new Date();
        // ensure approvals_count reflects current approve docs
        pe.approvals_count = approvals.length;
        await pe.save();

        await createAudit({
          entity_type: "personal_expense",
          entity_id: pe._id,
          action: "approved_final",
          performed_by: req.user._id,
          meta: {
            approvers: Array.from(uniqueApprovers),
            finalApprovedAmount,
          },
        });

        // notify owner about approval
        try {
          await Notification.create({
            user: pe.user,
            title: "Your personal expense request was approved",
            body: `Request "${pe.title}" has been approved. Approved: ${finalApprovedAmount}`,
            link: `/personal/${pe._id}`,
            meta: {
              personal_expense: pe._id,
              by: req.user._id,
              decision: "approve",
              approved_amount: finalApprovedAmount,
            },
          });
        } catch (nerr) {
          console.error("Failed to notify owner of approval", nerr);
        }

        await createAudit({
          entity_type: "notification",
          entity_id: pe._id,
          action: "notify_owner_approved",
          performed_by: req.user._id,
          meta: { owner: pe.user },
        });

        // Create a global ExpenseEntry representing this approved personal expense, but only if not created already.
        try {
          const existing = await ExpenseEntry.findOne({
            note: { $regex: new RegExp(`${pe._id}`, "i") },
          });
          if (!existing) {
            const ee = await ExpenseEntry.create({
              record_id: null,
              category: pe.category || null,
              title: `[Personal] ${pe.title}`,
              amount_min: pe.amount_min,
              amount_avg: pe.amount_avg,
              amount_max: pe.amount_max,
              actual_amount: finalApprovedAmount,
              unit: pe.unit || undefined,
              note: `Approved personal expense (id: ${pe._id})`,
              date: pe.approved_at || new Date(),
              created_by: req.user._id, // the admin who finalized
              attachments: [],
            });

            await createAudit({
              entity_type: "expense_entry",
              entity_id: ee._id,
              action: "created_from_personal_approval",
              performed_by: req.user._id,
              meta: { personal_expense: pe._id, expense_entry: ee._id },
            });
          } else {
            if (existing.actual_amount !== finalApprovedAmount) {
              console.info(
                `Existing expense entry for personal ${pe._id} found; not overwriting actual_amount (${existing.actual_amount} != ${finalApprovedAmount})`,
              );
            }
          }
        } catch (outerErr) {
          console.error(
            "Failed creating global ExpenseEntry for approved personal expense",
            outerErr,
          );
        }

        return res.json({
          item: pe,
          approval,
          message: "approved (final)",
          finalApprovedAmount,
        });
      } else {
        // still pending (not enough unique approvers yet)
        return res.json({
          item: pe,
          approval,
          message: `record is still pending (approved by ${uniqueApprovers.size}/${pe.required_admins_count})`,
        });
      }
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "server error", error: err.message });
    }
  },
);

/**
 * GET /api/personal-expenses/:id/approvals
 */
router.get("/:id/approvals", authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "not found" });
    }

    const pe = await PersonalExpense.findById(req.params.id);
    if (!pe) return res.status(404).json({ message: "not found" });

    // owner or admin or superadmin can view approvals
    if (
      String(pe.user) !== String(req.user._id) &&
      !["adminA", "adminB", "superadmin"].includes(req.user.role)
    ) {
      return res.status(403).json({ message: "forbidden" });
    }

    const approvals = await Approval.find({
      personal_expense: pe._id,
    }).populate("admin_user", "username display_name role");
    return res.json({ approvals });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

/**
 * GET /api/personal-expenses/pending
 * Admins view pending list
 */
router.get(
  "/pending/list",
  authenticateToken,
  permit("adminA", "adminB", "superadmin"),
  async (req, res) => {
    try {
      const items = await PersonalExpense.find({ status: "pending" })
        .populate("user", "username display_name email")
        .sort({ createdAt: -1 });
      return res.json({ items });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "server error" });
    }
  },
);

/**
 * POST /api/personal-expenses/:id/cancel
 * Owner can cancel (if not yet approved)
 */
router.post("/:id/cancel", authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "not found" });
    }

    const pe = await PersonalExpense.findById(req.params.id);
    if (!pe) return res.status(404).json({ message: "not found" });
    if (String(pe.user) !== String(req.user._id))
      return res.status(403).json({ message: "not owner" });
    if (["approved", "rejected", "cancelled"].includes(pe.status))
      return res
        .status(400)
        .json({ message: "cannot cancel in current status" });

    pe.status = "cancelled";
    await pe.save();
    await createAudit({
      entity_type: "personal_expense",
      entity_id: pe._id,
      action: "cancelled",
      performed_by: req.user._id,
    });
    return res.json({ item: pe, message: "cancelled" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

module.exports = router;
