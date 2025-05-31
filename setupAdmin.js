const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  email:String,
  role: String
});

const User = mongoose.model("User", UserSchema);

async function createAdmin() {
  const existingAdmin = await User.findOne({ username: "admin" });
  if (existingAdmin) {
    console.log("⚠️ Admin user already exists!");
    mongoose.connection.close();
    return;
  }

  const hashedPassword = await bcrypt.hash("password123", 10);
  const admin = new User({
    username: "admin",
    email:"admin@gmail.com",
    password: hashedPassword,
    role: "admin"
  });

  await admin.save();
  console.log("✅ Admin user created successfully!");
  mongoose.connection.close();
}

createAdmin().catch(err => console.error(err));
