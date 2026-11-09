const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; 

// ⚠️ YAHAN APNA SAHI MONGODB ATLAS LINK DAALO
const MONGO_URI = process.env.MONGO_URI || 'YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE'; 
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(bodyParser.json());

// --- MONGODB SCHEMAS & MODELS ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const keySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    expiry: { type: Number, required: true },
    createdBy: { type: Number, required: true },
    hwid: { type: String, default: null } // 🔥 HWID Lock Field
});

const adminSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true }
});

const KeyModel = mongoose.model('Key', keySchema);
const AdminModel = mongoose.model('Admin', adminSchema);

async function isAdmin(userId) {
    if (userId === MAIN_OWNER_ID) return true;
    try {
        const admin = await AdminModel.findOne({ userId: userId });
        return !!admin;
    } catch (e) {
        return false;
    }
}

// --- 🔥 FIXED ANDROID APP VERIFICATION API ---
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    
    if (!key || !hwid) {
        return res.json({ success: false, message: "Key and HWID are required!" });
    }

    try {
        let keyData = await KeyModel.findOne({ key: key.trim() });

        // 1. Check if key exists
        if (!keyData) {
            return res.json({ success: false, message: "Invalid license key!" });
        }

        // 2. Check if key is expired
        if (Date.now() > keyData.expiry) {
            return res.json({ success: false, message: "Key Expired!\nRenew from @m1cheatshopbot or DM Biskut" });
        }

        // 3. 🔥 STRICT HWID CHECK 🔥
        if (keyData.hwid === null || keyData.hwid === "") {
            // First time use: Save HWID
            keyData.hwid = hwid;
            await keyData.save();
            console.log(`[AUTH] Key ${key} locked to new HWID: ${hwid}`);
            return res.json({ success: true, message: "Login Successful! Device Locked." });
        } 
        else if (keyData.hwid !== hwid) {
            // Mismatch: Another device trying to login
            console.log(`[ALERT] Key ${key} tried to login from unauthorized HWID: ${hwid}. (Original: ${keyData.hwid})`);
            return res.json({ 
                success: false, 
                message: "Device Mismatch!\nThis key is already locked to another device.\nContact @m1cheatshopbot to reset." 
            });
        }

        // 4. Everything matches
        res.json({ success: true, message: "Login Successful!" });

    } catch (e) {
        console.error("Server Error:", e);
        res.json({ success: false, message: "Server database error!" });
    }
});

// --- TELEGRAM BOT COMMANDS ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Access Denied!");

    let helpText = "👑 **M1 BISKUT KEY GENERATOR** 👑\n\n";
    helpText += "• `/gen` - 30 Days Key\n";
    helpText += "• `/gen [CUSTOM_KEY] [days]` - Custom Key\n";
    helpText += "• `/keylist` - Keys List\n";
    helpText += "• `/reset [KEY]` - 🔥 Reset HWID Lock\n";
    helpText += "• `/search [KEY]` - Key Info\n";
    
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/gen(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    let inputArg = match[1] ? match[1].trim() : "";
    let customKey = "";
    let days = 30;

    if (inputArg) {
        const parts = inputArg.split(" ");
        if (parts.length === 2) { customKey = parts[0].toUpperCase(); days = parseInt(parts[1]) || 30; } 
        else if (!isNaN(parts[0])) { days = parseInt(parts[0]) || 30; } 
        else { customKey = parts[0].toUpperCase(); }
    }

    if (!customKey) {
        customKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    try {
        await KeyModel.create({ key: customKey, expiry: expiryTime, createdBy: chatId, hwid: null });
        bot.sendMessage(chatId, `✅ **Key Generated!**\n🔑 Key: \`${customKey}\`\n⏳ Days: ${days}`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, `⚠️ Key already exists!`); }
});

bot.onText(/\/reset (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    const targetKey = match[1].trim().toUpperCase();
    try {
        const updated = await KeyModel.findOneAndUpdate({ key: targetKey }, { hwid: null }, { new: true });
        if (updated) {
            bot.sendMessage(chatId, `✅ HWID Reset Successful!\nKey \`${targetKey}\` is now unlocked.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Key not found!`);
        }
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error resetting.`); }
});

bot.onText(/\/keylist/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    try {
        const keys = await KeyModel.find({}).sort({ expiry: -1 }).limit(20);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys found.");

        let message = "📋 **LICENSE KEYS:**\n\n";
        keys.forEach((k, i) => {
            const status = (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i+1}. \`${k.key}\` (${status} ${lock})\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching keys.`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
