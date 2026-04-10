const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ DB Error:", err));

// ================= SCHEMAS =================

const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
    username: String,
    email: String,
    phone: String,
    hotel: String,
    location: String,
    roomType: String,
    checkin: String,
    checkout: String,
    days: Number,
    pricePerNight: Number,
    totalPrice: Number,
    paymentMethod: String,
    transactionId: String,
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "" },
    bookedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Booking = mongoose.model("Booking", bookingSchema);

// ================= ADMIN AUTH =================

function adminAuth(req, res, next) {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey === process.env.ADMIN_KEY) { next(); }
    else { res.status(401).json({ success: false, message: "Unauthorized" }); }
}

// ================= USER ROUTES =================

app.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.json({ success: false, message: "All fields are required" });
        const userExists = await User.findOne({ email });
        if (userExists) return res.json({ success: false, message: "User already exists" });
        const hashedPassword = await bcrypt.hash(password, 10);
        await new User({ name, email, password: hashedPassword }).save();
        res.json({ success: true, message: "Signup successful" });
    } catch (err) { res.json({ success: false, message: "Server error" }); }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.json({ success: false, message: "User not found" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.json({ success: false, message: "Invalid password" });
        res.json({ success: true, message: "Login successful", token: "loggedin", user: { username: user.name, email: user.email } });
    } catch (err) { res.json({ success: false, message: "Server error" }); }
});

// ✅ BOOK — with double-booking prevention
app.post("/book", async (req, res) => {
    try {
        const { username, email, phone, hotel, location, roomType, checkin, checkout, days, pricePerNight, totalPrice, paymentMethod, transactionId } = req.body;

        // Check for conflicting confirmed booking: same hotel + roomType + overlapping dates
        const conflict = await Booking.findOne({
            hotel,
            roomType,
            status: "confirmed",
            $or: [
                { checkin: { $lte: checkin }, checkout: { $gt: checkin } },
                { checkin: { $lt: checkout }, checkout: { $gte: checkout } },
                { checkin: { $gte: checkin }, checkout: { $lte: checkout } }
            ]
        });

        if (conflict) {
            return res.json({
                success: false,
                alreadyBooked: true,
                message: `Sorry! "${roomType}" at ${hotel} is already booked from ${conflict.checkin} to ${conflict.checkout}. Please choose different dates or another room type.`
            });
        }

        await new Booking({ username, email, phone, hotel, location, roomType, checkin, checkout, days, pricePerNight, totalPrice, paymentMethod, transactionId, status: "confirmed" }).save();
        res.json({ success: true, message: "Booking confirmed!" });

    } catch (err) { res.json({ success: false, message: "Booking failed" }); }
});

// ✅ CHECK AVAILABILITY
app.post("/check-availability", async (req, res) => {
    try {
        const { hotel, roomType, checkin, checkout } = req.body;
        const conflict = await Booking.findOne({
            hotel, roomType, status: "confirmed",
            $or: [
                { checkin: { $lte: checkin }, checkout: { $gt: checkin } },
                { checkin: { $lt: checkout }, checkout: { $gte: checkout } },
                { checkin: { $gte: checkin }, checkout: { $lte: checkout } }
            ]
        });
        if (conflict) return res.json({ available: false, message: `Room booked from ${conflict.checkin} to ${conflict.checkout}.` });
        res.json({ available: true, message: "Room is available!" });
    } catch (err) { res.json({ available: false, message: "Error checking availability" }); }
});

// ✅ GET MY BOOKINGS
app.get("/my-bookings/:email", async (req, res) => {
    try {
        const bookings = await Booking.find({ email: req.params.email }).sort({ bookedAt: -1 });
        res.json({ success: true, bookings });
    } catch (err) { res.json({ success: false, message: "Error fetching bookings" }); }
});

// ================= ADMIN ROUTES =================

app.post("/admin/login", (req, res) => {
    const { key } = req.body;
    if (key === process.env.ADMIN_KEY) { res.json({ success: true, message: "Admin authenticated" }); }
    else { res.json({ success: false, message: "Invalid admin key" }); }
});

app.get("/admin/users", adminAuth, async (req, res) => {
    try {
        const users = await User.find({}, "-password").sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (err) { res.json({ success: false, message: "Error fetching users" }); }
});

app.delete("/admin/users/:id", adminAuth, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        await Booking.deleteMany({ email: req.body.email });
        res.json({ success: true, message: "User deleted" });
    } catch (err) { res.json({ success: false, message: "Error deleting user" }); }
});

app.get("/admin/bookings", adminAuth, async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ bookedAt: -1 });
        res.json({ success: true, bookings });
    } catch (err) { res.json({ success: false, message: "Error fetching bookings" }); }
});

// ✅ CANCEL BOOKING — Admin soft-cancel with reason
app.patch("/admin/bookings/:id/cancel", adminAuth, async (req, res) => {
    try {
        const { reason } = req.body;
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.json({ success: false, message: "Booking not found" });
        if (booking.status === "cancelled") return res.json({ success: false, message: "Already cancelled" });

        booking.status = "cancelled";
        booking.cancelledAt = new Date();
        booking.cancelReason = reason || "Cancelled by admin";
        await booking.save();

        res.json({ success: true, message: "Booking cancelled successfully" });
    } catch (err) { res.json({ success: false, message: "Error cancelling booking" }); }
});

// ✅ RESTORE BOOKING — Admin can re-confirm a cancelled booking
app.patch("/admin/bookings/:id/restore", adminAuth, async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.json({ success: false, message: "Booking not found" });

        booking.status = "confirmed";
        booking.cancelledAt = null;
        booking.cancelReason = "";
        await booking.save();

        res.json({ success: true, message: "Booking restored to confirmed" });
    } catch (err) { res.json({ success: false, message: "Error restoring booking" }); }
});

app.delete("/admin/bookings/:id", adminAuth, async (req, res) => {
    try {
        await Booking.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Booking deleted" });
    } catch (err) { res.json({ success: false, message: "Error deleting booking" }); }
});

app.get("/admin/stats", adminAuth, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalBookings = await Booking.countDocuments();
        const confirmedBookings = await Booking.countDocuments({ status: "confirmed" });
        const cancelledBookings = await Booking.countDocuments({ status: "cancelled" });
        const revenueData = await Booking.aggregate([
            { $match: { status: "confirmed" } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } }
        ]);
        const totalRevenue = revenueData[0]?.total || 0;
        const recentBookings = await Booking.find().sort({ bookedAt: -1 }).limit(5);

        res.json({ success: true, stats: { totalUsers, totalBookings, confirmedBookings, cancelledBookings, totalRevenue, recentBookings } });
    } catch (err) { res.json({ success: false, message: "Error fetching stats" }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`🚀 Server running on http://localhost:${PORT}`); });