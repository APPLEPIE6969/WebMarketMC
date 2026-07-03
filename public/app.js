// ═══════════════════════════════════════════════════════════════════
// WebMarketMC — Client-side Dashboard Logic
// ═══════════════════════════════════════════════════════════════════

const API_BASE = '/api';
const SERVER_ID = new URLSearchParams(window.location.search).get('serverId') || '';
let AUTH_HEADERS = () => ({ 'Authorization': `Bearer ${localStorage.getItem('wm_token')}` });

// ── Texture Override System ──────────────────────────────────────
// Maps material names to specific texture paths (some are block/ prefixed)
const TEXTURE_OVERRIDES = {
    'shulker_box': 'block/shulker_box',
    'piston': 'block/piston_side',
    'observer': 'block/observer_front',
    'redstone_lamp': 'block/redstone_lamp',
    'sea_lantern': 'block/sea_lantern',
    'glowstone': 'block/glowstone',
    'beacon': 'block/beacon',
    'end_rod': 'block/end_rod',
    'chorus_plant': 'block/chorus_plant',
    'chorus_flower': 'block/chorus_flower',
    'purpur_block': 'block/purpur_block',
    'end_stone_bricks': 'block/end_stone_bricks',
    'dragon_egg': 'block/dragon_egg',
    'command_block': 'block/command_block',
    'structure_block': 'block/structure_block',
    'barrier': 'block/barrier',
    'light': 'block/light',
    'jigsaw': 'block/jigsaw',
    'sculk': 'block/sculk',
    'sculk_vein': 'block/sculk_vein',
    'sculk_catalyst': 'block/sculk_catalyst',
    'sculk_sensor': 'block/sculk_sensor',
    'sculk_shrieker': 'block/sculk_shrieker',
    'reinforced_deepslate': 'block/reinforced_deepslate',
    'trial_spawner': 'block/trial_spawner',
    'vault': 'block/vault',
    'heavy_core': 'block/heavy_core',
    'ominous_bottle': 'item/ominous_bottle',
    'trial_key': 'item/trial_key',
    'wind_charge': 'item/wind_charge',
    'breeze_rod': 'item/breeze_rod',
    'mace': 'item/mace',
};

// Resolve texture name, handling block/ prefix in overrides
function resolveTextureName(material) {
    const key = (material || '').toLowerCase();
    return TEXTURE_OVERRIDES[key] || key;
}

// Handle item icon errors with fallback chain
function handleItemIconError(img, material, hideOnFail = false) {
    let attempt = parseInt(img.dataset.fallback || '0');
    const resolved = resolveTextureName(material);
    // Extract base name without namespace prefix (block/ or item/)
    const baseName = resolved.startsWith('block/') ? resolved.slice(6) :
                     resolved.startsWith('item/') ? resolved.slice(5) : resolved;

    if (attempt < 1) {
        img.src = `https://assets.mcasset.cloud/26.2/assets/minecraft/textures/block/${baseName}.png`;
        img.dataset.fallback = attempt + 1;
    } else if (attempt < 2) {
        img.src = `https://assets.mcasset.cloud/26.1/assets/minecraft/textures/item/${baseName}.png`;
        img.dataset.fallback = attempt + 1;
    } else if (attempt < 3) {
        img.src = `https://assets.mcasset.cloud/26.1/assets/minecraft/textures/block/${baseName}.png`;
        img.dataset.fallback = attempt + 1;
    } else if (attempt < 4) {
        img.src = `https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/item/${baseName}.png`;
        img.dataset.fallback = attempt + 1;
    } else if (attempt < 5) {
        img.src = `https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/block/${baseName}.png`;
        img.dataset.fallback = attempt + 1;
    } else {
        // Final fallback: box icon
        img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiMzMzMiLz48cGF0aCBkPSJNNCA0aDh2OGg4VjRoLTh6IiBmaWxsPSIjNjY2Ii8+PC9zdmc+';
        img.dataset.fallback = 'done';
    }
}

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let currentPage = 'market';
let currentCategory = '';
let currentAuctionCategory = 'all';
let currentPageNum = 0;
let stocksRenderCount = 50;
let currentStocksSort = 'name';
let currentBuyContext = null;
let currentOrderContext = null;

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize custom selects FIRST
    initCustomSelects();

    // Check for serverId in URL
    if (!SERVER_ID) {
        document.body.innerHTML = '<div style="padding:2rem;text-align:center;color:#9a9aad;">Missing serverId parameter</div>';
        return;
    }

    // Load player info
    try {
        const player = await api(`/${SERVER_ID}/player`);
        if (!player) return;
        document.getElementById('player-name').textContent = player.name;
        document.getElementById('player-balance').textContent = formatBalance(player.balances, player.defaultCurrency);
        document.getElementById('player-currency').textContent = player.defaultCurrency;
    } catch (e) {
        console.error('Failed to load player:', e);
        showError('Failed to load player data');
        return;
    }

    // Load categories
    await loadCategories();

    // Initial page load
    showPage('market');
});

// ═══════════════════════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    const btnEl = document.getElementById(`nav-${page}`);
    if (pageEl) pageEl.classList.add('active');
    if (btnEl) btnEl.classList.add('active');

    if (page === 'market') {
        loadCategories();
        loadItems(currentCategory || '', 0);
    } else if (page === 'auctions') {
        loadAuctions();
    } else if (page === 'orders') {
        loadOrders();
    } else if (page === 'stocks') {
        loadStocksPage();
    }
}

// ═══════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════

async function loadCategories() {
    try {
        const cats = await api(`/${SERVER_ID}/categories`);
        if (!cats) return;

        // Market sidebar
        const marketSidebar = document.getElementById('market-categories');
        marketSidebar.innerHTML = cats.map(c => `
            <button class="category-btn${c.id === currentCategory ? ' active' : ''}" 
                    onclick="selectCategory('${escJs(c.id)}')">
                <span class="category-icon">${getIconSVG(c.icon)}</span>
                <span class="category-name">${esc(c.name)}</span>
                <span class="category-count">${c.itemCount || 0}</span>
            </button>
        `).join('');

        // Auction sidebar (with special filter categories)
        const auctionSidebar = document.getElementById('auction-categories');
        const filterCats = [
            { id: 'all', name: 'All Listings', icon: 'list', count: null },
            { id: 'bin', name: 'BIN Listings', icon: 'tag', count: null },
            { id: 'bid', name: 'BID Listings', icon: 'gavel', count: null },
        ];
        auctionSidebar.innerHTML = [
            ...filterCats.map(c => `
                <button class="category-btn${c.id === currentAuctionCategory ? ' active' : ''}" 
                        onclick="selectAuctionCategory('${escJs(c.id)}')">
                    <span class="category-icon">${getIconSVG(c.icon)}</span>
                    <span class="category-name">${esc(c.name)}</span>
                </button>
            `),
            ...cats.map(c => `
                <button class="category-btn${c.id === currentAuctionCategory ? ' active' : ''}" 
                        onclick="selectAuctionCategory('${escJs(c.id)}')">
                    <span class="category-icon">${getIconSVG(c.icon)}</span>
                    <span class="category-name">${esc(c.name)}</span>
                    <span class="category-count">${c.itemCount || 0}</span>
                </button>
            `)
        ].join('');
    } catch (e) {
        console.error('Failed to load categories:', e);
    }
}

function selectCategory(catId) {
    currentCategory = catId;
    currentPageNum = 0;
    document.querySelectorAll('#market-categories .category-btn').forEach(btn => {
        btn.classList.toggle('active', btn.onclick.toString().includes(catId));
    });
    loadItems(catId, 0);
}

function selectAuctionCategory(catId) {
    currentAuctionCategory = catId;
    document.querySelectorAll('#auction-categories .category-btn').forEach(btn => {
        btn.classList.toggle('active', btn.onclick.toString().includes(catId));
    });
    loadAuctions();
}

// ═══════════════════════════════════════════════════════════════════
// MARKET ITEMS
// ═══════════════════════════════════════════════════════════════════

async function loadItems(catId, page) {
    try {
        const data = await api(`/${SERVER_ID}/items?category=${encodeURIComponent(catId)}&page=${page}`);
        if (!data) return;

        currentPageNum = page;
        renderItems(data.items);
        renderPagination(data.page, data.totalPages, catId);
    } catch (e) {
        console.error('Failed to load items:', e);
    }
}

function renderItems(items) {
    const grid = document.getElementById('items-grid');
    if (!items.length) {
        grid.innerHTML = '<div class="empty-state">No items in this category</div>';
        return;
    }
    grid.innerHTML = items.map(item => `
        <div class="item-card" onclick="openBuyModal(${escJs(JSON.stringify(item))})">
            <img class="item-icon" 
                 src="https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(item.material || item.key)}.png" 
                 onerror="handleItemIconError(this, '${escJs(item.material || item.key)}')"
                 alt="${esc(item.name)}">
            <div class="item-info">
                <div class="item-name">${esc(item.name)}</div>
                <div class="item-price">${esc(item.priceFormatted)}</div>
            </div>
        </div>
    `).join('');
}

function renderPagination(page, totalPages, catId) {
    const container = document.getElementById('pagination');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    if (page > 0) html += `<button onclick="loadItems('${escJs(catId)}', ${page - 1})">‹ Prev</button>`;
    html += `<span class="page-info">Page ${page + 1} / ${totalPages}</span>`;
    if (page < totalPages - 1) html += `<button onclick="loadItems('${escJs(catId)}', ${page + 1})">Next ›</button>`;
    container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════

let searchDebounce = null;
function handleSearch(input) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) {
            loadItems(currentCategory, 0);
            return;
        }
        try {
            const data = await api(`/${SERVER_ID}/search?q=${encodeURIComponent(q)}&page=0`);
            if (!data) return;
            renderItems(data.items);
            renderPagination(data.page, data.totalPages, '');
        } catch (e) {
            console.error('Search failed:', e);
        }
    }, 200);
}

// ═══════════════════════════════════════════════════════════════════
// AUCTIONS
// ═══════════════════════════════════════════════════════════════════

async function loadAuctions() {
    try {
        const auctions = await api(`/${SERVER_ID}/auctions`);
        if (!auctions) return;
        renderAuctions(auctions);
    } catch (e) {
        console.error('Failed to load auctions:', e);
    }
}

function renderAuctions(auctions) {
    const grid = document.getElementById('auctions-grid');
    let filtered = auctions;

    if (currentAuctionCategory === 'bin') {
        filtered = auctions.filter(a => a.binPrice != null);
    } else if (currentAuctionCategory === 'bid') {
        filtered = auctions.filter(a => a.binPrice == null);
    } else if (currentAuctionCategory !== 'all') {
        filtered = auctions.filter(a => a.category === currentAuctionCategory);
    }

    if (!filtered.length) {
        grid.innerHTML = '<div class="empty-state">No auctions match this filter</div>';
        return;
    }

    grid.innerHTML = filtered.map(a => `
        <div class="auction-card">
            <img class="item-icon" 
                 src="https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(a.material || a.itemKey)}.png" 
                 onerror="handleItemIconError(this, '${escJs(a.material || a.itemKey)}')"
                 alt="${esc(a.itemName)}">
            <div class="auction-info">
                <div class="auction-name">${esc(a.itemName)}</div>
                <div class="auction-meta">
                    ${a.binPrice ? `<span class="bin-badge">BIN: ${esc(formatPrice(a.binPrice, a.currency))}</span>` : ''}
                    ${a.currentBid ? `<span class="bid-badge">Current: ${esc(formatPrice(a.currentBid, a.currency))}</span>` : ''}
                    <span class="time-left">${esc(formatTimeLeft(a.endsAt))}</span>
                </div>
            </div>
            <button class="btn-bid" onclick="openBidModal(${escJs(JSON.stringify(a))})">
                ${a.binPrice ? 'Buy Now' : 'Place Bid'}
            </button>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// ORDERS (Buy Orders)
// ═══════════════════════════════════════════════════════════════════

async function loadOrders() {
    try {
        const orders = await api(`/${SERVER_ID}/orders`);
        if (!orders) return;
        renderOrders(orders);
    } catch (e) {
        console.error('Failed to load orders:', e);
    }
}

function renderOrders(orders) {
    const container = document.getElementById('orders-table');
    if (!orders.length) {
        container.innerHTML = '<div class="empty-state">No active buy orders</div>';
        return;
    }
    container.innerHTML = `
        <table class="orders-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Filled</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map(o => `
                    <tr>
                        <td>
                            <img class="item-icon-sm" 
                                 src="https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(o.material || o.itemKey)}.png" 
                                 onerror="handleItemIconError(this, '${escJs(o.material || o.itemKey)}')"
                                 alt="${esc(o.itemName)}">
                            ${esc(o.itemName)}
                        </td>
                        <td>${esc(formatPrice(o.price, o.currency))}</td>
                        <td>${o.amount}</td>
                        <td>${o.filled || 0} / ${o.amount}</td>
                        <td>
                            <button class="btn-fill" onclick="openOrderFillModal(${escJs(JSON.stringify(o))})">
                                Fill
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ═══════════════════════════════════════════════════════════════════
// STOCKS / PRICE HISTORY
// ═══════════════════════════════════════════════════════════════════

async function loadStocksPage() {
    try {
        const [stocks, history] = await Promise.all([
            api(`/${SERVER_ID}/stocks`),
            api(`/${SERVER_ID}/price-history`)
        ]);
        if (!stocks) return;
        renderStocks(stocks, history);
    } catch (e) {
        console.error('Failed to load stocks:', e);
    }
}

function getSortedStocks() {
    const stocks = window._cachedStocks || [];
    return [...stocks].sort((a, b) => {
        if (currentStocksSort === 'name') return a.name.localeCompare(b.name);
        if (currentStocksSort === 'price') return (b.price || 0) - (a.price || 0);
        if (currentStocksSort === 'volume') return (b.volume || 0) - (a.volume || 0);
        if (currentStocksSort === 'change') return (b.change24h || 0) - (a.change24h || 0);
        return 0;
    });
}

function renderStocks(stocks, history) {
    window._cachedStocks = stocks;
    window._cachedHistory = history;
    stocksRenderCount = 50;

    const sorted = getSortedStocks();
    renderStocksBody(sorted);
    renderStockChart(null, history);
}

function renderStocksBody(stocks) {
    const tbody = document.getElementById('stocks-body');
    const display = stocks.slice(0, stocksRenderCount);
    tbody.innerHTML = display.map(s => `
        <tr>
            <td>
                <img class="item-icon-sm" 
                     src="https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(s.material || s.itemKey)}.png" 
                     onerror="handleItemIconError(this, '${escJs(s.material || s.itemKey)}')"
                     alt="${esc(s.name)}">
                ${esc(s.name)}
            </td>
            <td>${esc(formatPrice(s.price, s.currency))}</td>
            <td>${s.volume?.toLocaleString() || '0'}</td>
            <td class="${(s.change24h || 0) >= 0 ? 'positive' : 'negative'}">
                ${(s.change24h || 0) >= 0 ? '+' : ''}${(s.change24h || 0).toFixed(2)}%
            </td>
            <td>
                <button class="btn-chart" onclick="openStockChart(${escJs(JSON.stringify(s))}, ${escJs(JSON.stringify(window._cachedHistory || {}))})">
                    Chart
                </button>
            </td>
        </tr>
    `).join('');
}

function renderStockChart(item, history) {
    const canvas = document.getElementById('stock-chart');
    const ctx = canvas.getContext('2d');
    // Simple chart rendering - placeholder
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e1f25';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (item && history?.[item.itemKey]) {
        // Draw price history
        const data = history[item.itemKey];
        ctx.strokeStyle = '#1bd96a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = (i / (data.length - 1)) * canvas.width;
            const y = canvas.height - (d.price / Math.max(...data.map(x => x.price))) * canvas.height * 0.8;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

// ═══════════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════════

function openBuyModal(item) {
    currentBuyContext = { item, maxQty: 64 };
    document.getElementById('buy-item-name').textContent = item.name;
    document.getElementById('buy-item-icon').src = `https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(item.material || item.key)}.png`;
    document.getElementById('buy-item-icon').onerror = () => handleItemIconError(document.getElementById('buy-item-icon'), item.material || item.key);
    document.getElementById('amount-input').value = 1;
    document.getElementById('amount-input').max = 64;
    updateModalTotal();
    updateQtyButtonStates('amount-input', 'amount-minus', 'amount-plus', 64);
    document.getElementById('buy-modal').style.display = 'flex';
}

function openBidModal(auction) {
    currentBuyContext = { auction, maxQty: 1 };
    document.getElementById('bid-item-name').textContent = auction.itemName;
    document.getElementById('bid-item-icon').src = `https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(auction.material || auction.itemKey)}.png`;
    document.getElementById('bid-item-icon').onerror = () => handleItemIconError(document.getElementById('bid-item-icon'), auction.material || auction.itemKey);
    document.getElementById('bid-amount-input').value = auction.currentBid ? auction.currentBid + 1 : (auction.binPrice || 1);
    document.getElementById('bid-modal').style.display = 'flex';
}

function openOrderFillModal(order) {
    currentOrderContext = { order, maxAmount: order.amount - (order.filled || 0) };
    document.getElementById('fill-item-name').textContent = order.itemName;
    document.getElementById('fill-item-icon').src = `https://assets.mcasset.cloud/26.2/assets/minecraft/textures/item/${resolveTextureName(order.material || order.itemKey)}.png`;
    document.getElementById('fill-item-icon').onerror = () => handleItemIconError(document.getElementById('fill-item-icon'), order.material || order.itemKey);
    document.getElementById('order-fill-amount-input').value = currentOrderContext.maxAmount;
    document.getElementById('order-fill-amount-input').max = currentOrderContext.maxAmount;
    updateOrderFillTotal();
    updateQtyButtonStates('order-fill-amount-input', 'order-fill-amount-minus', 'order-fill-amount-plus', currentOrderContext.maxAmount);
    document.getElementById('order-fill-modal').style.display = 'flex';
}

function openStockChart(item, history) {
    renderStockChart(item, history);
    document.getElementById('chart-title').textContent = item.name;
    document.getElementById('chart-modal').style.display = 'flex';
}

function closeModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => {
        overlay.style.display = 'none';
        overlay.classList.remove('closing');
    }, { once: true });
}

function updateModalTotal() {
    if (!currentBuyContext) return;
    const qty = parseInt(document.getElementById('amount-input')?.value) || 1;
    const price = currentBuyContext.item?.price || 0;
    const total = qty * price;
    document.getElementById('buy-total').textContent = formatPrice(total, currentBuyContext.item?.currency || '');
}

function updateOrderFillTotal() {
    if (!currentOrderContext) return;
    const qty = parseInt(document.getElementById('order-fill-amount-input')?.value) || 1;
    const price = currentOrderContext.order?.price || 0;
    const total = qty * price;
    document.getElementById('fill-total').textContent = formatPrice(total, currentOrderContext.order?.currency || '');
}

async function confirmBuy() {
    if (!currentBuyContext) return;
    const qty = parseInt(document.getElementById('amount-input')?.value) || 1;
    try {
        const res = await api(`/${SERVER_ID}/buy`, 'POST', { item: currentBuyContext.item.key, amount: qty });
        if (res?.success) {
            showToast('success', 'Purchase queued!');
            closeModal('buy-modal');
            pollPurchaseStatus(res.purchaseId);
        } else {
            showToast('error', res?.message || 'Purchase failed');
        }
    } catch (e) {
        showToast('error', 'Purchase failed');
    }
}

async function confirmBid() {
    if (!currentBuyContext?.auction) return;
    const amount = parseFloat(document.getElementById('bid-amount-input')?.value);
    try {
        const res = await api(`/${SERVER_ID}/bid`, 'POST', { auctionId: currentBuyContext.auction.id, amount });
        if (res?.success) {
            showToast('success', 'Bid placed!');
            closeModal('bid-modal');
            pollPurchaseStatus(res.purchaseId);
        } else {
            showToast('error', res?.message || 'Bid failed');
        }
    } catch (e) {
        showToast('error', 'Bid failed');
    }
}

async function confirmOrderFill() {
    if (!currentOrderContext) return;
    const qty = parseInt(document.getElementById('order-fill-amount-input')?.value) || 1;
    try {
        const res = await api(`/${SERVER_ID}/fill-order`, 'POST', { orderId: currentOrderContext.order.id, amount: qty });
        if (res?.success) {
            showToast('success', 'Fill queued!');
            closeModal('order-fill-modal');
            pollPurchaseStatus(res.purchaseId);
        } else {
            showToast('error', res?.message || 'Fill failed');
        }
    } catch (e) {
        showToast('error', 'Fill failed');
    }
}

async function pollPurchaseStatus(purchaseId) {
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const status = await api(`/${SERVER_ID}/purchase-status?id=${purchaseId}`);
            if (status?.status === 'completed') {
                showToast('success', 'Completed!');
                loadPlayerBalance();
                return;
            }
            if (status?.status === 'failed') {
                showToast('error', status.result?.message || 'Failed');
                return;
            }
        } catch (e) {
            console.error('Poll error:', e);
        }
    }
    showToast('error', 'Timeout waiting for result');
}

async function loadPlayerBalance() {
    try {
        const player = await api(`/${SERVER_ID}/player`);
        if (player) {
            document.getElementById('player-balance').textContent = formatBalance(player.balances, player.defaultCurrency);
        }
    } catch (e) {
        console.error('Failed to reload balance:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════
// QUANTITY BUTTONS
// ═══════════════════════════════════════════════════════════════════

document.getElementById('amount-minus')?.addEventListener('click', () => {
    const inp = document.getElementById('amount-input');
    inp.value = Math.max(1, (parseInt(inp.value) || 1) - 1);
    updateModalTotal();
    updateQtyButtonStates('amount-input', 'amount-minus', 'amount-plus', currentBuyContext?.maxQty || 64);
});

document.getElementById('amount-plus')?.addEventListener('click', () => {
    const inp = document.getElementById('amount-input');
    inp.value = Math.min(currentBuyContext?.maxQty || 64, (parseInt(inp.value) || 1) + 1);
    updateModalTotal();
    updateQtyButtonStates('amount-input', 'amount-minus', 'amount-plus', currentBuyContext?.maxQty || 64);
});

document.getElementById('amount-input')?.addEventListener('input', () => {
    const inp = document.getElementById('amount-input');
    const max = currentBuyContext?.maxQty || 64;
    if (parseInt(inp.value) > max) inp.value = max;
    updateModalTotal();
    updateQtyButtonStates('amount-input', 'amount-minus', 'amount-plus', max);
});

document.getElementById('order-fill-amount-minus')?.addEventListener('click', () => {
    const inp = document.getElementById('order-fill-amount-input');
    inp.value = Math.max(1, (parseInt(inp.value) || 1) - 1);
    updateOrderFillTotal();
    updateQtyButtonStates('order-fill-amount-input', 'order-fill-amount-minus', 'order-fill-amount-plus', currentOrderContext?.maxAmount || 1);
});

document.getElementById('order-fill-amount-plus')?.addEventListener('click', () => {
    const inp = document.getElementById('order-fill-amount-input');
    inp.value = Math.min(currentOrderContext?.maxAmount || 1, (parseInt(inp.value) || 1) + 1);
    updateOrderFillTotal();
    updateQtyButtonStates('order-fill-amount-input', 'order-fill-amount-minus', 'order-fill-amount-plus', currentOrderContext?.maxAmount || 1);
});

document.getElementById('order-fill-amount-input')?.addEventListener('input', () => {
    const inp = document.getElementById('order-fill-amount-input');
    const max = currentOrderContext?.maxAmount || 1;
    if (parseInt(inp.value) > max) inp.value = max;
    updateOrderFillTotal();
    updateQtyButtonStates('order-fill-amount-input', 'order-fill-amount-minus', 'order-fill-amount-plus', max);
});

// ═══════════════════════════════════════════════════════════════════
// STOCKS SEARCH & SORT
// ═══════════════════════════════════════════════════════════════════

function handleStocksSearch(input) {
    const q = input.value.toLowerCase();
    const sorted = getSortedStocks();
    const filtered = q ? sorted.filter(s => s.name.toLowerCase().includes(q)) : sorted;
    renderStocksBody(filtered);
}

// ═══════════════════════════════════════════════════════════════════
// INFINITE SCROLL FOR STOCKS
// ═══════════════════════════════════════════════════════════════════

window.addEventListener('scroll', () => {
    if (currentPage !== 'stocks') return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        const sorted = getSortedStocks();
        if (stocksRenderCount < sorted.length) {
            stocksRenderCount += 50;
            renderStocksBody(sorted);
        }
    }
});

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

async function api(endpoint, method = 'GET', body) {
    const opts = { method, headers: { ...AUTH_HEADERS(), 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${API_BASE}${endpoint}`, opts);
    if (resp.status === 401) {
        showError('Session expired. Use /web in-game to get a new link.');
        return null;
    }
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    return resp.json();
}

function showToast(type, msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function showError(msg) {
    const overlay = document.getElementById('error-overlay');
    document.getElementById('error-message').textContent = msg;
    overlay.style.display = 'flex';
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, ''')
        .replace(/`/g, '&#96;');
}

function escJs(str) {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formatPrice(price, currency) {
    const sym = currency === 'Aurels' ? '₳' : (currency === 'USD' ? '$' : currency || '');
    return `${sym}${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBalance(balances, defaultCurrency) {
    const val = balances?.[defaultCurrency] || 0;
    return formatPrice(val, defaultCurrency);
}

function formatTimeLeft(endsAt) {
    if (!endsAt) return 'Unknown';
    const diff = endsAt - Date.now();
    if (diff <= 0) return 'Ended';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
}

function getIconSVG(name) {
    const icons = {
        stone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
        tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
        gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2l7.5 7.5-7 7-7.5-7.5z"></path><path d="M2 22l7-7"></path><path d="M11 13l3.5-3.5"></path></svg>',
        knowledge_book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    };
    return icons[name] || icons.stone;
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM SELECT DROPDOWN (Keyboard Accessible)
// ═══════════════════════════════════════════════════════════════════

let currentStocksSort = 'name';

function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(sel => {
        const trigger = sel.querySelector('.custom-select-trigger');
        const options = sel.querySelector('.custom-select-options');
        const valueSpan = sel.querySelector('.custom-select-value');
        if (!trigger || !options) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = trigger.getAttribute('aria-expanded') === 'true';
            closeAllCustomSelects();
            if (!isOpen) {
                trigger.setAttribute('aria-expanded', 'true');
                options.classList.add('open');
            }
        });

        options.querySelectorAll('li').forEach(li => {
            li.setAttribute('tabindex', '-1');
            li.addEventListener('click', () => {
                const val = li.getAttribute('data-value');
                const text = li.textContent;
                valueSpan.textContent = text;
                options.querySelectorAll('li').forEach(l => {
                    l.classList.remove('selected');
                    l.setAttribute('aria-selected', 'false');
                });
                li.classList.add('selected');
                li.setAttribute('aria-selected', 'true');
                trigger.setAttribute('aria-expanded', 'false');
                options.classList.remove('open');

                currentStocksSort = val;
                stocksRenderCount = 50;
                const q = document.getElementById('stocks-search')?.value?.toLowerCase() || '';
                const sorted = getSortedStocks();
                const filtered = q ? sorted.filter(s => s.name.toLowerCase().includes(q)) : sorted;
                renderStocksBody(filtered);
            });
        });

        trigger.addEventListener('keydown', (e) => {
            const items = [...options.querySelectorAll('li')];
            let idx = items.findIndex(i => i.classList.contains('selected'));
            if (idx === -1) idx = 0;
            if (e.key === 'ArrowDown') {
                idx = Math.min(items.length - 1, idx + 1);
                items[idx].click();
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                idx = Math.max(0, idx - 1);
                items[idx].click();
                e.preventDefault();
            } else if (e.key === 'Escape') {
                closeAllCustomSelects();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                trigger.click();
            }
        });
    });

    document.addEventListener('click', closeAllCustomSelects);
}

function closeAllCustomSelects() {
    document.querySelectorAll('.custom-select-trigger[aria-expanded="true"]').forEach(t => {
        t.setAttribute('aria-expanded', 'false');
        t.nextElementSibling?.classList.remove('open');
    });
}

// ═══════════════════════════════════════════════════════════════════
// UPDATE +/- BUTTON STATES
// ═══════════════════════════════════════════════════════════════════

function updateQtyButtonStates(inputId, minusId, plusId, maxQty) {
    const val = parseInt(document.getElementById(inputId)?.value) || 1;
    const minusBtn = document.getElementById(minusId);
    const plusBtn = document.getElementById(plusId);
    if (minusBtn) {
        if (val <= 1) minusBtn.classList.add('at-limit');
        else minusBtn.classList.remove('at-limit');
    }
    if (plusBtn) {
        if (val >= maxQty) plusBtn.classList.add('at-limit');
        else plusBtn.classList.remove('at-limit');
    }
}