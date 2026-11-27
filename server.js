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

const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

bot.on('polling_error', (err) => {
    console.error('Polling error:', err.code || err.message);
    if (err.code === 'ETELEGRAM' && String(err.message).includes('409')) {
        setTimeout(() => {
            bot.stopPolling()
                .then(() => bot.startPolling())
                .catch((e) => console.error('Restart polling failed:', e.message));
        }, 2000);
    }
});

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
    panel: { type: String, default: 'DEFAULT' }, // 'DEFAULT' = purana/free panel, 'PAID_V2' = naya paid panel
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
    status: { type: String, default: 'pending' },
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

function generateRandomM1Key() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = () => {
        let out = '';
        for (let i = 0; i < 4; i++) {
            out += chars[crypto.randomInt(0, chars.length)];
        }
        return out;
    };
    return `M1-${part()}-${part()}-${part()}`;
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
                panel: 'DEFAULT',
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

// --- 🔥 VERIFICATION API WITH PANEL & MAINTENANCE CHECK ---
app.post('/verify', async (req, res) => {
    const { key, hwid, panel } = req.body;
    const requestedPanel = (panel && typeof panel === 'string') ? panel.trim().toUpperCase() : 'DEFAULT';

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

        const keyPanel = (keyData.panel || 'DEFAULT').toUpperCase();
        if (keyPanel !== requestedPanel) {
            return res.json({
                success: false,
                message: `Wrong Panel Key!\nThis key belongs to [${keyPanel}] panel, not [${requestedPanel}].`
            });
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

    let helpText = "👑 M1 BISKUT KEY GENERATOR 👑\n\n";
    helpText += "• /newkey [days] - Generate PAID_V2 Key\n";
    helpText += "• /gen [days] - Generate DEFAULT Key\n";
    helpText += "• /gen [KEY] [days] - Custom DEFAULT Key\n";
    helpText += "• /mykeys - View your keys\n";
    helpText += "• /reset [KEY] - Reset HWID\n";
    helpText += "• /mycredits - Check credits\n";

    if (chatId === MAIN_OWNER_ID) {
        helpText += "\n🔧 OWNER MAINTENANCE MODE:\n";
        helpText += "• /maintenance on|off|status\n\n";
        helpText += "📦 BULK KEY GENERATION:\n";
        helpText += "• /bulk [count] [days] - Choose Paid or Free panel\n\n";
        helpText += "⚡ STATS & MGMT:\n";
        helpText += "• /resellerstats, /resellerkeys [ID], /allkeys, /systemstats\n";
        helpText += "• /pausekeys, /unpausekeys\n";
        helpText += "• /delkey [KEY], /resellerdelkeys [ID], /deloldkeys, /delallkeys\n";
        helpText += "• /addadmin [ID] [Credits], /addcredits [ID] [Credits], /deladmin [ID], /adminlist\n";
        helpText += "• /broadcast [Message]\n";
    }

    bot.sendMessage(chatId, helpText);
});

// --- 🔥 /newkey [days] -> PAID_V2 KEY GENERATOR ---
const pendingNewKey = new Map();
const pendingBulkKey = new Map();

bot.onText(/\/newkey(?: (.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const replyChatId = msg.chat.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(replyChatId, "❌ Unauthorized!");

    const parsedDays = parseInt(match && match[1]);
    const days = (!isNaN(parsedDays) && parsedDays > 0) ? parsedDays : 30;
    const reqId = `${userId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    pendingNewKey.set(reqId, { userId, replyChatId, days, panel: 'PAID_V2' });

    await bot.sendMessage(
        replyChatId,
        `💎 PAID_V2 Key (${days} Days)\n\nConfirm karke key generate karo:`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: `✅ Generate PAID_V2 (${days}d)`, callback_data: `paidv2:${reqId}` }
                    ]
                ]
            }
        }
    );
});

// --- 🔥 OWNER ONLY: BULK KEY GENERATION (ASK PAID VS FREE) ---
bot.onText(/\/bulk(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Yeh command sirf Main Owner use kar sakta hai!");

    const input = match[1] ? match[1].trim().split(/\s+/) : [];
    const count = parseInt(input[0]);
    const days = parseInt(input[1]) || 30;

    if (!count || isNaN(count) || count < 1 || count > 10000) {
        return bot.sendMessage(chatId, "⚠️ Usage: /bulk [count] [days]\nExample: /bulk 4000 30");
    }

    const reqId = `${chatId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    pendingBulkKey.set(reqId, { userId: chatId, replyChatId: msg.chat.id, count, days });

    await bot.sendMessage(
        msg.chat.id,
        `📦 Bulk Keys Setup\n\nCount: ${count} keys\nValidity: ${days} days\n\nKaunsi key banani hai?`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "💎 Paid Key (PAID_V2)", callback_data: `bulkpanel:PAID_V2:${reqId}` },
                        { text: "🆓 Free Key (DEFAULT)", callback_data: `bulkpanel:DEFAULT:${reqId}` }
                    ]
                ]
            }
        }
    );
});

async function runBulkGeneration(query, pending, selectedPanel) {
    const { userId, replyChatId, count, days } = pending;
    const labelType = selectedPanel === 'PAID_V2' ? 'Paid (PAID_V2)' : 'Free (DEFAULT)';

    const statusMsg = await bot.sendMessage(
        replyChatId,
        `⏳ Generating ${count} ${labelType} keys (${days} days)...`
    );

    try {
        const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
        const keysBatch = [];
        const generatedKeys = [];
        const usedSet = new Set();

        while (generatedKeys.length < count) {
            const newKey = generateRandomM1Key();
            if (!usedSet.has(newKey)) {
                usedSet.add(newKey);
                generatedKeys.push(newKey);
                keysBatch.push({
                    key: newKey,
                    panel: selectedPanel,
                    expiry: expiryTime,
                    createdBy: userId,
                    hwid: null,
                    isPaused: false,
                    pausedRemainingTime: 0
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
                    `⏳ Generating ${labelType} keys...\n\n✅ ${inserted}/${count} completed`,
                    { chat_id: replyChatId, message_id: statusMsg.message_id }
                ).catch(() => {});
            }
        }

        const keysText = generatedKeys.join('\n');
        const panelTag = selectedPanel === 'PAID_V2' ? 'paid_v2' : 'free_default';
        const fileName = `bulk_${panelTag}_${count}_${days}days.txt`;

        await bot.sendDocument(
            replyChatId,
            Buffer.from(keysText, 'utf-8'),
            {
                caption: `✅ ${count} ${labelType} Keys Generated!\nPanel: ${selectedPanel}\nValidity: ${days} Days`
            },
            { filename: fileName, contentType: 'text/plain' }
        );

        const preview = generatedKeys.slice(0, 10).map((k, i) => `${i + 1}. ${k}`).join('\n');
        await bot.sendMessage(replyChatId, `📋 First 10 Keys (${selectedPanel}):\n\n${preview}`);
        await bot.deleteMessage(replyChatId, statusMsg.message_id).catch(() => {});
        await bot.answerCallbackQuery(query.id, { text: `${count} ${selectedPanel} keys ready!` }).catch(() => {});
    } catch (e) {
        console.error('Bulk gen error:', e);
        await bot.sendMessage(replyChatId, `⚠️ Error generating bulk keys: ${e.message}`);
        await bot.answerCallbackQuery(query.id, { text: "Bulk generation error!" }).catch(() => {});
    }
}

bot.on('callback_query', async (query) => {
    try {
        const data = query.data || "";
        const clickerId = query.from.id;
        const replyChatId = query.message ? query.message.chat.id : clickerId;

        if (data.startsWith("bulkpanel:")) {
            const parts = data.split(":");
            const selectedPanel = parts[1] === 'PAID_V2' ? 'PAID_V2' : 'DEFAULT';
            const reqId = parts.slice(2).join(":");

            const pending = pendingBulkKey.get(reqId);
            if (!pending) {
                return bot.answerCallbackQuery(query.id, {
                    text: "Bulk request expire ho gaya, /bulk dobara bhejein."
                });
            }

            if (pending.userId !== clickerId && clickerId !== MAIN_OWNER_ID) {
                return bot.answerCallbackQuery(query.id, {
                    text: "Yeh button sirf Main Owner ke liye hai.",
                    show_alert: true
                });
            }

            pendingBulkKey.delete(reqId);
            await bot.answerCallbackQuery(query.id, { text: `${selectedPanel} bulk shuru...` });
            await runBulkGeneration(query, pending, selectedPanel);
            return;
        }

        if (!data.startsWith("paidv2:")) return;

        const reqId = data.slice("paidv2:".length);
        const pending = pendingNewKey.get(reqId);
        if (!pending) {
            return bot.answerCallbackQuery(query.id, {
                text: "Request expire ho gaya, /newkey dobara bhejein."
            });
        }

        if (pending.userId !== clickerId && clickerId !== MAIN_OWNER_ID) {
            return bot.answerCallbackQuery(query.id, {
                text: "Yeh button sirf request karne wale admin ke liye hai.",
                show_alert: true
            });
        }

        pendingNewKey.delete(reqId);
        const days = pending.days;
        const requiredCredits = days;

        if (clickerId !== MAIN_OWNER_ID) {
            const adminData = await AdminModel.findOne({ userId: clickerId });
            if (!adminData || adminData.credits < requiredCredits) {
                await bot.answerCallbackQuery(query.id, { text: "Insufficient credits!" });
                return bot.sendMessage(replyChatId, `❌ Need ${requiredCredits} credits.`);
            }
            adminData.credits -= requiredCredits;
            await adminData.save();
        }

        let newKey = "";
        let saved = false;
        const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);

        for (let attempt = 0; attempt < 5; attempt++) {
            newKey = generateRandomM1Key();
            try {
                await KeyModel.create({
                    key: newKey,
                    panel: 'PAID_V2',
                    expiry: expiryTime,
                    createdBy: clickerId,
                    hwid: null,
                    isPaused: false,
                    pausedRemainingTime: 0
                });
                saved = true;
                break;
            } catch (err) {
                if (err.code !== 11000) throw err;
            }
        }

        if (!saved) {
            if (clickerId !== MAIN_OWNER_ID) {
                await AdminModel.findOneAndUpdate({ userId: clickerId }, { $inc: { credits: requiredCredits } });
            }
            await bot.answerCallbackQuery(query.id, { text: "Key generate nahi ho payi!" });
            return bot.sendMessage(replyChatId, "⚠️ Unique key generate nahi ho payi, dobara try karo.");
        }

        await bot.answerCallbackQuery(query.id, { text: "PAID_V2 key generated!" });

        let outText = `✅ PAID_V2 Key Generated!\n\n`;
        outText += `Panel: PAID_V2\n`;
        outText += `Validity: ${days} Days\n\n`;
        outText += `Copy & Paste Key:\n${newKey}`;

        if (clickerId !== MAIN_OWNER_ID) {
            const updatedAdmin = await AdminModel.findOne({ userId: clickerId });
            outText += `\n\nCredits Left: ${updatedAdmin ? updatedAdmin.credits : 0}`;
        }

        await bot.sendMessage(replyChatId, outText);
    } catch (err) {
        console.error("Callback query error:", err);
        bot.answerCallbackQuery(query.id, { text: "Error aaya!" }).catch(() => {});
    }
});

// --- 🔥 /gen [days] -> DEFAULT PANEL KEY GENERATOR ---
bot.onText(/\/gen(?: (.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const replyChatId = msg.chat.id;
    if (!(await isAdmin(userId))) return bot.sendMessage(replyChatId, "❌ Unauthorized!");

    let inputArg = match[1] ? match[1].trim() : "";
    let customKey = "";
    let days = 30;

    if (inputArg) {
        const parts = inputArg.split(/\s+/);
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

    if (userId !== MAIN_OWNER_ID) {
        try {
            const adminData = await AdminModel.findOne({ userId: userId });
            if (!adminData || adminData.credits < requiredCredits) {
                const currentCreds = adminData ? adminData.credits : 0;
                return bot.sendMessage(replyChatId, `❌ Insufficient Credits!\nNeed: ${requiredCredits}\nHave: ${currentCreds}`);
            }
            adminData.credits -= requiredCredits;
            await adminData.save();
        } catch (e) {
            return bot.sendMessage(replyChatId, "⚠️ DB error.");
        }
    }

    if (!customKey) {
        customKey = generateRandomM1Key();
    }

    const expiryTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    try {
        await KeyModel.create({
            key: customKey,
            panel: 'DEFAULT',
            expiry: expiryTime,
            createdBy: userId,
            hwid: null,
            isPaused: false,
            pausedRemainingTime: 0
        });

        let successMsg = `✅ DEFAULT Key Generated!\n\n`;
        successMsg += `Panel: DEFAULT\n`;
        successMsg += `Validity: ${days} Days\n\n`;
        successMsg += `Copy & Paste Key:\n${customKey}`;

        if (userId !== MAIN_OWNER_ID) {
            const updatedAdmin = await AdminModel.findOne({ userId: userId });
            successMsg += `\n\nCredits Left: ${updatedAdmin ? updatedAdmin.credits : 0}`;
        }
        bot.sendMessage(replyChatId, successMsg);
    } catch (e) {
        if (userId !== MAIN_OWNER_ID) {
            await AdminModel.findOneAndUpdate({ userId: userId }, { $inc: { credits: requiredCredits } });
        }
        bot.sendMessage(replyChatId, "⚠️ Key already exists! (Credits refunded)");
    }
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
            bot.sendMessage(chatId, "🔒 MAINTENANCE MODE ON\n\nAb koi bhi user panel access nahi kar payega.");
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
            bot.sendMessage(chatId, "🔓 MAINTENANCE MODE OFF\n\nAb sab users normal access kar sakte hain.");
        } catch (e) {
            bot.sendMessage(chatId, `⚠️ Error disabling maintenance: ${e.message}`);
        }
    } else if (arg === 'status') {
        const isOn = await isMaintenanceMode();
        bot.sendMessage(chatId, `🔧 Maintenance Status: ${isOn ? '🔒 ON' : '🔓 OFF'}`);
    } else {
        bot.sendMessage(chatId, "⚠️ Usage:\n/maintenance on\n/maintenance off\n/maintenance status");
    }
});

// --- CHECK CREDITS ---
bot.onText(/\/mycredits/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    if (chatId === MAIN_OWNER_ID) {
        return bot.sendMessage(chatId, "👑 Main Owner: Unlimited credits!");
    }

    try {
        const adminData = await AdminModel.findOne({ userId: chatId });
        const credits = adminData ? adminData.credits : 0;
        bot.sendMessage(chatId, `💰 Your Credits: ${credits}`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error fetching credits.");
    }
});

// --- ADD ADMIN ---
bot.onText(/\/addadmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const input = match[1] ? match[1].trim().split(/\s+/) : [];
    const newAdminId = parseInt(input[0]);
    const credits = parseInt(input[1]) || 0;

    if (!newAdminId || isNaN(newAdminId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: /addadmin 123456789 500");
    }

    try {
        await AdminModel.create({ userId: newAdminId, credits: credits });
        bot.sendMessage(chatId, `✅ Added ${newAdminId} with ${credits} credits!`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ User already admin or DB error.");
    }
});

// --- ADD CREDITS ---
bot.onText(/\/addcredits(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const input = match[1] ? match[1].trim().split(/\s+/) : [];
    const targetId = parseInt(input[0]);
    const addAmt = parseInt(input[1]);

    if (!targetId || isNaN(targetId) || isNaN(addAmt)) {
        return bot.sendMessage(chatId, "⚠️ Usage: /addcredits 123456789 100");
    }

    try {
        const adminData = await AdminModel.findOneAndUpdate(
            { userId: targetId },
            { $inc: { credits: addAmt } },
            { new: true }
        );
        if (adminData) {
            bot.sendMessage(chatId, `✅ Added ${addAmt} credits to ${targetId}.\n💰 New: ${adminData.credits}`);
        } else {
            bot.sendMessage(chatId, "❌ Admin not found.");
        }
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error updating credits.");
    }
});

// --- REMOVE ADMIN ---
bot.onText(/\/deladmin(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const targetId = parseInt(match[1]);
    if (!targetId || isNaN(targetId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: /deladmin 123456789");
    }

    try {
        const deleted = await AdminModel.findOneAndDelete({ userId: targetId });
        if (deleted) {
            bot.sendMessage(chatId, `✅ Removed ${targetId} from Admins.`);
        } else {
            bot.sendMessage(chatId, "❌ Admin not found.");
        }
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error removing admin.");
    }
});

// --- ADMIN LIST ---
bot.onText(/\/adminlist/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const admins = await AdminModel.find({});
        let msgText = `👑 Main Owner: ${MAIN_OWNER_ID}\n\n🛡️ Admins:\n`;

        if (admins.length === 0) {
            msgText += "No sub-admins.";
        } else {
            admins.forEach((adm, i) => {
                msgText += `${i + 1}. ${adm.userId} | Credits: ${adm.credits}\n`;
            });
        }
        bot.sendMessage(chatId, msgText);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error fetching admin list.");
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
            bot.sendMessage(chatId, `✅ HWID Reset!\nKey ${targetKey} unlocked.`);
        } else {
            bot.sendMessage(chatId, "❌ Key not found!");
        }
    } catch (e) { bot.sendMessage(chatId, "⚠️ Error."); }
});

// --- MY KEYS ---
bot.onText(/\/mykeys/, async (msg) => {
    const chatId = msg.from.id;
    if (!(await isAdmin(chatId))) return bot.sendMessage(chatId, "❌ Unauthorized!");

    try {
        const keys = await KeyModel.find({ createdBy: chatId }).sort({ expiry: -1 }).limit(20);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys yet.");

        let message = "📋 YOUR KEYS (Last 20):\n\n";
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. ${k.key} [${k.panel || 'DEFAULT'}] | ${status} ${lock}\n`;
        });
        bot.sendMessage(chatId, message);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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
        bot.sendMessage(chatId, `⏸️ ${count} keys paused! Timers frozen.`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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
        bot.sendMessage(chatId, `▶️ ${count} keys resumed! Timers running.`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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

        let message = "📊 RESELLER STATS:\n\n";
        stats.forEach((st, idx) => {
            const isOwner = (st._id === MAIN_OWNER_ID);
            const nameLabel = isOwner ? "Main Owner" : `Admin ${st._id}`;
            message += `${idx + 1}. ${nameLabel} — ${st.totalKeys} keys\n`;
        });
        bot.sendMessage(chatId, message);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
    }
});

// --- RESELLER KEYS ---
bot.onText(/\/resellerkeys(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const resellerId = parseInt(match[1]);
    if (!resellerId || isNaN(resellerId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: /resellerkeys 123456789");
    }

    try {
        const keys = await KeyModel.find({ createdBy: resellerId }).sort({ expiry: -1 }).limit(25);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys.");

        let message = `📋 Keys by ${resellerId} (Last 25):\n\n`;
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. ${k.key} [${k.panel || 'DEFAULT'}] (${status} ${lock})\n`;
        });
        bot.sendMessage(chatId, message);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
    }
});

// --- DELETE RESELLER KEYS ---
bot.onText(/\/resellerdelkeys(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const resellerId = parseInt(match[1]);
    if (!resellerId || isNaN(resellerId)) {
        return bot.sendMessage(chatId, "⚠️ Usage: /resellerdelkeys 123456789");
    }

    try {
        const result = await KeyModel.deleteMany({ createdBy: resellerId });
        bot.sendMessage(chatId, `✅ Deleted ${result.deletedCount} keys of ${resellerId}.`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
    }
});

// --- DELETE ALL KEYS ---
bot.onText(/\/delallkeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const result = await KeyModel.deleteMany({});
        bot.sendMessage(chatId, `🗑️ Deleted ${result.deletedCount} keys!`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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
        bot.sendMessage(chatId, `🧹 Removed ${result.deletedCount} old/unused keys!`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
    }
});

// --- ALL KEYS ---
bot.onText(/\/allkeys/, async (msg) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    try {
        const keys = await KeyModel.find({}).sort({ expiry: -1 }).limit(25);
        if (keys.length === 0) return bot.sendMessage(chatId, "📂 No keys.");

        let message = "📋 ALL RECENT KEYS (Max 25):\n\n";
        keys.forEach((k, i) => {
            const status = k.isPaused ? "⏸️" : (Date.now() > k.expiry) ? "🔴" : "🟢";
            const lock = k.hwid ? "🔒" : "🔓";
            message += `${i + 1}. ${k.key} [${k.panel || 'DEFAULT'}] (${status} ${lock}) [${k.createdBy}]\n`;
        });
        bot.sendMessage(chatId, message);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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
            bot.sendMessage(chatId, `✅ Deleted ${targetKey}!`);
        } else {
            bot.sendMessage(chatId, "❌ Key not found.");
        }
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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

        let statsMsg = "📊 SYSTEM STATS 📊\n\n";
        statsMsg += `🔧 Maintenance: ${maintenanceStatus ? '🔒 ON' : '🔓 OFF'}\n`;
        statsMsg += `📦 Total Keys: ${totalKeys}\n`;
        statsMsg += `🟢 Active: ${activeKeys}\n`;
        statsMsg += `⏸️ Paused: ${pausedKeysCount}\n`;
        statsMsg += `🔴 Expired: ${expiredKeys}\n`;
        statsMsg += `🔒 Locked: ${lockedKeys}\n`;
        statsMsg += `👥 Admins: ${totalAdmins}\n`;

        bot.sendMessage(chatId, statsMsg);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
    }
});

// --- BROADCAST ---
bot.onText(/\/broadcast(?: (.+))?/, async (msg, match) => {
    const chatId = msg.from.id;
    if (chatId !== MAIN_OWNER_ID) return bot.sendMessage(chatId, "❌ Sirf Main Owner!");

    const broadcastMsg = match[1] ? match[1].trim() : "";
    if (!broadcastMsg) {
        return bot.sendMessage(chatId, "⚠️ Usage: /broadcast Your message");
    }

    try {
        const admins = await AdminModel.find({});
        let count = 0;
        for (const admin of admins) {
            try {
                await bot.sendMessage(admin.userId, `📢 ANNOUNCEMENT:\n\n${broadcastMsg}`);
                count++;
            } catch (err) {}
        }
        bot.sendMessage(chatId, `✅ Sent to ${count} admins!`);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Error.");
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
