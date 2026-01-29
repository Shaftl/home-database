require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");

const PORT = process.env.PORT || 4000;
connectDB(process.env.MONGO_URI || "mongodb://localhost:27017/publicdb");

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
