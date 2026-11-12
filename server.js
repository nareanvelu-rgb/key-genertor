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
    userId: { type: Number, required: true, unique: true },
    credits: { type: Number, default: 0 } // 🔥 Admin Credits Field
});

const KeyModel = mongoose.model('Key', keySchema);
const AdminModel = mongoose.model('Admin', adminSchema);

// Helper function to check if user is Admin or Main Owner
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
            keyData.hwid = hwid;
            await keyData.save();
            console.log(`[AUTH] Key ${key} locked to new HWID: ${hwid}`);
            return res.json({ success: true, message: "Login Successful! Device Locked." });
        } 
        else if (keyData.hwid !== hwid) {
            console.log(`[ALERT] Key ${key} tried to login from unauthorized HWID: ${hwid}. (Original: ${keyData.hwid})`);
            return res.json({ 
                success: false, 
                message: "Device Mismatch!\nThis key is already locked to another device.\nContact @m1cheatshopbot to reset." 
            });
        }

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
    helpText += "• `/mycredits` - Check your remaining credits\n";
    
    if (chatId === MAIN_OWNER_ID) {
        helpText += "\n⚡ **OWNER COMMANDS:**\n";
        helpText += "• `/addadmin [ID] [Credits]` - Add Admin with Credits\n";
        helpText += "• `/addcredits [ID] [Credits]` - Add Credits to Admin\n";
        helpText += "• `/deladmin [ID]` - Remove Admin\n";
        helpText += "• `/adminlist` - View All Admins & Credits\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// --- CHECK CREDITS COMMAND ---
bot.onText(/\/mycredits/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    if (chatId === MAIN_OWNER_ID) {
        return bot.sendMessage(chatId, "👑 **Main Owner:** Aapke paas **Unlimited** credits hain!", { parse_mode: 'Markdown' });
    }

    try {
        const adminData = await AdminModel.findOne({ userId: chatId });
        const credits = adminData ? adminData.credits : 0;
        bot.sendMessage(chatId, `💰 **Your Remaining Credits:** \`${credits}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching credits.`);
    }
});

// --- OWNER ONLY: ADD ADMIN WITH CREDITS ---
bot.onText(/\/addadmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const input = match[1] ? match[1].trim().split(" ") : [];
    const newAdminId = parseInt(input[0]);
    const credits = parseInt(input[1]) || 0;

    if (!newAdminId || isNaN(newAdminId)) {
        return bot.sendMessage(chatId, "⚠️ Sahi format use karo!\nUsage: `/addadmin 123456789 500`", { parse_mode: 'Markdown' });
    }

    try {
        await AdminModel.create({ userId: newAdminId, credits: credits });
        bot.sendMessage(chatId, `✅ Successfully added \`${newAdminId}\` as Admin with **${credits}** credits!`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Yeh user pehle se admin hai ya database error hai.`);
    }
});

// --- OWNER ONLY: ADD CREDITS TO ADMIN ---
bot.onText(/\/addcredits(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const input = match[1] ? match[1].trim().split(" ") : [];
    const targetId = parseInt(input[0]);
    const addAmt = parseInt(input[1]);

    if (!targetId || isNaN(targetId) || isNaN(addAmt)) {
        return bot.sendMessage(chatId, "⚠️ Sahi format use karo!\nUsage: `/addcredits 123456789 100`", { parse_mode: 'Markdown' });
    }

    try {
        const adminData = await AdminModel.findOneAndUpdate(
            { userId: targetId },
            { $inc: { credits: addAmt } },
            { new: true }
        );

        if (adminData) {
            bot.sendMessage(chatId, `✅ Successfully added ${addAmt} credits to \`${targetId}\`.\n💰 New Balance: **${adminData.credits}**`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Yeh user admin list mein nahi mila.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error updating credits.`);
    }
});

// --- OWNER ONLY: REMOVE ADMIN ---
bot.onText(/\/deladmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const targetId = parseInt(match[1]);
    if (!targetId || isNaN(targetId)) {
        return bot.sendMessage(chatId, "⚠️ Sahi Telegram User ID do!\nUsage: `/deladmin 123456789`", { parse_mode: 'Markdown' });
    }

    try {
        const deleted = await AdminModel.findOneAndDelete({ userId: targetId });
        if (deleted) {
            bot.sendMessage(chatId, `✅ Successfully removed \`${targetId}\` from Admins.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Yeh user admin list mein nahi mila.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error removing admin.`);
    }
});

// --- OWNER ONLY: ADMIN LIST WITH CREDITS ---
bot.onText(/\/adminlist/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    try {
        const admins = await AdminModel.find({});
        let msgText = `👑 **Main Owner:** \`${MAIN_OWNER_ID}\` (Unlimited Credits)\n\n🛡️ **Sub-Admins & Credits:**\n`;
        
        if (admins.length === 0) {
            msgText += "Koi sub-admin nahi hai abhi.";
        } else {
            admins.forEach((adm, index) => {
                msgText += `${index + 1}. ID: \`${adm.userId}\` | Credits: **${adm.credits}**\n`;
            });
        }
        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching admin list.`);
    }
});

// --- KEY GENERATION WITH CREDIT DEDUCTION ---
bot.onText(/\/gen(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    let inputArg = match[1] ? match[1].trim() : "";
    let customKey = "";
    let days = 30;

    if (inputArg) {
        const parts = inputArg.split(" ");
        if (parts.length === 2) { 
            customKey = parts[0].toUpperCase(); 
            days = parseInt(parts[1]) || 30; 
        } 
        else if (!isNaN(parts[0])) { 
            days = parseInt(parts[0]) || 30; 
        } 
        else { 
            customKey = parts[0].toUpperCase(); 
        }
    }

    // Check credits if user is NOT the main owner
    if (chatId !== MAIN_OWNER_ID) {
        try {
            const adminData = await AdminModel.findOne({ userId: chatId });
            if (!adminData || adminData.credits < days) {
                const currentCreds = adminData ? adminData.credits : 0;
                return bot.sendMessage(chatId, `❌ **Insufficient Credits!**\nYou need **${days}** credits to generate a ${days}-day key, but you only have **${currentCreds}** credits.\nContact Main Owner to recharge.`, { parse_mode: 'Markdown' });
            }

            // Deduct credits equal to days
            adminData.credits -= days;
            await adminData.save();
        } catch (e) {
            return bot.sendMessage(chatId, `⚠️ Database error while checking credits.`);
        }
    }

    if (!customKey) {
        customKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    try {
        await KeyModel.create({ key: customKey, expiry: expiryTime, createdBy: chatId, hwid: null });
        
        let successMsg = `✅ **Key Generated!**\n🔑 Key: \`${customKey}\`\n⏳ Days: ${days}`;
        if (chatId !== MAIN_OWNER_ID) {
            const updatedAdmin = await AdminModel.findOne({ userId: chatId });
            successMsg += `\n💰 Remaining Credits: **${updatedAdmin.credits}**`;
        }
        
        bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
    } catch (e) { 
        // Agar key pehle se exist karti hai toh cut hue credits wapas refund kar do agar owner nahi hai
        if (chatId !== MAIN_OWNER_ID) {
            await AdminModel.findOneAndUpdate({ userId: chatId }, { $inc: { credits: days } });
        }
        bot.sendMessage(chatId, `⚠️ Key already exists! (Credits refunded)`); 
    }
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
