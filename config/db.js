// backend/config/db.js
const mongoose = require("mongoose");

const connectDB = async (uri) => {
  try {
    await mongoose.connect(uri, {
      // گزینه‌های مربوط به parser/ topology در Mongoose v7 حذف/پیش‌فرض شدند.
      // می‌تونی گزینه‌های مفید دیگری مثل timeout ها اینجا قرار بدی:
      serverSelectionTimeoutMS: 5000, // optional: fail fast if no mongo
    });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;
