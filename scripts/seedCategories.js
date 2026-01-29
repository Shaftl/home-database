// backend/scripts/seedCategories.js
require("dotenv").config();
const mongoose = require("mongoose");
const ExpenseCategory = require("../models/ExpenseCategory");

const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/publicdb";
const CATS = ["خانه", "حبوبات", "آشپزخانه", "شخصی"];

async function main() {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 });
  console.log("Connected to Mongo for seeding categories");

  for (const name of CATS) {
    const existing = await ExpenseCategory.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
    });
    if (existing) {
      console.log(`Category exists: ${existing.name}`);
    } else {
      const c = new ExpenseCategory({ name });
      await c.save();
      console.log("Created category:", name);
    }
  }

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
