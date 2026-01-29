// backend/app.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

const authRoutes = require("./routes/auth");
const personalExpensesRoutes = require("./routes/personalExpenses");
const incomesRoutes = require("./routes/incomes");
const expensesRoutes = require("./routes/expenses");
const expenseCategoriesRoutes = require("./routes/expenseCategories");
const uploadRoutes = require("./routes/upload");
const notificationsRoutes = require("./routes/notifications");
const reportsRoutes = require("./routes/reports");
const adminUsersRoutes = require("./routes/adminUsers");

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/personal-expenses", personalExpensesRoutes);
app.use("/api/incomes", incomesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/expense-categories", expenseCategoriesRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/reports", reportsRoutes);

// admin user management (superadmin only)
app.use("/api/admin/users", adminUsersRoutes);

// serve uploads folder so files are reachable via /uploads/filename
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// sample protected route
app.get(
  "/api/admin-only",
  require("./middleware/auth").authenticateToken,
  require("./middleware/roles").permit("superadmin"),
  (req, res) => {
    res.json({ message: "hello superadmin only" });
  },
);

module.exports = app;
