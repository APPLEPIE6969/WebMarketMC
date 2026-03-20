/**
 * Aurelium Web Dashboard — Central Server
 * 
 * A single Express instance that handles market dashboards
 * for multiple Minecraft servers. Each MC server syncs its
 * data here via outbound HTTP — no ports needed on the MC side.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

const MAX_RAM_MB = 500;
const MAX_QUEUE_SIZE = 50;
const registrationQueue = [];

// ── Security Middleware ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for inline styles
app.use(cors({ origin: 'https://webaureliummc.onrender.com' }));
app.use(express.json({ limit: '5mb' }));

// Rate limit: 330 requests per minute per IP
app.use('/api/', rateLimit({
    windowMs: 60_000,
    max: 330, // Increased to 330 as requested
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
    // Skip rate limiting for MC servers that provide a valid API Key
    skip: (req) => req.headers['x-api-key'] !== undefined
}));

// ── In-Memory Data Stores ────────────────────────────────────────

/** @type {Map<string, ServerData>} serverId → full dashboard data */
const servers = new Map();

/** @type {Map<string, SessionData>} token → session data */
const sessions = new Map();

/** @type {Map<string, PurchaseData>} purchaseId → purchase data */
const purchases = new Map();

// ── Types (for documentation) ────────────────────────────────────
// ServerData:  { apiKey, serverName, lastSync, categories[], items{},
//               auctionsJson, ordersJson, stocksJson, priceHistoryJson }
//   → auctions/orders/stocks/priceHistory stored as raw JSON strings for RAM efficiency
// SessionData: { serverId, playerUuid, playerName, balances, defaultCurrency, expires }
// PurchaseData: { serverId, playerUuid, item, amount, status, createdAt }

// ── Middleware: API Key Auth ─────────────────────────────────────

function requireApiKey(req, res, next) {
    const serverId = req.params.serverId || req.body.serverId || req.query.serverId;
    const apiKey = req.headers['x-api-key'];

    if (!serverId || !apiKey) {
        return res.status(401).json({ error: 'Missing server ID or API key' });
    }

    const server = servers.get(serverId);
    if (!server || server.apiKey !== apiKey) {
        return res.status(403).json({ error: 'Invalid server ID or API key' });
    }

    req.serverId = serverId;
    req.server = server;
    next();
}

// ══════════════════════════════════════════════════════════════════
// PLUGIN → RENDER  (MC server pushes data here)
// ══════════════════════════════════════════════════════════════════

/** POST /api/register — MC plugin registers on startup */
app.post('/api/register', (req, res) => {
    const { serverId, apiKey, serverName } = req.body;

    if (!serverId || !apiKey) {
        return res.status(400).json({ error: 'Missing serverId or apiKey' });
    }

    // If server already exists, validate the key
    if (servers.has(serverId)) {
        const existing = servers.get(serverId);
        if (existing.apiKey !== apiKey) {
            return res.status(403).json({ error: 'API key mismatch for this server ID' });
        }
    } else {
        // Enforce Max RAM Activation Queue
        const memoryUsage = process.memoryUsage();
        const rssMB = memoryUsage.rss / 1024 / 1024;

        if (rssMB > MAX_RAM_MB) {
            if (registrationQueue.length >= MAX_QUEUE_SIZE) {
                return res.status(503).json({ error: 'Registration queue is full. Try again later.' });
            }
            if (!registrationQueue.includes(serverId)) {
                registrationQueue.push(serverId);
            }
            const position = registrationQueue.indexOf(serverId) + 1;
            console.log(`[Queue] Waitlisting "${serverName}" (${serverId}). RAM at ${Math.round(rssMB)}MB. Queue pos: ${position}`);
            return res.status(503).json({ error: 'Server waitlisted due to max RAM usage', queued: true, position });
        }

        // If memory is okay, but they are in the queue, only allow them if they are first (fairness)
        if (registrationQueue.includes(serverId)) {
            if (registrationQueue[0] !== serverId) {
                const position = registrationQueue.indexOf(serverId) + 1;
                return res.status(503).json({ error: 'Waiting in registration queue', queued: true, position });
            } else {
                registrationQueue.shift(); // Proceed to register
            }
        }
    }

    servers.set(serverId, {
        apiKey,
        serverName: serverName || 'Minecraft Server',
        lastSync: Date.now(),
        categories: [],
        items: {},
        auctionsJson: '[]',
        ordersJson: '[]',
        stocksJson: '[]',
        priceHistoryJson: '{}',
    });

    console.log(`[Register] Server "${serverName}" registered as ${serverId}`);
    res.json({ success: true });
});

/** POST /api/sync — MC plugin pushes market data + auctions + orders + stocks */
app.post('/api/sync', requireApiKey, (req, res) => {
    const { categories, items, auctions, orders, stocks, priceHistory } = req.body;
    const server = req.server;

    if (categories) server.categories = categories;
    if (items) server.items = items;

    // Store bulk data as raw JSON strings to minimize RAM footprint
    if (auctions) server.auctionsJson = JSON.stringify(auctions);
    if (orders) server.ordersJson = JSON.stringify(orders);
    if (stocks) server.stocksJson = JSON.stringify(stocks);
    if (priceHistory) server.priceHistoryJson = JSON.stringify(priceHistory);
    server.lastSync = Date.now();

    res.json({ success: true, pendingPurchases: getPendingPurchases(req.serverId) });
});

/** POST /api/session — MC plugin creates a player session */
app.post('/api/session', requireApiKey, (req, res) => {
    const { token, playerUuid, playerName, balances, defaultCurrency } = req.body;

    if (!token || !playerUuid) {
        return res.status(400).json({ error: 'Missing token or playerUuid' });
    }

    sessions.set(token, {
        serverId: req.serverId,
        playerUuid,
        playerName: playerName || 'Player',
        balances: balances || {},
        defaultCurrency: defaultCurrency || 'Aurels',
        expires: Date.now() + 3_600_000, // 1 hour hardcoded
    });

    res.json({ success: true });
});

/** POST /api/session-update — MC plugin updates a player's balance after purchase */
app.post('/api/session-update', requireApiKey, (req, res) => {
    const { playerUuid, balances } = req.body;

    // Update all sessions for this player on this server
    for (const [token, session] of sessions) {
        if (session.serverId === req.serverId && session.playerUuid === playerUuid) {
            session.balances = balances;
        }
    }

    res.json({ success: true });
});

/** POST /api/confirm-purchase — MC plugin confirms a purchase was executed */
app.post('/api/confirm-purchase', requireApiKey, (req, res) => {
    const { purchaseId, success, newBalance, spent } = req.body;

    const purchase = purchases.get(purchaseId);
    if (!purchase || purchase.serverId !== req.serverId) {
        return res.status(404).json({ error: 'Purchase not found' });
    }

    purchase.status = success ? 'completed' : 'failed';
    purchase.result = { newBalance, spent, success };

    res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// BROWSER → RENDER  (player dashboard requests)
// ══════════════════════════════════════════════════════════════════

/** Middleware: validate session token for browser requests */
function requireSession(req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const session = sessions.get(token);
    if (!session) return res.status(401).json({ error: 'Invalid or expired session. Use /web in-game.' });
    if (session.expires < Date.now()) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expired. Use /web in-game.' });
    }

    // Rolling 1-hour timeout: reset on every activity
    session.expires = Date.now() + 3_600_000;

    req.session = session;
    req.serverId = session.serverId;
    req.server = servers.get(session.serverId);

    if (!req.server) {
        return res.status(503).json({ error: 'Server is offline' });
    }

    next();
}

/** GET /api/:serverId/player — Browser gets player info */
app.get('/api/:serverId/player', requireSession, (req, res) => {
    const s = req.session;
    res.json({
        name: s.playerName,
        uuid: s.playerUuid,
        defaultCurrency: s.defaultCurrency,
        balances: s.balances,
    });
});

/** GET /api/:serverId/categories — Browser gets categories */
app.get('/api/:serverId/categories', requireSession, (req, res) => {
    res.json(req.server.categories || []);
});

/** GET /api/:serverId/items?category=X&page=0 — Browser gets items */
app.get('/api/:serverId/items', requireSession, (req, res) => {
    const catId = req.query.category || '';
    const page = parseInt(req.query.page) || 0;
    const perPage = 28;

    const allItems = req.server.items?.[catId] || [];
    const totalPages = Math.max(1, Math.ceil(allItems.length / perPage));
    const start = page * perPage;
    const pageItems = allItems.slice(start, start + perPage);

    res.json({ page, totalPages, totalItems: allItems.length, items: pageItems });
});

/** GET /api/:serverId/search?q=X&page=0 — Browser searches items */
app.get('/api/:serverId/search', requireSession, (req, res) => {
    const query = (req.query.q || '').toLowerCase();
    const page = parseInt(req.query.page) || 0;
    const perPage = 28;

    if (!query) return res.status(400).json({ error: 'Missing search query' });

    const results = [];
    const items = req.server.items || {};
    for (const catItems of Object.values(items)) {
        for (const item of catItems) {
            if (item.name.toLowerCase().includes(query)) {
                results.push(item);
            }
        }
    }

    const totalPages = Math.max(1, Math.ceil(results.length / perPage));
    const start = page * perPage;
    const pageItems = results.slice(start, start + perPage);

    res.json({ page, totalPages, totalItems: results.length, items: pageItems });
});

/** GET /api/:serverId/auctions — Browser gets active auctions (streamed from cache) */
app.get('/api/:serverId/auctions', requireSession, (req, res) => {
    res.type('json').send(req.server.auctionsJson || '[]');
});

/** GET /api/:serverId/orders — Browser gets active buy orders (streamed from cache) */
app.get('/api/:serverId/orders', requireSession, (req, res) => {
    res.type('json').send(req.server.ordersJson || '[]');
});

/** GET /api/:serverId/stocks — Browser gets stock/price data (streamed from cache) */
app.get('/api/:serverId/stocks', requireSession, (req, res) => {
    res.type('json').send(req.server.stocksJson || '[]');
});

/** GET /api/:serverId/price-history — Browser gets price history for charts (streamed from cache) */
app.get('/api/:serverId/price-history', requireSession, (req, res) => {
    res.type('json').send(req.server.priceHistoryJson || '{}');
});

/** POST /api/:serverId/buy — Browser submits a purchase */
app.post('/api/:serverId/buy', requireSession, (req, res) => {
    const { item, amount } = req.body;

    if (!item || !amount || amount < 1 || amount > 64) {
        return res.status(400).json({ error: 'Invalid item or amount' });
    }

    const purchaseId = crypto.randomUUID();

    purchases.set(purchaseId, {
        serverId: req.serverId,
        playerUuid: req.session.playerUuid,
        type: 'buy',
        item,
        amount: Math.min(64, Math.max(1, parseInt(amount))),
        status: 'pending',
        createdAt: Date.now(),
    });

    res.json({ success: true, purchaseId, message: 'Purchase queued — delivering in-game...' });
});

/** POST /api/:serverId/bid — Browser submits an auction bid */
app.post('/api/:serverId/bid', requireSession, (req, res) => {
    const { auctionId, amount } = req.body;

    if (!auctionId || amount == null || amount <= 0) {
        return res.status(400).json({ error: 'Invalid auction or amount' });
    }

    const purchaseId = crypto.randomUUID();

    purchases.set(purchaseId, {
        serverId: req.serverId,
        playerUuid: req.session.playerUuid,
        type: 'bid',
        auctionId: parseInt(auctionId),
        amount: parseFloat(amount),
        status: 'pending',
        createdAt: Date.now(),
    });

    res.json({ success: true, purchaseId, message: 'Bid queued — confirming in-game...' });
});

/** POST /api/:serverId/fill-order — Browser submits items to fulfill a buy order */
app.post('/api/:serverId/fill-order', requireSession, (req, res) => {
    const { orderId, amount } = req.body;

    if (!orderId || amount == null || amount <= 0) {
        return res.status(400).json({ error: 'Invalid order or amount' });
    }

    const purchaseId = crypto.randomUUID();

    purchases.set(purchaseId, {
        serverId: req.serverId,
        playerUuid: req.session.playerUuid,
        type: 'fill_order',
        orderId: parseInt(orderId),
        amount: parseInt(amount),
        status: 'pending',
        createdAt: Date.now(),
    });

    res.json({ success: true, purchaseId, message: 'Fulfillment queued — verifying in-game inventory...' });
});

/** GET /api/:serverId/purchase-status?id=X — Browser polls purchase result */
app.get('/api/:serverId/purchase-status', requireSession, (req, res) => {
    const id = req.query.id;
    const purchase = purchases.get(id);

    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    // IDOR protection: only the purchase owner can check status
    if (purchase.playerUuid !== req.session.playerUuid) {
        return res.status(403).json({ error: 'Not your purchase' });
    }

    res.json({
        status: purchase.status,
        result: purchase.result || null,
    });
});

// ══════════════════════════════════════════════════════════════════
// STATIC FILES + DASHBOARD PAGE
// ══════════════════════════════════════════════════════════════════

// Serve static frontend files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Landing page
app.get('/', (req, res) => {
    const gaId = process.env.GA_MEASUREMENT_ID || 'G-RCQKF2LJVQ';
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Aurelium Web Market</title>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${gaId}');
</script>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1a1a2e;color:#e0e0e0;font-family:Inter,sans-serif;}
.box{text-align:center;padding:40px;border-radius:16px;background:rgba(255,255,255,.05);backdrop-filter:blur(10px);}
h1{color:#f5c542;margin-bottom:8px;}p{color:#aaa;}
.link-btn{display:inline-block;margin-top:20px;padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;transition:background 0.2s;}
.link-btn:hover{background:#2563eb;}</style></head>
<body><div class="box"><h1>⚡ Aurelium Web Market</h1><p>Use <code>/web</code> in-game to get your dashboard link.</p><a href="https://modrinth.com/plugin/aurelium" target="_blank" class="link-btn">Download from Modrinth</a></div></body></html>`);
});

// Dashboard entry point — serves index.html with GA4 injection
let indexHtmlCache = null;
app.get('/shop/:serverId', (req, res) => {
    try {
        if (!indexHtmlCache) {
            indexHtmlCache = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        }
        const gaId = process.env.GA_MEASUREMENT_ID || 'G-RCQKF2LJVQ';
        const finalHtml = indexHtmlCache.replace(/G-XXXXXXXXXX/g, gaId);
        res.send(finalHtml);
    } catch (e) {
        console.error('Failed to serve index.html:', e);
        res.status(500).send('Server Error');
    }
});

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function getPendingPurchases(serverId) {
    const pending = [];
    for (const [id, p] of purchases) {
        if (p.serverId === serverId && p.status === 'pending') {
            pending.push({ id, ...p });
        }
    }
    return pending;
}

// Cleanup expired sessions and old purchases every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (session.expires < now) sessions.delete(token);
    }
    // Remove completed/failed purchases older than 5 minutes
    // Remove pending purchases older than 10 minutes (server went offline)
    for (const [id, p] of purchases) {
        if (p.status !== 'pending' && now - p.createdAt > 300_000) purchases.delete(id);
        else if (p.status === 'pending' && now - p.createdAt > 600_000) purchases.delete(id);
    }
    // Mark servers as stale if no sync in 5 minutes
    for (const [id, server] of servers) {
        if (now - server.lastSync > 300_000) {
            console.log(`[Status] Server "${server.serverName}" (${id}) is now stale (no sync >5m)`);
        }
    }
}, 60_000);

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Aurelium Web Dashboard running on port ${PORT}`);
});
