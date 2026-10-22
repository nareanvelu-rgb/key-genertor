const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; // Aapka Main Owner ID

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
    createdBy: { type: Number, required: true }
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

// 1. /start Command (Only shows full panel to admins)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.from.id;
    
    if (!(await isAdmin(chatId))) {
        return bot.sendMessage(chatId, "❌ **Access Denied!**\nAap is bot ko use karne ke liye authorized nahi hain.", { parse_mode: 'Markdown' });
    }

    let helpText = "👑 **M1 BISKUT KEY GENERATOR** 👑\n\n";
    helpText += "🔑 **Key Management:**\n";
    helpText += "• `/gen` - 30 Days ki random key\n";
    helpText += "• `/gen [days]` - Custom days ki random key (e.g., `/gen 7`)\n";
    helpText += "• `/gen [CUSTOM_KEY] [days]` - Apni marzi ki key banayein (e.g., `/gen MYVIPKEY 30`)\n";
    helpText += "• `/keylist` - Sabhi keys ki list & 1-Click Delete button\n";
    helpText += "• `/search [KEY]` - Kisi key ki details check karein\n";
    helpText += "• `/stats` - Database ke active/expired stats dekhein\n";
    helpText += "• `/mykeys` - Apni generate ki hui keys dekhein\n\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "🛡️ **Owner Exclusive Controls:**\n";
        helpText += "• `/addadmin [USER_ID]` - Naya Reseller banayein\n";
        helpText += "• `/removeadmin [USER_ID]` - Admin hatayein\n";
        helpText += "• `/adminlist` - Authorized admins ki list\n";
        helpText += "• `/delall` - Saari expired keys ek baar mein saaf karein\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// 2. /admin Dashboard & Help Panel (Same as Start for Admins)
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    let helpText = "👑 **M1 BISKUT PANEL** 👑\n\n";
    helpText += "🔑 **Key Management:**\n";
    helpText += "• `/gen` - 30 Days ki random key\n";
    helpText += "• `/gen [days]` - Custom days ki random key (e.g., `/gen 7`)\n";
    helpText += "• `/gen [CUSTOM_KEY] [days]` - Apni marzi ki key banayein (e.g., `/gen MYVIPKEY 30`)\n";
    helpText += "• `/keylist` - Sabhi keys ki list & 1-Click Delete button\n";
    helpText += "• `/search [KEY]` - Kisi key ki details check karein\n";
    helpText += "• `/stats` - Database ke active/expired stats dekhein\n";
    helpText += "• `/mykeys` - Apni generate ki hui keys dekhein\n\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "🛡️ **Owner Exclusive Controls:**\n";
        helpText += "• `/addadmin [USER_ID]` - Naya Reseller banayein\n";
        helpText += "• `/removeadmin [USER_ID]` - Admin hatayein\n";
        helpText += "• `/adminlist` - Authorized admins ki list\n";
        helpText += "• `/delall` - Saari expired keys ek baar mein saaf karein\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// 3. Advanced Key Generation (/gen [custom_key/days] [days])
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
            createdBy: chatId
        });

        bot.sendMessage(chatId, `✅ **Key Generated Successfully!**\n\n🔑 Key: \`${customKey}\`\n⏳ Validity: ${days} Days\n📅 Expires: ${expiryDateStr}`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error: Key already exists or invalid format!`);
    }
});

// 4. Key List with 1-Click Inline Delete Buttons (/keylist)
bot.onText(/\/keylist/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    try {
        const keys = await KeyModel.find({}).sort({ expiry: -1 }).limit(20);
        if (keys.length === 0) {
            return bot.sendMessage(chatId, "📂 No license keys found in database.");
        }

        let message = "📋 **DATABASE LICENSE KEYS (Latest 20):**\n\n";
        const inlineKeyboard = [];

        keys.forEach((k, index) => {
            const isExpired = Date.now() > k.expiry;
            const statusEmoji = isExpired ? "🔴" : "🟢";
            message += `${index + 1}. \`${k.key}\` (${statusEmoji})\n`;

            inlineKeyboard.push([
                { text: `❌ Delete ${k.key}`, callback_data: `del_${k.key}` }
            ]);
        });

        bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching keys list.`);
    }
});

// Callback Query Handler for 1-Click Key Deletion via Inline Buttons
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (!(await isAdmin(chatId))) {
        return bot.answerCallbackQuery(query.id, { text: "❌ Unauthorized!", show_alert: true });
    }

    if (data.startsWith('del_')) {
        const keyToDel = data.replace('del_', '');
        try {
            const deleted = await KeyModel.findOneAndDelete({ key: keyToDel });
            if (deleted) {
                bot.answerCallbackQuery(query.id, { text: `✅ Key ${keyToDel} deleted successfully!` });
                bot.editMessageText(`🗑️ Key \`${keyToDel}\` was deleted by admin.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown'
                });
            } else {
                bot.answerCallbackQuery(query.id, { text: "⚠️ Key already deleted or not found!", show_alert: true });
            }
        } catch (e) {
            bot.answerCallbackQuery(query.id, { text: "⚠️ Database error while deleting.", show_alert: true });
        }
    }
});

// 5. Search Specific Key (/search [key])
bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const searchKey = match[1].trim().toUpperCase();
    try {
        const keyData = await KeyModel.findOne({ key: searchKey });
        if (!keyData) {
            return bot.sendMessage(chatId, `❌ Key \`${searchKey}\` database mein nahi mili.`);
        }

        const isExpired = Date.now() > keyData.expiry;
        const status = isExpired ? "🔴 EXPIRED" : "🟢 ACTIVE";
        const expiryDateStr = new Date(keyData.expiry).toLocaleString();

        let response = `🔍 **KEY SEARCH RESULT**\n\n`;
        response += `🔑 Key: \`${keyData.key}\`\n`;
        response += `📊 Status: ${status}\n`;
        response += `📅 Expires On: ${expiryDateStr}\n`;
        response += `👤 Created By ID: \`${keyData.createdBy}\``;

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error searching key.`);
    }
});

// 6. System Stats (/stats)
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    try {
        const totalKeys = await KeyModel.countDocuments();
        const totalAdmins = await AdminModel.countDocuments();
        const now = Date.now();
        const activeKeys = await KeyModel.countDocuments({ expiry: { $gt: now } });
        const expiredKeys = totalKeys - activeKeys;

        let statsMsg = "📊 **ADVANCED SYSTEM STATS** 📊\n\n";
        statsMsg += `🔑 Total Keys: \`${totalKeys}\`\n`;
        statsMsg += `🟢 Active Keys: \`${activeKeys}\`\n`;
        statsMsg += `🔴 Expired Keys: \`${expiredKeys}\`\n`;
        statsMsg += `👥 Total Resellers/Admins: \`${totalAdmins + 1}\`\n`;

        bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching stats.`);
    }
});

// 7. My Keys (/mykeys)
bot.onText(/\/mykeys/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    try {
        const keys = await KeyModel.find({ createdBy: chatId }).sort({ expiry: -1 }).limit(15);
        if (keys.length === 0) {
            return bot.sendMessage(chatId, "📂 Aapne abhi tak koi key generate nahi ki hai.");
        }

        let msgText = `📋 **YOUR GENERATED KEYS (Latest 15):**\n\n`;
        keys.forEach((k, idx) => {
            const isExpired = Date.now() > k.expiry;
            const status = isExpired ? "🔴" : "🟢";
            msgText += `${idx + 1}. \`${k.key}\` (${status})\n`;
        });

        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching your keys.`);
    }
});

// 8. Delete All Expired Keys (Owner Only)
bot.onText(/\/delall/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can perform this action!");

    try {
        const now = Date.now();
        const result = await KeyModel.deleteMany({ expiry: { $lte: now } });
        bot.sendMessage(chatId, `🧹 Cleanup complete! Deleted \`${result.deletedCount}\` expired keys from MongoDB.`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error cleaning expired keys.`);
    }
});

// 9. Add Admin (Owner Only)
bot.onText(/\/addadmin (\d+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can add admins!");

    const newAdminId = parseInt(match[1]);
    try {
        const existing = await AdminModel.findOne({ userId: newAdminId });
        if (!existing && newAdminId !== MAIN_OWNER_ID) {
            await AdminModel.create({ userId: newAdminId });
            bot.sendMessage(chatId, `✅ User \`${newAdminId}\` has been added as a Reseller/Admin!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `⚠️ This user is already an admin or the owner.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error adding admin: ${e.message}`);
    }
});

// 10. Remove Admin (Owner Only)
bot.onText(/\/removeadmin (\d+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can remove admins!");

    const targetId = parseInt(match[1]);
    if (targetId === MAIN_OWNER_ID) return bot.sendMessage(chatId, `❌ You cannot remove the Main Owner!`);

    try {
        const deleted = await AdminModel.findOneAndDelete({ userId: targetId });
        if (deleted) {
            bot.sendMessage(chatId, `🗑️ User \`${targetId}\` removed from admins list.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `⚠️ Admin not found.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error removing admin.`);
    }
});

// 11. Admin List (Owner Only)
bot.onText(/\/adminlist/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can view admin list!");

    try {
        const admins = await AdminModel.find({});
        let listMsg = "👥 **Authorized Admins/Resellers:**\n\n";
        listMsg += `1. \`${MAIN_OWNER_ID}\` (Owner)\n`;
        
        admins.forEach((admin, index) => {
            listMsg += `${index + 2}. \`${admin.userId}\`\n`;
        });

        bot.sendMessage(chatId, listMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching admin list.`);
    }
});

// --- ANDROID APP VERIFICATION API ---
app.post('/verify', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.json({ success: false, message: "Key is required!" });

    try {
        const keyData = await KeyModel.findOne({ key: key.trim() });

        if (!keyData) {
            return res.json({ success: false, message: "Invalid license key!" });
        }

        if (Date.now() > keyData.expiry) {
            return res.json({ success: false, message: "License key has expired!" });
        }

        res.json({ success: true, message: "OK" });
    } catch (e) {
        res.json({ success: false, message: "Server database error!" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
