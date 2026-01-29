const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES || "15m",
  });
};
const generateRefreshToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES || "7d",
  });
};

// Register
router.post("/register", async (req, res) => {
  try {
    const { username, display_name, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ message: "missing fields" });

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing)
      return res.status(400).json({ message: "username or email exists" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const user = new User({
      username,
      display_name,
      email,
      password_hash: hash,
    });
    await user.save();

    return res.status(201).json({ message: "user created" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password)
      return res.status(400).json({ message: "missing fields" });

    const user = await User.findOne({
      $or: [{ username: usernameOrEmail }, { email: usernameOrEmail }],
    });
    if (!user) return res.status(400).json({ message: "invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch)
      return res.status(400).json({ message: "invalid credentials" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set refresh token as HttpOnly cookie
    res.cookie("jid", refreshToken, {
      httpOnly: true,
      path: "/api/auth/refresh", // only sent to refresh endpoint
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    return res.json({
      accessToken,
      user: {
        id: user._id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "server error" });
  }
});

// Refresh token
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies.jid;
    if (!token) return res.status(401).json({ message: "no refresh token" });
    const payload = jwt.verify(token, process.env.REFRESH_SECRET);
    const user = await User.findById(payload.id);
    if (!user)
      return res.status(401).json({ message: "invalid refresh token" });

    const accessToken = generateAccessToken(user);
    return res.json({
      accessToken,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "invalid refresh" });
  }
});

// Logout - clear cookie
router.post("/logout", (req, res) => {
  res.clearCookie("jid", { path: "/api/auth/refresh" });
  return res.json({ message: "logged out" });
});

// get current user (protected)
router.get("/me", authenticateToken, (req, res) => {
  const u = req.user.toObject();
  delete u.password_hash;
  return res.json({ user: u });
});

module.exports = router;
