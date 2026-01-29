const express = require("express");
const router = express.Router();
const ExpenseCategory = require("../models/ExpenseCategory");

router.get("/", async (req, res) => {
  try {
    // ensure default categories exist (idempotent)
    const defaults = ["اشپزخانه", "حبوبیات", "خود خانه", "قرضه ها"];
    for (const name of defaults) {
      const exists = await ExpenseCategory.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
      });
      if (!exists) {
        try {
          await ExpenseCategory.create({ name });
        } catch (err) {
          // ignore duplicate/create races
        }
      }
    }

    const items = await ExpenseCategory.find().sort({ name: 1 });
    return res.json({ items });
  } catch (err) {
    console.error("GET /api/expense-categories error", err);
    return res.status(500).json({ message: "server error" });
  }
});

module.exports = router;
