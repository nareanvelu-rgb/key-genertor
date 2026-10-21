const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; // Aapka Main Owner ID

// Apni MongoDB Atlas connection string yahan daalein (Render par Environment Variable me bhi daal sakte hain)
const MONGO_URI = process.env.MONGO_URI || 'YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE';
// ----------------------------------

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

// Helper Functions using MongoDB
async function loadAdmins() {
    let admins = [MAIN_OWNER_ID];
    try {
        const dbAdmins = await AdminModel.find({});
        dbAdmins.forEach(admin => admins.push(admin.userId));
    } catch (e) {
        console.error("Error loading admins:", e);
    }
    return [...new Set(admins)];
}

async function isAdmin(userId) {
    if (userId === MAIN_OWNER_ID) return true;
    const admin = await AdminModel.findOne({ userId: userId });
    return !!admin;
}

// --- TELEGRAM BOT COMMANDS ---

// 1. /admin Dashboard & Help Panel
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    let helpText = "👑 **M1 CHEATS ADMIN PANEL** 👑\n\n";
    helpText += "🔑 **Key Management:**\n";
    helpText += "• /gen - 30 Days ki default key banayein\n";
    helpText += "• /gen 7 - 7 Days ki key banayein (Example)\n";
    helpText += "• /del [KEY] - Koi bhi key delete karein\n\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "🛡️ **Owner Controls (Aapke liye):**\n";
        helpText += "• /addadmin [USER_ID] - Naya Reseller/Admin banayein\n";
        helpText += "• /removeadmin [USER_ID] - Admin hatayein\n";
        helpText += "• /adminlist - Sabhi admins ki list dekhein\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// 2. Key Generation (/gen [days])
bot.onText(/\/gen(?: (\d+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const days = match[1] ? parseInt(match[1]) : 30;
    
    const randomKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    try {
        await KeyModel.create({
            key: randomKey,
            expiry: expiryTime,
            createdBy: chatId
        });

        bot.sendMessage(chatId, `✅ **Key Generated Successfully!**\n\n🔑 Key: \`${randomKey}\`\n⏳ Validity: ${days} Days`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error generating key. Please try again.`);
    }
});

// 3. Delete Key (/del [key])
bot.onText(/\/del (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const keyToDelete = match[1].trim();

    try {
        const deleted = await KeyModel.findOneAndDelete({ key: keyToDelete });
        if (deleted) {
            bot.sendMessage(chatId, `🗑️ Key \`${keyToDelete}\` deleted successfully!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `⚠️ Key not found in database.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error deleting key.`);
    }
});

// 4. Add Admin / Reseller (Only Main Owner)
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
        bot.sendMessage(chatId, `⚠️ Error adding admin.`);
    }
});

// 5. Remove Admin (Only Main Owner)
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

// 6. Admin List (Only Main Owner)
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
