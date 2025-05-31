const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true, sparse: true }, // Ensure multiple nulls are allowed
  password: String,
  role: String,
    isOnline: { type: Boolean, default: false },
  lastActive: { type: Date, default: null }
});

const User = mongoose.model("User", UserSchema);

async function createStaff1() {
  const existingStaff = await User.findOne({ username: "staff2" });
  if (existingStaff) {
    console.log("⚠️ staff2 user already exists!");
    mongoose.connection.close();
    return;
  }

  const hashedPassword = await bcrypt.hash("staffpass2", 10);
  const staff1 = new User({
    username: "staff2",
    email: "staff2@email.com", 
    password: hashedPassword,
    role: "Staff_1"
  });

  await staff1.save();
  console.log("✅ staff2 user created successfully!");
  mongoose.connection.close();
}

createStaff1().catch(err => console.error(err));

//password
// staff1 - staffpass1  email staff@email.com
// fd1staff - fd1pass          fd1staff@email.com
// fd2staff - fd2pass          fd2staff@email.com
// fd3staff - fd3pass          fd3staff@email.com
// fd4staff - fd4pass          fd4staff@email.com
// booth - boothpass          booth@email.com
// terminal - terminalpass          terminal@email.com