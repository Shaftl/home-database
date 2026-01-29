// backend/routes/adminUsers.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { authenticateToken } = require("../middleware/auth");
const { permit } = require("../middleware/roles");

/**
 * Only superadmin may access these routes
 * Routes:
 * GET    /api/admin/users            - list users (with optional q)
 * POST   /api/admin/users            - create user { username, display_name, email, password, role }
 * PUT    /api/admin/users/:id        - update user { display_name, email, role, password? }
 * DELETE /api/admin/users/:id        - delete user (prevents deleting last superadmin)
 */

// list users
router.get("/", authenticateToken, permit("superadmin"), async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};
    if (q) {
      const rx = { $regex: q, $options: "i" };
      filter.$or = [{ username: rx }, { display_name: rx }, { email: rx }];
    }
    const items = await User.find(filter)
      .select("username display_name email role createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    console.error("GET /api/admin/users error", err);
    return res.status(500).json({ message: "server error" });
  }
});

// create user
router.post("/", authenticateToken, permit("superadmin"), async (req, res) => {
  try {
    const { username, display_name, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "username/email/password required" });
    }
    // role validation
    const allowedRoles = ["user", "adminA", "adminB", "superadmin", "guest"];
    const assignedRole = allowedRoles.includes(role) ? role : "user";

    const existing = await User.findOne({
      $or: [{ username }, { email }],
    });
    if (existing) {
      return res
        .status(400)
        .json({ message: "username or email already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const u = await User.create({
      username,
      display_name: display_name || "",
      email,
      password_hash: hash,
      role: assignedRole,
    });

    const out = {
      id: u._id,
      username: u.username,
      display_name: u.display_name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    };

    return res.status(201).json({ item: out });
  } catch (err) {
    console.error("POST /api/admin/users error", err);
    return res.status(500).json({ message: "server error" });
  }
});

// update user
router.put(
  "/:id",
  authenticateToken,
  permit("superadmin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { display_name, email, role, password } = req.body;

      const user = await User.findById(id);
      if (!user) return res.status(404).json({ message: "user not found" });

      // if trying to change role from superadmin to non-superadmin, ensure at least one other superadmin exists
      if (user.role === "superadmin" && role && role !== "superadmin") {
        const count = await User.countDocuments({ role: "superadmin" });
        if (count <= 1) {
          return res
            .status(400)
            .json({ message: "Cannot demote the last superadmin" });
        }
      }

      // if trying to promote to superadmin, allowed
      if (display_name !== undefined) user.display_name = display_name;
      if (email !== undefined) user.email = email;
      if (
        role !== undefined &&
        ["user", "adminA", "adminB", "superadmin", "guest"].includes(role)
      ) {
        user.role = role;
      }

      if (password) {
        const salt = await bcrypt.genSalt(10);
        user.password_hash = await bcrypt.hash(password, salt);
      }

      await user.save();

      return res.json({
        item: {
          id: user._id,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
          role: user.role,
          updatedAt: user.updatedAt,
        },
      });
    } catch (err) {
      console.error("PUT /api/admin/users/:id error", err);
      return res.status(500).json({ message: "server error" });
    }
  }
);

// delete user
router.delete(
  "/:id",
  authenticateToken,
  permit("superadmin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user) return res.status(404).json({ message: "user not found" });

      // Prevent deleting the only remaining superadmin
      if (user.role === "superadmin") {
        const count = await User.countDocuments({ role: "superadmin" });
        if (count <= 1) {
          return res
            .status(400)
            .json({ message: "Cannot delete the last superadmin" });
        }
      }

      await User.deleteOne({ _id: id });
      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/admin/users/:id error", err);
      return res.status(500).json({ message: "server error" });
    }
  }
);

module.exports = router;
