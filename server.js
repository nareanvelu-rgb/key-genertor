const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; 

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
    hwid: { type: String, default: null } // 🔥 HWID Lock Field Added
});

const adminSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true }
});

const KeyModel = mongoose.model('Key', keySchema);
const AdminModel = mongoose.model('Admin', adminSchema);

// Helper Functions
async function isAdmin(userId) {
    if (userId === MAIN_OWNER_ID) return true;
    try {
        const admin = await AdminModel.findOne({ userId: userId });
        return !!admin;
    } catch (e) {
        return false;
    }
}

// --- TELEGRAM BOT COMMANDS ---

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) {
        return bot.sendMessage(chatId, "❌ **Access Denied!**\nAap is bot ko use karne ke liye authorized nahi hain.", { parse_mode: 'Markdown' });
    }

    let helpText = "👑 **M1 BISKUT KEY GENERATOR** 👑\n\n";
    helpText += "🔑 **Key Management:**\n";
    helpText += "• `/gen` - 30 Days ki random key\n";
    helpText += "• `/gen [days]` - Custom days ki random key (e.g., `/gen 7`)\n";
    helpText += "• `/gen [CUSTOM_KEY] [days]` - Apni marzi ki key (e.g., `/gen MYVIPKEY 30`)\n";
    helpText += "• `/keylist` - Sabhi keys ki list & Delete button\n";
    helpText += "• `/search [KEY]` - Key ki details check karein\n";
    helpText += "• `/reset [KEY]` - 🔥 Kisi key ka HWID reset karein\n"; // NEW COMMAND
    helpText += "• `/stats` - Database stats\n";
    helpText += "• `/mykeys` - Apni generate ki hui keys\n\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "🛡️ **Owner Exclusive Controls:**\n";
        helpText += "• `/addadmin [USER_ID]` - Naya Reseller\n";
        helpText += "• `/removeadmin [USER_ID]` - Admin hatayein\n";
        helpText += "• `/adminlist` - Admins ki list\n";
        helpText += "• `/delall` - Saari expired keys saaf karein\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/gen(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    let inputArg = match[1] ? match[1].trim() : "";
    let customKey = "";
    let days = 30;

    if (inputArg) {
        const parts = inputArg.split(" ");
        if (parts.length === 2) {
            customKey = parts[0].toUpperCase();
            days = parseInt(parts[1]) || 30;
        } else if (!isNaN(parts[0])) {
            days = parseInt(parts[0]) || 30;
        } else {
            customKey = parts[0].toUpperCase();
        }
    }

    if (!customKey) {
        customKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    const expiryDateStr = new Date(expiryTime).toLocaleString();

    try {
        await KeyModel.create({
            key: customKey,
            expiry: expiryTime,
            createdBy: chatId,
            hwid: null // Naya HWID null rahega
        });

        bot.sendMessage(chatId, `✅ **Key Generated Successfully!**\n\n🔑 Key: \`${customKey}\`\n⏳ Validity: ${days} Days\n📅 Expires: ${expiryDateStr}`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error: Key already exists or invalid format!`);
    }
});

bot.onText(/\/keylist/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    try {
        const keys = await KeyModel.find({}).sort({ expiry: -1 }).limit(20);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys found.");

        let message = "📋 **DATABASE LICENSE KEYS (Latest 20):**\n\n";
        const inlineKeyboard = [];

        keys.forEach((k, index) => {
            const isExpired = Date.now() > k.expiry;
            const statusEmoji = isExpired ? "🔴" : "🟢";
            const hwidStatus = k.hwid ? "🔒" : "🔓";
            message += `${index + 1}. \`${k.key}\` (${statusEmoji} ${hwidStatus})\n`;

            inlineKeyboard.push([{ text: `❌ Delete ${k.key}`, callback_data: `del_${k.key}` }]);
        });

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching keys list.`);
    }
});

// 🔥 NEW: Reset HWID Command
bot.onText(/\/reset (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const targetKey = match[1].trim().toUpperCase();
    try {
        const updated = await KeyModel.findOneAndUpdate({ key: targetKey }, { hwid: null }, { new: true });
        if (updated) {
            bot.sendMessage(chatId, `✅ HWID Reset Successful!\nKey \`${targetKey}\` ab naye device pe chal sakti hai.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Key nahi mili database mein!`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error resetting HWID.`);
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    if (!(await isAdmin(chatId))) return bot.answerCallbackQuery(query.id, { text: "❌ Unauthorized!", show_alert: true });

    if (data.startsWith('del_')) {
        const keyToDel = data.replace('del_', '');
        try {
            const deleted = await KeyModel.findOneAndDelete({ key: keyToDel });
            if (deleted) {
                bot.answerCallbackQuery(query.id, { text: `✅ Key ${keyToDel} deleted!` });
                bot.editMessageText(`🗑️ Key \`${keyToDel}\` was deleted.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
            } else {
                bot.answerCallbackQuery(query.id, { text: "⚠️ Key not found!", show_alert: true });
            }
        } catch (e) { bot.answerCallbackQuery(query.id, { text: "⚠️ Database error.", show_alert: true }); }
    }
});

bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const searchKey = match[1].trim().toUpperCase();
    try {
        const keyData = await KeyModel.findOne({ key: searchKey });
        if (!keyData) return bot.sendMessage(chatId, `❌ Key \`${searchKey}\` not found.`);

        const isExpired = Date.now() > keyData.expiry;
        const status = isExpired ? "🔴 EXPIRED" : "🟢 ACTIVE";
        const expiryDateStr = new Date(keyData.expiry).toLocaleString();

        let response = `🔍 **KEY SEARCH RESULT**\n\n`;
        response += `🔑 Key: \`${keyData.key}\`\n`;
        response += `📊 Status: ${status}\n`;
        response += `📅 Expires On: ${expiryDateStr}\n`;
        response += `📱 HWID Lock: \`${keyData.hwid || 'Not Locked Yet'}\`\n`; // Added HWID Info
        response += `👤 Created By: \`${keyData.createdBy}\``;

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error searching key.`); }
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");
    try {
        const totalKeys = await KeyModel.countDocuments();
        const totalAdmins = await AdminModel.countDocuments();
        const now = Date.now();
        const activeKeys = await KeyModel.countDocuments({ expiry: { $gt: now } });
        const expiredKeys = totalKeys - activeKeys;
        const lockedKeys = await KeyModel.countDocuments({ hwid: { $ne: null } }); // Added

        let statsMsg = "📊 **ADVANCED SYSTEM STATS** 📊\n\n";
        statsMsg += `🔑 Total Keys: \`${totalKeys}\`\n`;
        statsMsg += `🟢 Active Keys: \`${activeKeys}\`\n`;
        statsMsg += `🔒 Locked to Device: \`${lockedKeys}\`\n`; // Added
        statsMsg += `🔴 Expired Keys: \`${expiredKeys}\`\n`;
        statsMsg += `👥 Total Admins: \`${totalAdmins + 1}\`\n`;
        bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error fetching stats.`); }
});

bot.onText(/\/delall/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can perform this action!");
    try {
        const now = Date.now();
        const result = await KeyModel.deleteMany({ expiry: { $lte: now } });
        bot.sendMessage(chatId, `🧹 Cleanup complete! Deleted \`${result.deletedCount}\` expired keys.`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error cleaning expired keys.`); }
});

bot.onText(/\/addadmin (\d+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can add admins!");
    const newAdminId = parseInt(match[1]);
    try {
        const existing = await AdminModel.findOne({ userId: newAdminId });
        if (!existing && newAdminId !== MAIN_OWNER_ID) {
            await AdminModel.create({ userId: newAdminId });
            bot.sendMessage(chatId, `✅ User \`${newAdminId}\` has been added as Admin!`, { parse_mode: 'Markdown' });
        } else { bot.sendMessage(chatId, `⚠️ User is already an admin.`); }
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error adding admin.`); }
});

bot.onText(/\/removeadmin (\d+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can remove admins!");
    const targetId = parseInt(match[1]);
    if (targetId === MAIN_OWNER_ID) return bot.sendMessage(chatId, `❌ You cannot remove the Main Owner!`);
    try {
        const deleted = await AdminModel.findOneAndDelete({ userId: targetId });
        if (deleted) { bot.sendMessage(chatId, `🗑️ User \`${targetId}\` removed from admins.`, { parse_mode: 'Markdown' }); } 
        else { bot.sendMessage(chatId, `⚠️ Admin not found.`); }
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error removing admin.`); }
});

bot.onText(/\/adminlist/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can view admin list!");
    try {
        const admins = await AdminModel.find({});
        let listMsg = "👥 **Authorized Admins/Resellers:**\n\n";
        listMsg += `1. \`${MAIN_OWNER_ID}\` (Owner)\n`;
        admins.forEach((admin, index) => { listMsg += `${index + 2}. \`${admin.userId}\`\n`; });
        bot.sendMessage(chatId, listMsg, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error fetching admin list.`); }
});

// --- 🔥 NEW ANDROID APP VERIFICATION API (WITH HWID LOCK) ---
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

        // 3. HWID Lock Logic
        if (!keyData.hwid) {
            // First time login: Save HWID
            keyData.hwid = hwid;
            await keyData.save();
            return res.json({ success: true, message: "Login Successful! Device Locked." });
        } else if (keyData.hwid !== hwid) {
            // Already locked to another device
            return res.json({ success: false, message: "Device Mismatch!\nThis key is already locked to another device.\nIf you changed device, contact @m1cheatshopbot" });
        }

        // If everything is fine
        res.json({ success: true, message: "Login Successful!" });

    } catch (e) {
        console.error(e);
        res.json({ success: false, message: "Server database error!" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
