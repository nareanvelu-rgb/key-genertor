const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');

// --- APNI DETAILS YAHAN DAALEIN ---
const TOKEN = '8896652566:AAGS9oPW8sRZ-5964-Js4whQdYGPNuD443Q';
const MAIN_OWNER_ID = 1834775993;

// ⚠️ YAHAN APNA SAHI MONGODB ATLAS LINK DAALO
const MONGO_URI = process.env.MONGO_URI || 'YOUR_MONGODB_ATLAS_CONNECTION_STRING_HERE';
const PORT = process.env.PORT || 3000;

// --- AROLINKS & FREE 12H KEY SETTINGS ---
const AROLINKS_API_KEY = process.env.AROLINKS_API_KEY || 'ad0491fe393247ceeea006bbb9e13239be255e94';
const CLAIM_PAGE_URL = process.env.CLAIM_PAGE_URL || 'https://m1cheats-freekey.netlify.app/';
const LINK_SECRET = process.env.LINK_SECRET || 'M1_FREE_KEY_SECRET_2026';

const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 🔥 HEALTH CHECK ROUTE ---
app.get('/', (req, res) => {
    res.status(200).send('🚀 M1 Biskut Bot & License Server is Active and Running!');
});

// --- MONGODB SCHEMAS ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const keySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    expiry: { type: Number, required: true },
    createdBy: { type: Number, required: true },
    hwid: { type: String, default: null },
    isPaused: { type: Boolean, default: false },
    pausedRemainingTime: { type: Number, default: 0 }
});

const adminSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    credits: { type: Number, default: 0 }
});

const settingSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    value: { type: String }
});

const freeSessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    deviceHash: { type: String, default: null },
    deviceInfo: { type: Object, default: null },
    status: { type: String, default: 'pending' }, // pending -> claimed
    issuedKey: { type: String, default: null },
    createdAt: { type: Number, default: () => Date.now() },
    expiresAt: { type: Number, required: true }
});

const deviceCooldownSchema = new mongoose.Schema({
    deviceHash: { type: String, required: true, unique: true },
    deviceInfo: { type: Object, default: null },
    lastGeneratedAt: { type: Number, required: true },
    lastKey: { type: String, default: null }
});

const KeyModel = mongoose.model('Key', keySchema);
const AdminModel = mongoose.model('Admin', adminSchema);
const SettingModel = mongoose.model('Setting', settingSchema);
const FreeSessionModel = mongoose.model('FreeSession', freeSessionSchema);
const DeviceCooldownModel = mongoose.model('DeviceCooldown', deviceCooldownSchema);

// Helper functions
async function isAdmin(userId) {
    if (userId === MAIN_OWNER_ID) return true;
    try {
        const admin = await AdminModel.findOne({ userId: userId });
        return !!admin;
    } catch (e) { return false; }
}

async function isMaintenanceMode() {
    const setting = await SettingModel.findOne({ name: 'maintenance' });
    return setting && setting.value === 'true';
}

function makeToken(sessionId) {
    return crypto.createHmac('sha256', LINK_SECRET).update(sessionId).digest('hex').slice(0, 24);
}

function normalizeDeviceHash(rawHash) {
    if (!rawHash || typeof rawHash !== 'string') return null;
    const clean = rawHash.trim().toLowerCase();
    return /^[a-f0-9]{16,128}$/.test(clean) ? clean : null;
}

function formatRemainingTime(ms) {
    const totalSeconds = Math.max(1, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

async function checkDeviceCooldown(deviceHash) {
    if (!deviceHash) return { blocked: false };
    const record = await DeviceCooldownModel.findOne({ deviceHash });
    if (!record) return { blocked: false, record: null };

    const elapsed = Date.now() - record.lastGeneratedAt;
    if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        return {
            blocked: true,
            remainingMs,
            remainingText: formatRemainingTime(remainingMs),
            nextAllowedAt: record.lastGeneratedAt + COOLDOWN_MS,
            record
        };
    }
    return { blocked: false, record };
}

function makeUnique12hKey() {
    const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const p3 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `M1-12H-${p1}-${p2}-${p3}`;
}

async function createTwelveHourKeyInDb() {
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    for (let attempt = 0; attempt < 5; attempt++) {
        const newKey = makeUnique12hKey();
        const expiryTime = Date.now() + twelveHoursMs;
        try {
            await KeyModel.create({
                key: newKey,
                expiry: expiryTime,
                createdBy: MAIN_OWNER_ID,
                hwid: null,
                isPaused: false,
                pausedRemainingTime: 0
            });
            return { key: newKey, expiry: expiryTime };
        } catch (err) {
            if (err.code !== 11000) throw err;
        }
    }
    throw new Error('Could not generate unique key');
}

// --- 🔥 FREE 12H KEY API (DEVICE CHECK + 12HR COOLDOWN) ---
app.post('/api/free-key/start', async (req, res) => {
    try {
        if (await isMaintenanceMode()) {
            return res.json({ success: false, message: 'Server maintenance mein hai, baad mein try karo.' });
        }

        const deviceHash = normalizeDeviceHash(req.body?.deviceHash);
        const deviceInfo = req.body?.deviceInfo && typeof req.body.deviceInfo === 'object' ? req.body.deviceInfo : null;

        if (!deviceHash) {
            return res.json({ success: false, message: 'Device info read nahi ho paya. Browser refresh karke try karo.' });
        }

        const cooldown = await checkDeviceCooldown(deviceHash);
        if (cooldown.blocked) {
            return res.json({
                success: false,
                cooldown: true,
                remainingMs: cooldown.remainingMs,
                nextAllowedAt: cooldown.nextAllowedAt,
                message: `please wait 12hrs before generating new key (${cooldown.remainingText} remaining)`
            });
        }

        const now = Date.now();
        const sessionId = crypto.randomUUID();
        const token = makeToken(sessionId);
        const sep = CLAIM_PAGE_URL.includes('?') ? '&' : '?';
        const destinationUrl = `${CLAIM_PAGE_URL}${sep}sid=${encodeURIComponent(sessionId)}&tok=${encodeURIComponent(token)}`;
        const uniqueAlias = `m1_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

        const apiUrl = `https://arolinks.com/api?api=${encodeURIComponent(AROLINKS_API_KEY)}&url=${encodeURIComponent(destinationUrl)}&alias=${encodeURIComponent(uniqueAlias)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!data || data.status === 'error' || !data.shortenedUrl) {
            return res.json({ success: false, message: (data && data.message) || 'Arolinks short link create nahi ho paya.' });
        }

        await FreeSessionModel.create({
            sessionId,
            token,
            deviceHash,
            deviceInfo,
            status: 'pending',
            issuedKey: null,
            createdAt: now,
            expiresAt: now + (30 * 60 * 1000)
        });

        return res.json({
            success: true,
            shortUrl: data.shortenedUrl
        });
    } catch (e) {
        console.error('Free key start error:', e);
        return res.json({ success: false, message: 'Server error while starting task.' });
    }
});

app.post('/api/free-key/claim', async (req, res) => {
    try {
        if (await isMaintenanceMode()) {
            return res.json({ success: false, message: 'Server maintenance mein hai.' });
        }

        const { sid, tok } = req.body || {};
        const incomingDeviceHash = normalizeDeviceHash(req.body?.deviceHash);
        const incomingDeviceInfo = req.body?.deviceInfo && typeof req.body.deviceInfo === 'object' ? req.body.deviceInfo : null;

        if (!sid || !tok || makeToken(sid) !== tok) {
            return res.json({ success: false, message: 'Invalid ya tampered session link!' });
        }

        const session = await FreeSessionModel.findOne({ sessionId: sid, token: tok });
        if (!session) {
            return res.json({ success: false, message: 'Session nahi mila!' });
        }

        const effectiveDeviceHash = incomingDeviceHash || session.deviceHash;
        if (!effectiveDeviceHash) {
            return res.json({ success: false, message: 'Device info missing hai.' });
        }

        // Agar isi exact link ko refresh kare toh is link ki key dikhaye
        if (session.status === 'claimed' && session.issuedKey) {
            return res.json({
                success: true,
                alreadyClaimed: true,
                key: session.issuedKey,
                expiresAt: session.expiresAt
            });
        }

        const cooldown = await checkDeviceCooldown(effectiveDeviceHash);
        if (cooldown.blocked) {
            return res.json({
                success: false,
                cooldown: true,
                remainingMs: cooldown.remainingMs,
                nextAllowedAt: cooldown.nextAllowedAt,
                message: `please wait 12hrs before generating new key (${cooldown.remainingText} remaining)`
            });
        }

        if (Date.now() > session.expiresAt) {
            return res.json({ success: false, message: 'Link expire ho gaya! Naya task start karo.' });
        }

        const created = await createTwelveHourKeyInDb();
        const now = Date.now();

        session.status = 'claimed';
        session.issuedKey = created.key;
        session.deviceHash = effectiveDeviceHash;
        if (incomingDeviceInfo) session.deviceInfo = incomingDeviceInfo;
        await session.save();

        await DeviceCooldownModel.findOneAndUpdate(
            { deviceHash: effectiveDeviceHash },
            {
                $set: {
                    deviceInfo: incomingDeviceInfo || session.deviceInfo || null,
                    lastGeneratedAt: now,
                    lastKey: created.key
                }
            },
            { upsert: true, new: true }
        );

        return res.json({
            success: true,
            alreadyClaimed: false,
            key: created.key,
            expiresAt: created.expiry
        });
    } catch (e) {
        console.error('Free key claim error:', e);
        return res.json({ success: false, message: 'Key generate karne mein error aaya.' });
    }
});

// --- 🔥 VERIFICATION API WITH MAINTENANCE CHECK ---
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;

    if (!key || !hwid) {
        return res.json({ success: false, message: "Key and HWID are required!" });
    }

    try {
        if (await isMaintenanceMode()) {
            return res.json({ 
                success: false, 
                message: "⚠️ MAINTENANCE MODE ⚠️\n\nServer is under maintenance.\nPLEASE WAIT!\n\nTry again later." 
            });
        }

        let keyData = await KeyModel.findOne({ key: key.trim().toUpperCase() });

        if (!keyData) {
            return res.json({ success: false, message: "Invalid license key!" });
        }

        if (keyData.isPaused) {
            return res.json({ success: false, message: "⚠️ Keys are currently paused by Owner. Try again later!" });
        }

        if (Date.now() > keyData.expiry) {
            return res.json({ success: false, message: "Key Expired!\nRenew from @m1cheatshopbot or DM Biskut" });
        }

        if (keyData.hwid === null || keyData.hwid === "") {
            keyData.hwid = hwid;
            await keyData.save();
            return res.json({ success: true, message: "Login Successful! Device Locked." });
        } else if (keyData.hwid !== hwid) {
            return res.json({ success: false, message: "Device Mismatch!\nThis key is locked to another device.\nContact @m1cheatshopbot to reset." });
        }

        res.json({ success: true, message: "Login Successful!" });
    } catch (e) {
        console.error("Server Error:", e);
        res.json({ success: false, message: "Server database error!" });
    }
});

// --- /start COMMAND ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Access Denied!");

    let helpText = "👑 **M1 BISKUT KEY GENERATOR** 👑\n\n";
    helpText += "• `/gen [days]` - Generate Key\n";
    helpText += "• `/gen [KEY] [days]` - Custom Key\n";
    helpText += "• `/mykeys` - View your keys\n";
    helpText += "• `/reset [KEY]` - Reset HWID\n";
    helpText += "• `/mycredits` - Check credits\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "\n🔧 **OWNER MAINTENANCE MODE:**\n";
        helpText += "• `/maintenance on` - 🔒 Enable Maintenance\n";
        helpText += "• `/maintenance off` - 🔓 Disable Maintenance\n";
        helpText += "• `/maintenance status` - Check status\n\n";

        helpText += "\n📦 **BULK KEY GENERATION (OWNER ONLY):**\n";
        helpText += "• `/bulk [count] [days]` - Generate multiple keys\n";
        helpText += "   Example: `/bulk 4000 30` (4000 keys, 30 days)\n\n";

        helpText += "⚡ **STATS:**\n";
        helpText += "• `/resellerstats` - Reseller stats\n";
        helpText += "• `/resellerkeys [ID]` - View reseller keys\n";
        helpText += "• `/allkeys` - All keys\n";
        helpText += "• `/systemstats` - Dashboard\n\n";

        helpText += "⏸️ **PAUSE CONTROL:**\n";
        helpText += "• `/pausekeys` - Pause all keys\n";
        helpText += "• `/unpausekeys` - Resume all keys\n\n";

        helpText += "🗑️ **CLEANUP:**\n";
        helpText += "• `/delkey [KEY]` - Delete key\n";
        helpText += "• `/resellerdelkeys [ID]` - Delete reseller keys\n";
        helpText += "• `/deloldkeys` - Delete expired/unused\n";
        helpText += "• `/delallkeys` - Delete ALL keys\n\n";

        helpText += "👑 **ADMIN MGMT:**\n";
        helpText += "• `/addadmin [ID] [Credits]`\n";
        helpText += "• `/addcredits [ID] [Credits]`\n";
        helpText += "• `/deladmin [ID]`\n";
        helpText += "• `/adminlist`\n";
        helpText += "• `/broadcast [Message]`\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// --- 🔥 OWNER ONLY: MAINTENANCE MODE CONTROL ---
bot.onText(/\/maintenance(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const arg = match[1] ? match[1].toLowerCase().trim() : "";

    if (arg === 'on') {
        try {
            await SettingModel.findOneAndUpdate(
                { name: 'maintenance' },
                { value: 'true' },
                { upsert: true, new: true }
            );
            bot.sendMessage(chatId, "🔒 **MAINTENANCE MODE ON**\n\nAb koi bhi user panel access nahi kar payega. Sabko 'MAINTENANCE PLEASE WAIT' message dikhega.", { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, `⚠️ Error enabling maintenance: ${e.message}`);
        }
    } else if (arg === 'off') {
        try {
            await SettingModel.findOneAndUpdate(
                { name: 'maintenance' },
                { value: 'false' },
                { upsert: true, new: true }
            );
            bot.sendMessage(chatId, "🔓 **MAINTENANCE MODE OFF**\n\nAb sab users normal access kar sakte hain.", { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, `⚠️ Error disabling maintenance: ${e.message}`);
        }
    } else if (arg === 'status') {
        const isOn = await isMaintenanceMode();
        bot.sendMessage(chatId, `🔧 **Maintenance Status:** ${isOn ? '🔒 ON (Panel locked)' : '🔓 OFF (Panel active)'}`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, "⚠️ **Usage:**\n`/maintenance on` - Enable\n`/maintenance off` - Disable\n`/maintenance status` - Check", { parse_mode: 'Markdown' });
    }
});

// --- 🔥 OWNER ONLY: BULK KEY GENERATION ---
bot.onText(/\/bulk(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const input = match[1] ? match[1].trim().split(" ") : [];
    const count = parseInt(input[0]);
    const days = parseInt(input[1]) || 30;

    if (!count || isNaN(count) || count < 1 || count > 10000) {
        return bot.sendMessage(chatId, "⚠️ **Sahi format use karo!**\n\nUsage: `/bulk [count] [days]`\nExample: `/bulk 4000 30`\n\n• Max 10,000 keys ek baar mein\n• Days default 30 hain", { parse_mode: 'Markdown' });
    }

    const statusMsg = await bot.sendMessage(chatId, `⏳ Generating **${count}** keys (${days} days)...\n\nPlease wait...`, { parse_mode: 'Markdown' });

    try {
        const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
        const keysBatch = [];
        const generatedKeys = [];
        const usedSet = new Set();

        while (generatedKeys.length < count) {
            const randomPart1 = Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, 'X');
            const randomPart2 = Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, 'X');
            const randomPart3 = Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, 'X');
            const newKey = `M1-${randomPart1}-${randomPart2}-${randomPart3}`;

            if (!usedSet.has(newKey)) {
                usedSet.add(newKey);
                generatedKeys.push(newKey);
                keysBatch.push({
                    key: newKey,
                    expiry: expiryTime,
                    createdBy: chatId,
                    hwid: null,
                    isPaused: false
                });
            }
        }

        let inserted = 0;
        const chunkSize = 1000;
        for (let i = 0; i < keysBatch.length; i += chunkSize) {
            const chunk = keysBatch.slice(i, i + chunkSize);
            const result = await KeyModel.insertMany(chunk, { ordered: false });
            inserted += result.length;

            if (i % 2000 === 0 && i > 0) {
                await bot.editMessageText(
                    `⏳ Generating keys...\n\n✅ **${inserted}/${count}** completed`,
                    { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
                ).catch(() => {});
            }
        }

        const keysText = generatedKeys.join('\n');
        const fileName = `bulk_keys_${count}_${days}days.txt`;

        await bot.sendDocument(
            chatId,
            Buffer.from(keysText, 'utf-8'),
            {
                caption: `✅ **${count} Keys Generated Successfully!**\n\n📅 Validity: **${days} Days**\n📦 Total: **${count} keys**\n\nAll keys are ready to use!`,
                parse_mode: 'Markdown'
            },
            { filename: fileName, contentType: 'text/plain' }
        );

        const preview = generatedKeys.slice(0, 10).map((k, i) => `${i + 1}. \`${k}\``).join('\n');
        await bot.sendMessage(
            chatId,
            `📋 **First 10 Keys Preview:**\n\n${preview}\n\n...and **${count - 10}** more in file!`,
            { parse_mode: 'Markdown' }
        );

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    } catch (e) {
        console.error('Bulk gen error:', e);
        await bot.sendMessage(chatId, `⚠️ Error generating bulk keys: ${e.message}`);
    }
});

// --- CHECK CREDITS ---
bot.onText(/\/mycredits/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    if (chatId === MAIN_OWNER_ID) {
        return bot.sendMessage(chatId, "👑 **Main Owner:** Unlimited credits!", { parse_mode: 'Markdown' });
    }

    try {
        const adminData = await AdminModel.findOne({ userId: chatId });
        const credits = adminData ? adminData.credits : 0;
        bot.sendMessage(chatId, `💰 **Your Credits:** \`${credits}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching credits.`);
    }
});

// --- ADD ADMIN ---
bot.onText(/\/addadmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const input = match[1] ? match[1].trim().split(" ") : [];
    const newAdminId = parseInt(input[0]);
    const credits = parseInt(input[1]) || 0;

    if (!newAdminId || isNaN(newAdminId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/addadmin 123456789 500`", { parse_mode: 'Markdown' });
    }

    try {
        await AdminModel.create({ userId: newAdminId, credits: credits });
        bot.sendMessage(chatId, `✅ Added \`${newAdminId}\` with **${credits}** credits!`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ User already admin or DB error.`);
    }
});

// --- ADD CREDITS ---
bot.onText(/\/addcredits(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const input = match[1] ? match[1].trim().split(" ") : [];
    const targetId = parseInt(input[0]);
    const addAmt = parseInt(input[1]);

    if (!targetId || isNaN(targetId) || isNaN(addAmt)) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/addcredits 123456789 100`", { parse_mode: 'Markdown' });
    }

    try {
        const adminData = await AdminModel.findOneAndUpdate(
            { userId: targetId },
            { $inc: { credits: addAmt } },
            { new: true }
        );
        if (adminData) {
            bot.sendMessage(chatId, `✅ Added ${addAmt} credits to \`${targetId}\`.\n💰 New: **${adminData.credits}**`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Admin not found.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error updating credits.`);
    }
});

// --- REMOVE ADMIN ---
bot.onText(/\/deladmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const targetId = parseInt(match[1]);
    if (!targetId || isNaN(targetId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/deladmin 123456789`", { parse_mode: 'Markdown' });
    }

    try {
        const deleted = await AdminModel.findOneAndDelete({ userId: targetId });
        if (deleted) {
            bot.sendMessage(chatId, `✅ Removed \`${targetId}\` from Admins.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Admin not found.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error removing admin.`);
    }
});

// --- ADMIN LIST ---
bot.onText(/\/adminlist/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const admins = await AdminModel.find({});
        let msgText = `👑 **Main Owner:** \`${MAIN_OWNER_ID}\`\n\n🛡️ **Admins:**\n`;

        if (admins.length === 0) {
            msgText += "No sub-admins.";
        } else {
            admins.forEach((adm, i) => {
                msgText += `${i + 1}. \`${adm.userId}\` | Credits: **${adm.credits}**\n`;
            });
        }
        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error fetching admin list.`);
    }
});

// --- SINGLE KEY GEN ---
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
        } else if (!isNaN(parts[0])) {
            days = parseInt(parts[0]) || 30;
        } else {
            customKey = parts[0].toUpperCase();
        }
    }

    const requiredCredits = days;

    if (chatId !== MAIN_OWNER_ID) {
        try {
            const adminData = await AdminModel.findOne({ userId: chatId });
            if (!adminData || adminData.credits < requiredCredits) {
                const currentCreds = adminData ? adminData.credits : 0;
                return bot.sendMessage(chatId, `❌ **Insufficient Credits!**\nNeed: **${requiredCredits}**\nHave: **${currentCreds}**`, { parse_mode: 'Markdown' });
            }
            adminData.credits -= requiredCredits;
            await adminData.save();
        } catch (e) {
            return bot.sendMessage(chatId, `⚠️ DB error.`);
        }
    }

    if (!customKey) {
        customKey = 'M1-' + Math.random().toString(36).substring(2, 6).toUpperCase() +
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase() +
                    '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    try {
        await KeyModel.create({ key: customKey, expiry: expiryTime, createdBy: chatId, hwid: null, isPaused: false });

        let successMsg = `✅ **Key Generated!**\n\n🔑 Key: \`${customKey}\`\n⏳ Validity: **${days} Days**\n💰 Deducted: **-${requiredCredits}**`;
        if (chatId !== MAIN_OWNER_ID) {
            const updatedAdmin = await AdminModel.findOne({ userId: chatId });
            successMsg += `\n💳 Remaining: **${updatedAdmin.credits}**`;
        }
        bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        if (chatId !== MAIN_OWNER_ID) {
            await AdminModel.findOneAndUpdate({ userId: chatId }, { $inc: { credits: requiredCredits } });
        }
        bot.sendMessage(chatId, `⚠️ Key already exists! (Credits refunded)`);
    }
});

// --- RESET HWID ---
bot.onText(/\/reset (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    const targetKey = match[1].trim().toUpperCase();
    try {
        const updated = await KeyModel.findOneAndUpdate({ key: targetKey }, { hwid: null }, { new: true });
        if (updated) {
            bot.sendMessage(chatId, `✅ HWID Reset!\nKey \`${targetKey}\` unlocked.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Key not found!`);
        }
    } catch (e) { bot.sendMessage(chatId, `⚠️ Error.`); }
});

// --- MY KEYS ---
bot.onText(/\/mykeys/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    try {
        const keys = await KeyModel.find({ createdBy: chatId }).sort({ expiry: -1 }).limit(20);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys yet.");

        let message = `📋 **YOUR KEYS (Last 20):**\n\n`;
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. \`${k.key}\` | ${status} ${lock}\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- PAUSE ALL KEYS ---
bot.onText(/\/pausekeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const currentTime = Date.now();
        const activeKeys = await KeyModel.find({ isPaused: false, expiry: { $gt: currentTime } });
        let count = 0;
        for (const k of activeKeys) {
            k.pausedRemainingTime = k.expiry - currentTime;
            k.isPaused = true;
            await k.save();
            count++;
        }
        bot.sendMessage(chatId, `⏸️ **${count} keys paused!** Timers frozen.`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- UNPAUSE ALL KEYS ---
bot.onText(/\/unpausekeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const pausedKeys = await KeyModel.find({ isPaused: true });
        const currentTime = Date.now();
        let count = 0;
        for (const k of pausedKeys) {
            k.expiry = currentTime + k.pausedRemainingTime;
            k.isPaused = false;
            k.pausedRemainingTime = 0;
            await k.save();
            count++;
        }
        bot.sendMessage(chatId, `▶️ **${count} keys resumed!** Timers running.`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- RESELLER STATS ---
bot.onText(/\/resellerstats/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const stats = await KeyModel.aggregate([
            { $group: { _id: "$createdBy", totalKeys: { $sum: 1 } } },
            { $sort: { totalKeys: -1 } }
        ]);

        let message = `📊 **RESELLER STATS:**\n\n`;
        stats.forEach((st, idx) => {
            const isOwner = (st._id === MAIN_OWNER_ID);
            const nameLabel = isOwner ? "Main Owner" : `Admin \`${st._id}\``;
            message += `${idx + 1}. ${nameLabel} — **${st.totalKeys} keys**\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- RESELLER KEYS ---
bot.onText(/\/resellerkeys(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const resellerId = parseInt(match[1]);
    if (!resellerId || isNaN(resellerId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/resellerkeys 123456789`", { parse_mode: 'Markdown' });
    }

    try {
        const keys = await KeyModel.find({ createdBy: resellerId }).sort({ expiry: -1 }).limit(25);
        if (keys.length === 0) return bot.sendMessage(chatId, `📂 No keys.`);

        let message = `📋 **Keys by \`${resellerId}\` (Last 25):**\n\n`;
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. \`${k.key}\` (${status} ${lock})\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- DELETE RESELLER KEYS ---
bot.onText(/\/resellerdelkeys(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const resellerId = parseInt(match[1]);
    if (!resellerId || isNaN(resellerId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/resellerdelkeys 123456789`", { parse_mode: 'Markdown' });
    }

    try {
        const result = await KeyModel.deleteMany({ createdBy: resellerId });
        bot.sendMessage(chatId, `✅ Deleted **${result.deletedCount}** keys of \`${resellerId}\`.`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- DELETE ALL KEYS ---
bot.onText(/\/delallkeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const result = await KeyModel.deleteMany({});
        bot.sendMessage(chatId, `🗑️ **Deleted ${result.deletedCount} keys!**`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- DELETE OLD KEYS ---
bot.onText(/\/deloldkeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const currentTime = Date.now();
        const result = await KeyModel.deleteMany({
            $or: [
                { expiry: { $lt: currentTime } },
                { hwid: null }
            ]
        });
        bot.sendMessage(chatId, `🧹 **Removed ${result.deletedCount} old/unused keys!**`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- ALL KEYS ---
bot.onText(/\/allkeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const keys = await KeyModel.find({}).sort({ expiry: -1 }).limit(25);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys.");

        let message = `📋 **ALL RECENT KEYS (Max 25):**\n\n`;
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. \`${k.key}\` (${status} ${lock}) [\`${k.createdBy}\`]\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- DELETE SPECIFIC KEY ---
bot.onText(/\/delkey (.+)/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const targetKey = match[1].trim().toUpperCase();
    try {
        const deleted = await KeyModel.findOneAndDelete({ key: targetKey });
        if (deleted) {
            bot.sendMessage(chatId, `✅ Deleted \`${targetKey}\`!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Key not found.`);
        }
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- SYSTEM STATS ---
bot.onText(/\/systemstats/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const totalKeys = await KeyModel.countDocuments();
        const pausedKeysCount = await KeyModel.countDocuments({ isPaused: true });
        const expiredKeys = await KeyModel.countDocuments({ expiry: { $lt: Date.now() }, isPaused: false });
        const activeKeys = totalKeys - expiredKeys - pausedKeysCount;
        const lockedKeys = await KeyModel.countDocuments({ hwid: { $ne: null } });
        const totalAdmins = await AdminModel.countDocuments();
        const maintenanceStatus = await isMaintenanceMode();

        let statsMsg = `📊 **SYSTEM STATS** 📊\n\n`;
        statsMsg += `🔧 Maintenance: **${maintenanceStatus ? '🔒 ON' : '🔓 OFF'}**\n`;
        statsMsg += `📦 Total Keys: **${totalKeys}**\n`;
        statsMsg += `🟢 Active: **${activeKeys}**\n`;
        statsMsg += `⏸️ Paused: **${pausedKeysCount}**\n`;
        statsMsg += `🔴 Expired: **${expiredKeys}**\n`;
        statsMsg += `🔒 Locked: **${lockedKeys}**\n`;
        statsMsg += `👥 Admins: **${totalAdmins}**\n`;

        bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- BROADCAST ---
bot.onText(/\/broadcast(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const broadcastMsg = match[1] ? match[1].trim() : "";
    if (!broadcastMsg) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/broadcast Your message`", { parse_mode: 'Markdown' });
    }

    try {
        const admins = await AdminModel.find({});
        let count = 0;
        for (const admin of admins) {
            try {
                await bot.sendMessage(admin.userId, `📢 **ANNOUNCEMENT:**\n\n${broadcastMsg}`, { parse_mode: 'Markdown' });
                count++;
            } catch (err) {}
        }
        bot.sendMessage(chatId, `✅ Sent to **${count}** admins!`, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, `⚠️ Error.`);
    }
});

// --- SAFETY HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
