const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q'; 
const MAIN_OWNER_ID = 1834775993; // Aapka Main Owner ID
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
    let admins = [MAIN_OWNER_ID];
    if (fs.existsSync(ADMINS_FILE)) {
        const savedAdmins = JSON.parse(fs.readFileSync(ADMINS_FILE));
        admins = [...new Set([...admins, ...savedAdmins])];
    }
    return admins;
}

function saveAdmins(admins) {
    const filtered = admins.filter(id => id !== MAIN_OWNER_ID);
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(filtered, null, 2));
}

function isAdmin(userId) {
    const admins = loadAdmins();
    return admins.includes(userId);
}

// --- ROOT ROUTE (Render & UptimeRobot ke liye zaroori) ---
app.get('/', (req, res) => {
    res.send('Hy2droid License Server is running successfully 🚀');
});

// --- TELEGRAM BOT COMMANDS ---

// 0. Start Command (Role-based restriction)
bot.onText(/\/start/, (msg) => {
    const chatId = msg.from.id;
    
    if (!isAdmin(chatId)) {
        return bot.sendMessage(
            chatId, 
            "❌ **Access Denied!**\n\nYou are not allowed to use this bot. Contact the owner to get access.", 
            { parse_mode: 'Markdown' }
        );
    }

    let welcomeText = `🚀 **Welcome to M1 CHEATS License Hub**\n\n`;
    welcomeText += `Aap authorized reseller/admin hain. Niche diye gaye commands use karein:\n\n`;
    welcomeText += `🔑 \`/gen [Days] [Devices]\` - New Key banayein (Ex: \`/gen 30 1\`)\n`;
    welcomeText += `📋 \`/listkeys\` - Sabhi keys aur unki details dekhein\n`;
    welcomeText += `🚫 \`/block [KEY]\` - Kisi key ko ban/disable karein\n`;
    welcomeText += `▶️ \`/unblock [KEY]\` - Block ki hui key ko wapas chalu karein\n`;
    welcomeText += `🗑️ \`/del [KEY]\` - Key ko permanent delete karein\n`;

    if (chatId === MAIN_OWNER_ID) {
        welcomeText += `\n👑 **Owner Special Controls:**\n`;
        welcomeText += `• \`/addadmin [ID]\` - Naya Admin banayein\n`;
        welcomeText += `• \`/removeadmin [ID]\` - Admin hatayein\n`;
        welcomeText += `• \`/adminlist\` - Admins ki list dekhein\n`;
    }

    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
});

// 1. /admin Dashboard Panel
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    let helpText = `👑 **M1 CHEATS ADMIN PANEL** 👑\n\n`;
    helpText += `🔑 **Key Commands:**\n`;
    helpText += `• \`/gen 30 1\` - 30 Days & 1 Device key\n`;
    helpText += `• \`/listkeys\` - View all generated keys & usage\n`;
    helpText += `• \`/block [KEY]\` - Pause/Block a key\n`;
    helpText += `• \`/unblock [KEY]\` - Resume a blocked key\n`;
    helpText += `• \`/del [KEY]\` - Delete a key\n\n`;

    if (chatId === MAIN_OWNER_ID) {
        helpText += `🛡️ **Owner Controls:**\n`;
        helpText += `• \`/addadmin [ID]\`\n• \`/removeadmin [ID]\`\n• \`/adminlist\``;
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// 2. Key Generation (/gen [days] [maxDevices])
bot.onText(/\/gen(?: (\d+))?(?: (\d+))?/, (msg, match) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const days = match[1] ? parseInt(match[1]) : 30;
    const maxDevices = match[2] ? parseInt(match[2]) : 1;
    const keys = loadKeys();
    
    const randomKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + 
                      '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    keys[randomKey] = { 
        expiry: expiryTime, 
        maxDevices: maxDevices, 
        devices: [], 
        status: 'active', // active, blocked
        createdBy: chatId 
    };
    saveKeys(keys);

    let resMsg = `✅ **Key Generated Successfully!**\n\n`;
    resMsg += `🔑 Key: \`${randomKey}\`\n`;
    resMsg += `⏳ Validity: ${days} Days\n`;
    resMsg += `📱 Max Devices: ${maxDevices}\n`;
    resMsg += `💡 Example to use in app: Copy this key and paste it on login screen.`;

    bot.sendMessage(chatId, resMsg, { parse_mode: 'Markdown' });
});

// 3. List All Keys with Status (`/listkeys`)
bot.onText(/\/listkeys/, (msg) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const keys = loadKeys();
    const keyList = Object.keys(keys);

    if (keyList.length === 0) {
        return bot.sendMessage(chatId, "📂 Database me abhi koi key nahi hai.");
    }

    let msgText = `📋 **ALL GENERATED KEYS (${keyList.length}):**\n\n`;
    keyList.forEach((k, index) => {
        const data = keys[k];
        const statusIcon = data.status === 'blocked' ? '🔴 BLOCKED' : (Date.now() > data.expiry ? '⏳ EXPIRED' : '🟢 ACTIVE');
        const timeLeft = Math.max(0, Math.ceil((data.expiry - Date.now()) / (1000 * 60 * 60 * 24)));
        
        msgText += `${index + 1}. \`${k}\`\n`;
        msgText += `   Status: ${statusIcon} | Left: ${timeLeft}d\n`;
        msgText += `   Devices Used: ${data.devices.length}/${data.maxDevices}\n\n`;
    });

    bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
});

// 4. Block/Pause Key (`/block [key]`)
bot.onText(/\/block (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const keyToBlock = match[1].trim();
    const keys = loadKeys();

    if (keys[keyToBlock]) {
        keys[keyToBlock].status = 'blocked';
        saveKeys(keys);
        bot.sendMessage(chatId, `🚫 Key \`${keyToBlock}\` has been **blocked/paused** successfully!`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, `⚠️ Key not found.`);
    }
});

// 5. Unblock Key (`/unblock [key]`)
bot.onText(/\/unblock (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ You are not authorized!");

    const keyToUnblock = match[1].trim();
    const keys = loadKeys();

    if (keys[keyToUnblock]) {
        keys[keyToUnblock].status = 'active';
        saveKeys(keys);
        bot.sendMessage(chatId, `✅ Key \`${keyToUnblock}\` has been **unblocked** successfully!`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, `⚠️ Key not found.`);
    }
});

// 6. Delete Key (/del [key])
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

// 7. Add Admin / Reseller (Only Main Owner)
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

// 8. Remove Admin (Only Main Owner)
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

// 9. Admin List (Only Main Owner)
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
    const { key, deviceId } = req.body;
    if (!key) return res.json({ success: false, message: "Key is required!" });
    if (!deviceId) return res.json({ success: false, message: "Device ID is missing!" });

    const keys = loadKeys();
    const keyData = keys[key];

    if (!keyData) {
        return res.json({ success: false, message: "Invalid license key!" });
    }

    // Check if key is blocked by admin/owner
    if (keyData.status === 'blocked') {
        return res.json({ success: false, message: "This license key has been blocked by admin!" });
    }

    // Check if key is expired
    if (Date.now() > keyData.expiry) {
        return res.json({ success: false, message: "License key has expired!" });
    }

    if (!keyData.devices) keyData.devices = [];
    if (!keyData.maxDevices) keyData.maxDevices = 1;

    // Check if device already registered
    if (keyData.devices.includes(deviceId)) {
        return res.json({ success: true, message: "OK" });
    }

    // Check device limit exceeded
    if (keyData.devices.length >= keyData.maxDevices) {
        return res.json({ success: false, message: "Device limit exceeded for this key!" });
    }

    // Register new device
    keyData.devices.push(deviceId);
    saveKeys(keys);

    res.json({ success: true, message: "OK" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
