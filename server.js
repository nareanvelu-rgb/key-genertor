const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; // Aapka Main Owner ID (Yehi sabko admin bana/hata sakega)
// ----------------------------------

const PORT = process.env.PORT || 3000;
const DB_FILE = './keys.json';
const ADMINS_FILE = './admins.json';

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(bodyParser.json());

// Database Load & Save Functions
function loadKeys() {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveKeys(keys) {
    fs.writeFileSync(DB_FILE, JSON.stringify(keys, null, 2));
}

function loadAdmins() {
    let admins = [MAIN_OWNER_ID]; // Main owner hamesha admin rahega
    if (fs.existsSync(ADMINS_FILE)) {
        const savedAdmins = JSON.parse(fs.readFileSync(ADMINS_FILE));
        admins = [...new Set([...admins, ...savedAdmins])];
    }
    return admins;
}

function saveAdmins(admins) {
    // Main owner ko chhod kar baki save karein
    const filtered = admins.filter(id => id !== MAIN_OWNER_ID);
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(filtered, null, 2));
}

function isAdmin(userId) {
    const admins = loadAdmins();
    return admins.includes(userId);
}

// --- TELEGRAM BOT COMMANDS ---

// 1. /admin Dashboard & Help Panel
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    let helpText = `👑 **M1 CHEATS ADMIN PANEL** 👑\n\n`;
    helpText += `🔑 **Key Management:**\n`;
    helpText += `• \`/gen\` - 30 Days ki default key banayein\n`;
    helpText += `• \`/gen 7\` - 7 Days ki key banayein (Example)\n`;
    helpText += `• \`/del [KEY]\` - Koi bhi key delete karein\n\n`;

    if (chatId === MAIN_OWNER_ID) {
        helpText += `🛡️ **Owner Controls (Aapke liye):**\n`;
        helpText += `• \`/addadmin [USER_ID]\` - Naya Reseller/Admin banayein\n`;
        helpText += `• \`/removeadmin [USER_ID]\` - Admin hatayein\n`;
        helpText += `• \`/adminlist` - Sabhi admins ki list dekhein\n`;
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// 2. Key Generation (/gen [days])
bot.onText(/\/gen(?: (\d+))?/, (msg, match) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const days = match[1] ? parseInt(match[1]) : 30;
    const keys = loadKeys();
    
    const randomKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    keys[randomKey] = { expiry: expiryTime, createdBy: chatId };
    saveKeys(keys);

    bot.sendMessage(chatId, `✅ **Key Generated Successfully!**\n\n🔑 Key: \`${randomKey}\`\n⏳ Validity: ${days} Days`, { parse_mode: 'Markdown' });
});

// 3. Delete Key (/del [key])
bot.onText(/\/del (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const keyToDelete = match[1].trim();
    const keys = loadKeys();

    if (keys[keyToDelete]) {
        delete keys[keyToDelete];
        saveKeys(keys);
        bot.sendMessage(chatId, `🗑️ Key \`${keyToDelete}\` deleted successfully!`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, `⚠️ Key not found in database.`);
    }
});

// 4. Add Admin / Reseller (Only Main Owner)
bot.onText(/\/addadmin (\d+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can add admins!");

    const newAdminId = parseInt(match[1]);
    let admins = loadAdmins();

    if (!admins.includes(newAdminId)) {
        admins.push(newAdminId);
        saveAdmins(admins);
        bot.sendMessage(chatId, `✅ User \`${newAdminId}\` has been added as a Reseller/Admin!`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, `⚠️ This user is already an admin.`);
    }
});

// 5. Remove Admin (Only Main Owner)
bot.onText(/\/removeadmin (\d+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can remove admins!");

    const targetId = parseInt(match[1]);
    if (targetId === MAIN_OWNER_ID) return bot.sendMessage(chatId, `❌ You cannot remove the Main Owner!`);

    let admins = loadAdmins();
    admins = admins.filter(id => id !== targetId);
    saveAdmins(admins);

    bot.sendMessage(chatId, `🗑️ User \`${targetId}\` removed from admins list.`, { parse_mode: 'Markdown' });
});

// 6. Admin List (Only Main Owner)
bot.onText(/\/adminlist/, (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Only Main Owner can view admin list!");

    const admins = loadAdmins();
    let listMsg = `👥 **Authorized Admins/Resellers:**\n\n`;
    admins.forEach((id, index) => {
        listMsg += `${index + 1}. \`${id}\` ${id === MAIN_OWNER_ID ? '(Owner)' : ''}\n`;
    });

    bot.sendMessage(chatId, listMsg, { parse_mode: 'Markdown' });
});

// --- ANDROID APP VERIFICATION API ---
app.post('/verify', (req, res) => {
    const { key } = req.body;
    if (!key) return res.json({ success: false, message: "Key is required!" });

    const keys = loadKeys();
    const keyData = keys[key];

    if (!keyData) {
        return res.json({ success: false, message: "Invalid license key!" });
    }

    if (Date.now() > keyData.expiry) {
        return res.json({ success: false, message: "License key has expired!" });
    }

    res.json({ success: true, message: "OK" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
