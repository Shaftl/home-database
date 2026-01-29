// backend/routes/upload.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { authenticateToken } = require("../middleware/auth");

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, path.join(__dirname, "..", "uploads")),
    filename: (req, file, cb) =>
      cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "-")),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.post("/", authenticateToken, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "file required" });
  const meta = {
    filename: req.file.filename,
    originalname: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
    path: `/uploads/${req.file.filename}`,
  };
  res.json({ file: meta });
});

module.exports = router;
