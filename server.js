const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Set these in your hosting environment. Never hardcode/share bot tokens.
const TOKEN = process.env.BOT_TOKEN;
const MAIN_OWNER_ID = Number(process.env.MAIN_OWNER_ID || 1834775993);
const MONGO_URI = process.env.MONGO_URI;
const PORT = Number(process.env.PORT || 3000);

if (!TOKEN) throw new Error('Missing BOT_TOKEN environment variable.');
if (!MONGO_URI) throw new Error('Missing MONGO_URI environment variable.');

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

mongoose.set('strictQuery', true);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 3650;

// --- MONGODB SCHEMAS & MODELS ---
const keySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, maxlength: 64 },
  expiry: { type: Number, required: true },
  status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
  createdBy: { type: Number, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const adminSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true, index: true },
  addedBy: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const auditSchema = new mongoose.Schema({
  actorId: { type: Number, required: true },
  action: { type: String, required: true },
  target: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const KeyModel = mongoose.model('Key', keySchema);
const AdminModel = mongoose.model('Admin', adminSchema);
const AuditModel = mongoose.model('AuditLog', auditSchema);

// --- HELPERS ---
function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidKey(value) {
  return /^[A-Z0-9_-]{4,64}$/.test(value);
}

function validDays(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : null;
}

function randomKey() {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `M1-${part()}-${part()}-${part()}`;
}

function escapeMarkdown(value) {
  return String(value).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function isAdmin(userId) {
  if (Number(userId) === MAIN_OWNER_ID) return true;
  try {
    return Boolean(await AdminModel.exists({ userId: Number(userId) }));
  } catch (err) {
    console.error('Admin check failed:', err.message);
    return false;
  }
}

function isOwner(userId) {
  return Number(userId) === MAIN_OWNER_ID;
}

async function audit(actorId, action, target = '') {
  try {
    await AuditModel.create({ actorId, action, target: String(target).slice(0, 100) });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

async function send(chatId, text, options = {}) {
  return bot.sendMessage(chatId, text, { disable_web_page_preview: true, ...options });
}

function keyDetails(doc) {
  const status = doc.status === 'revoked'
    ? 'REVOKED'
    : (Date.now() > doc.expiry ? 'EXPIRED' : 'ACTIVE');
  const expiry = new Date(doc.expiry).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return `🔑 Key: \`${escapeMarkdown(doc.key)}\`\n📌 Status: *${status}*\n⏳ Expiry: ${escapeMarkdown(expiry)}\n👤 Created by: \`${doc.createdBy}\``;
}

async function createKey(key, days, createdBy) {
  const doc = await KeyModel.create({
    key,
    expiry: Date.now() + days * DAY_MS,
    status: 'active',
    createdBy,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await audit(createdBy, 'key_created', key);
  return doc;
}

async function createRandomKey(days, createdBy) {
  for (let i = 0; i < 5; i++) {
    try {
      return await createKey(randomKey(), days, createdBy);
    } catch (err) {
      if (err.code === 11000) continue;
      throw err;
    }
  }
  throw new Error('Could not generate a unique key.');
}

async function getManageableKey(userId, rawKey) {
  const doc = await KeyModel.findOne({ key: normalizeKey(rawKey) });
  if (!doc) return { error: 'not_found' };
  if (!isOwner(userId) && doc.createdBy !== Number(userId)) return { error: 'forbidden' };
  return { doc };
}

async function showDashboard(chatId, userId) {
  if (!(await isAdmin(userId))) return send(chatId, '❌ You are not authorized.');
  const keyboard = [
    [
      { text: '🎲 Random Key (30d)', callback_data: 'random30' },
      { text: '✍️ Custom Key', callback_data: 'customhelp' }
    ],
    [
      { text: '📋 My Keys', callback_data: 'mykeys' },
      { text: '📊 Statistics', callback_data: 'stats' }
    ],
    [
      { text: '🔎 Search Key', callback_data: 'searchhelp' },
      { text: '📜 Audit Logs', callback_data: 'logs' }
    ]
  ];
  if (isOwner(userId)) {
    keyboard.push([{ text: '👥 Admin Management', callback_data: 'adminhelp' }]);
    keyboard.push([{ text: '🧾 All Keys', callback_data: 'allkeys' }]);
  }
  return send(chatId,
    '👑 *M1 CHEATS ADMIN PANEL*\n\nChoose an action or use /help for commands.',
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
  );
}

// --- TELEGRAM COMMANDS ---
bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
  await send(msg.chat.id,
    '👋 Welcome to *M1 CHEATS License Bot*.\nUse /admin to open the dashboard or /help for commands.',
    { parse_mode: 'Markdown' });
});

bot.onText(/^\/(?:admin|help)(?:@\w+)?$/, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  await showDashboard(msg.chat.id, msg.from.id);
  await send(msg.chat.id,
    '🧰 *Commands*\n' +
    '/gen [days] — random key, default 30 days\n' +
    '/customkey KEY DAYS — create a custom key\n' +
    '/search KEY — inspect a key you own\n' +
    '/revoke KEY — deactivate a key\n' +
    '/del KEY — permanently delete a key\n' +
    '/renew KEY DAYS — extend validity\n' +
    '/mykeys — list your keys\n' +
    '/stats — statistics\n' +
    (isOwner(msg.from.id) ? '\nOwner only:\n/addadmin USER_ID\n/removeadmin USER_ID\n/adminlist\n/logs' : ''),
    { parse_mode: 'Markdown' });
});

// Random key: /gen or /gen 7
bot.onText(/^\/gen(?:@\w+)?(?:\s+(\d+))?\s*$/, async (msg, match) => {
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return send(msg.chat.id, '❌ You are not authorized!');
  const days = validDays(match[1] || 30);
  if (!days) return send(msg.chat.id, `⚠️ Days must be between 1 and ${MAX_DAYS}.`);
  try {
    const doc = await createRandomKey(days, userId);
    return send(msg.chat.id, `✅ *Random key generated*\n\n${keyDetails(doc)}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Generate key error:', err);
    return send(msg.chat.id, '⚠️ Could not generate key. Check server logs.');
  }
});

// CUSTOM KEY: /customkey M1-AMIT-PREMIUM 30
bot.onText(/^\/customkey(?:@\w+)?\s+(\S+)\s+(\d+)\s*$/i, async (msg, match) => {
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return send(msg.chat.id, '❌ You are not authorized!');
  const key = normalizeKey(match[1]);
  const days = validDays(match[2]);

  if (!isValidKey(key)) {
    return send(msg.chat.id,
      '⚠️ Key must be 4–64 characters using A–Z, 0–9, hyphens or underscores.\nExample: `/customkey M1-AMIT-PREMIUM 30`',
      { parse_mode: 'Markdown' });
  }
  if (!days) return send(msg.chat.id, `⚠️ Validity must be 1–${MAX_DAYS} days.`);

  try {
    const doc = await createKey(key, days, userId);
    return send(msg.chat.id, `✅ *Custom key created*\n\n${keyDetails(doc)}`, { parse_mode: 'Markdown' });
  } catch (err) {
    if (err.code === 11000) return send(msg.chat.id, '⚠️ This key already exists. Choose another custom key.');
    console.error('Custom key error:', err);
    return send(msg.chat.id, '⚠️ Could not create custom key.');
  }
});

// Search key
bot.onText(/^\/search(?:@\w+)?\s+(\S+)\s*$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  try {
    const result = await getManageableKey(msg.from.id, match[1]);
    if (result.error === 'not_found') return send(msg.chat.id, '⚠️ Key not found.');
    if (result.error === 'forbidden') return send(msg.chat.id, '❌ You can only manage keys you created.');
    return send(msg.chat.id, keyDetails(result.doc), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Search failed.');
  }
});

// Delete key
bot.onText(/^\/del(?:@\w+)?\s+(\S+)\s*$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  try {
    const result = await getManageableKey(msg.from.id, match[1]);
    if (result.error === 'not_found') return send(msg.chat.id, '⚠️ Key not found.');
    if (result.error === 'forbidden') return send(msg.chat.id, '❌ You can only delete keys you created.');
    await KeyModel.deleteOne({ _id: result.doc._id });
    await audit(msg.from.id, 'key_deleted', result.doc.key);
    return send(msg.chat.id, `🗑️ Key \`${escapeMarkdown(result.doc.key)}\` deleted.`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Delete failed.');
  }
});

// Revoke key
bot.onText(/^\/revoke(?:@\w+)?\s+(\S+)\s*$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  try {
    const result = await getManageableKey(msg.from.id, match[1]);
    if (result.error === 'not_found') return send(msg.chat.id, '⚠️ Key not found.');
    if (result.error === 'forbidden') return send(msg.chat.id, '❌ You can only revoke keys you created.');
    result.doc.status = 'revoked';
    result.doc.updatedAt = new Date();
    await result.doc.save();
    await audit(msg.from.id, 'key_revoked', result.doc.key);
    return send(msg.chat.id, `🚫 Key \`${escapeMarkdown(result.doc.key)}\` revoked.`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Revoke failed.');
  }
});

// Renew key: /renew KEY 30
bot.onText(/^\/renew(?:@\w+)?\s+(\S+)\s+(\d+)\s*$/i, async (msg, match) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  const days = validDays(match[2]);
  if (!days) return send(msg.chat.id, `⚠️ Days must be between 1 and ${MAX_DAYS}.`);
  try {
    const result = await getManageableKey(msg.from.id, match[1]);
    if (result.error === 'not_found') return send(msg.chat.id, '⚠️ Key not found.');
    if (result.error === 'forbidden') return send(msg.chat.id, '❌ You can only renew keys you created.');
    if (result.doc.status === 'revoked') return send(msg.chat.id, '⚠️ Revoked keys cannot be renewed.');
    result.doc.expiry = Math.max(Date.now(), result.doc.expiry) + days * DAY_MS;
    result.doc.updatedAt = new Date();
    await result.doc.save();
    await audit(msg.from.id, 'key_renewed', result.doc.key);
    return send(msg.chat.id, `✅ *Key renewed*\n\n${keyDetails(result.doc)}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Renewal failed.');
  }
});

bot.onText(/^\/mykeys(?:@\w+)?\s*$/, async (msg) => {
  const userId = msg.from.id;
  if (!(await isAdmin(userId))) return send(msg.chat.id, '❌ You are not authorized!');
  try {
    const query = isOwner(userId) ? {} : { createdBy: userId };
    const docs = await KeyModel.find(query).sort({ createdAt: -1 }).limit(20).lean();
    if (!docs.length) return send(msg.chat.id, 'No keys found.');
    let text = '📋 *Keys (latest 20)*\n\n';
    docs.forEach((doc) => {
      const status = doc.status === 'revoked' ? 'REVOKED' : (Date.now() > doc.expiry ? 'EXPIRED' : 'ACTIVE');
      text += `• \`${escapeMarkdown(doc.key)}\` — ${status}\n`;
    });
    return send(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not load keys.');
  }
});

bot.onText(/^\/stats(?:@\w+)?\s*$/, async (msg) => {
  if (!(await isAdmin(msg.from.id))) return send(msg.chat.id, '❌ You are not authorized!');
  try {
    const owner = isOwner(msg.from.id);
    const query = owner ? {} : { createdBy: msg.from.id };
    const [total, active, revoked] = await Promise.all([
      KeyModel.countDocuments(query),
      KeyModel.countDocuments({ ...query, status: 'active', expiry: { $gt: Date.now() } }),
      KeyModel.countDocuments({ ...query, status: 'revoked' })
    ]);
    const expired = await KeyModel.countDocuments({ ...query, status: 'active', expiry: { $lte: Date.now() } });
    const adminCount = owner ? await AdminModel.countDocuments({}) : null;
    let text = `📊 *${owner ? 'Global' : 'Your'} Statistics*\n\n🔑 Total: *${total}*\n🟢 Active: *${active}*\n⌛ Expired: *${expired}*\n🚫 Revoked: *${revoked}*`;
    if (owner) text += `\n👥 Admins/resellers: *${adminCount + 1}*`;
    return send(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not fetch statistics.');
  }
});

// Owner-only admin commands
bot.onText(/^\/addadmin(?:@\w+)?\s+(\d+)\s*$/, async (msg, match) => {
  if (!isOwner(msg.from.id)) return send(msg.chat.id, '❌ Only Main Owner can add admins.');
  const target = Number(match[1]);
  if (!Number.isSafeInteger(target) || target <= 0 || target === MAIN_OWNER_ID) return send(msg.chat.id, '⚠️ Invalid user ID.');
  try {
    await AdminModel.create({ userId: target, addedBy: msg.from.id });
    await audit(msg.from.id, 'admin_added', target);
    return send(msg.chat.id, `✅ User \`${target}\` added as admin/reseller.`, { parse_mode: 'Markdown' });
  } catch (err) {
    if (err.code === 11000) return send(msg.chat.id, '⚠️ User is already an admin.');
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not add admin.');
  }
});

bot.onText(/^\/removeadmin(?:@\w+)?\s+(\d+)\s*$/, async (msg, match) => {
  if (!isOwner(msg.from.id)) return send(msg.chat.id, '❌ Only Main Owner can remove admins.');
  const target = Number(match[1]);
  if (target === MAIN_OWNER_ID) return send(msg.chat.id, '❌ Cannot remove Main Owner.');
  try {
    const deleted = await AdminModel.findOneAndDelete({ userId: target });
    if (!deleted) return send(msg.chat.id, '⚠️ Admin not found.');
    await audit(msg.from.id, 'admin_removed', target);
    return send(msg.chat.id, `🗑️ Admin \`${target}\` removed.`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not remove admin.');
  }
});

bot.onText(/^\/adminlist(?:@\w+)?\s*$/, async (msg) => {
  if (!isOwner(msg.from.id)) return send(msg.chat.id, '❌ Only Main Owner can view admin list.');
  try {
    const admins = await AdminModel.find({}).sort({ createdAt: 1 }).lean();
    let text = '👥 *Authorized Admins / Resellers*\n\n';
    text += `1. \`${MAIN_OWNER_ID}\` — Owner\n`;
    admins.forEach((admin, i) => { text += `${i + 2}. \`${admin.userId}\` — Admin\n`; });
    return send(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not fetch admin list.');
  }
});

bot.onText(/^\/logs(?:@\w+)?\s*$/, async (msg) => {
  if (!isOwner(msg.from.id)) return send(msg.chat.id, '❌ Only Main Owner can view audit logs.');
  try {
    const logs = await AuditModel.find({}).sort({ createdAt: -1 }).limit(10).lean();
    if (!logs.length) return send(msg.chat.id, 'No audit logs yet.');
    let text = '📜 *Latest 10 Audit Events*\n\n';
    logs.forEach((log) => {
      const time = new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      text += `• ${escapeMarkdown(time)} — \`${log.actorId}\` — ${escapeMarkdown(log.action)} ${escapeMarkdown(log.target)}\n`;
    });
    return send(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    return send(msg.chat.id, '⚠️ Could not load audit logs.');
  }
});

// --- INLINE BUTTON CALLBACKS ---
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message?.chat?.id || userId;
  const data = String(query.data || '');

  if (!(await isAdmin(userId))) {
    try { await bot.answerCallbackQuery(query.id, { text: 'Not authorized', show_alert: true }); } catch (_) {}
    return;
  }

  try {
    await bot.answerCallbackQuery(query.id);
    if (data === 'random30') {
      const doc = await createRandomKey(30, userId);
      return send(chatId, `✅ *Random key created*\n\n${keyDetails(doc)}\n\nFor custom key: /customkey YOUR-KEY 30`, { parse_mode: 'Markdown' });
    }
    if (data === 'customhelp') {
      return send(chatId, '✍️ Custom key format:\n`/customkey M1-AMIT-PREMIUM 30`', { parse_mode: 'Markdown' });
    }
    if (data === 'searchhelp') {
      return send(chatId, '🔎 Search format:\n`/search M1-AMIT-PREMIUM`', { parse_mode: 'Markdown' });
    }
    if (data === 'mykeys' || data === 'allkeys') {
      if (data === 'allkeys' && !isOwner(userId)) return send(chatId, '❌ Owner only.');
      const queryFilter = data === 'allkeys' ? {} : (isOwner(userId) ? {} : { createdBy: userId });
      const docs = await KeyModel.find(queryFilter).sort({ createdAt: -1 }).limit(20).lean();
      if (!docs.length) return send(chatId, 'No keys found.');
      let text = `📋 *${data === 'allkeys' ? 'All Keys' : 'My Keys'} (latest 20)*\n\n`;
      docs.forEach((doc) => {
        const status = doc.status === 'revoked' ? 'REVOKED' : (Date.now() > doc.expiry ? 'EXPIRED' : 'ACTIVE');
        text += `• \`${escapeMarkdown(doc.key)}\` — ${status}\n`;
      });
      return send(chatId, text, { parse_mode: 'Markdown' });
    }
    if (data === 'stats') {
      const owner = isOwner(userId);
      const filter = owner ? {} : { createdBy: userId };
      const [total, active, revoked] = await Promise.all([
        KeyModel.countDocuments(filter),
        KeyModel.countDocuments({ ...filter, status: 'active', expiry: { $gt: Date.now() } }),
        KeyModel.countDocuments({ ...filter, status: 'revoked' })
      ]);
      return send(chatId, `📊 *Statistics*\n\nTotal: *${total}*\nActive: *${active}*\nRevoked: *${revoked}*`, { parse_mode: 'Markdown' });
    }
    if (data === 'logs') {
      if (!isOwner(userId)) return send(chatId, '❌ Owner only.');
      const logs = await AuditModel.find({}).sort({ createdAt: -1 }).limit(10).lean();
      if (!logs.length) return send(chatId, 'No logs yet.');
      let text = '📜 *Latest Audit Events*\n\n';
      logs.forEach((l) => { text += `• \`${l.actorId}\` — ${escapeMarkdown(l.action)} ${escapeMarkdown(l.target)}\n`; });
      return send(chatId, text, { parse_mode: 'Markdown' });
    }
    if (data === 'adminhelp') {
      if (!isOwner(userId)) return send(chatId, '❌ Owner only.');
      return send(chatId, '👥 Admin management:\n/addadmin USER_ID\n/removeadmin USER_ID\n/adminlist');
    }
  } catch (err) {
    console.error('Callback error:', err);
    return send(chatId, '⚠️ Action failed. Please try again.');
  }
});

// --- ANDROID APP VERIFICATION API ---
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again later.' }
});

app.get('/healthz', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ ok: connected });
});

app.post('/verify', verifyLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable.' });
  }
  const key = normalizeKey(req.body?.key);
  if (!key || !isValidKey(key)) {
    return res.status(400).json({ success: false, message: 'A valid key is required.' });
  }
  try {
    const doc = await KeyModel.findOne({ key }).select('expiry status').lean();
    if (!doc) return res.status(200).json({ success: false, message: 'Invalid license key!' });
    if (doc.status !== 'active') return res.status(200).json({ success: false, message: 'License key has been revoked!' });
    if (Date.now() > doc.expiry) return res.status(200).json({ success: false, message: 'License key has expired!' });
    return res.status(200).json({ success: true, message: 'OK' });
  } catch (err) {
    console.error('Verification API error:', err.message);
    return res.status(503).json({ success: false, message: 'Server database error!' });
  }
});

let httpServer;

async function start() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB Atlas.');
  httpServer = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  try { await bot.stopPolling(); } catch (_) {}
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
