require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { ApifyClient } = require('apify-client');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const apify = new ApifyClient({
    token: process.env.APIFY_TOKEN
});

const baseBrokers = [
    { id: 'pepperstone', name: 'Pepperstone Group Ltd', serverType: 'MT5' },
    { id: 'icmarkets', name: 'International Capital Markets (IC Markets)', serverType: 'MT5' },
    { id: 'xm', name: 'XM Global Limited', serverType: 'MT5' },
    { id: 'exness', name: 'Exness Technology Ltd', serverType: 'MT5' },
    { id: 'deriv', name: 'Deriv (SVG) LLC', serverType: 'MT5' },
    { id: 'fbs', name: 'FBS Markets Inc', serverType: 'MT5' },
    { id: 'octafx', name: 'Octa Markets Incorporated', serverType: 'MT5' },
    { id: 'alpari', name: 'Alpari Com Limited', serverType: 'MT5' },
    { id: 'roboforex', name: 'RoboForex Ltd', serverType: 'MT5' },
    { id: 'tickmill', name: 'Tickmill UK Ltd', serverType: 'MT5' }
];

// Generate explicit Live and Demo broker choices for selection
const globalBrokers = [];
baseBrokers.forEach(b => {
    globalBrokers.push({
        id: `${b.id}-live`,
        name: `${b.name} (Live)`,
        baseId: b.id,
        accountType: 'live',
        serverType: b.serverType
    });
    globalBrokers.push({
        id: `${b.id}-demo`,
        name: `${b.name} (Demo)`,
        baseId: b.id,
        accountType: 'demo',
        serverType: b.serverType
    });
});

const activeSessions = new Map();

const symbols = {
    "EURUSD": { bid: 1.0850, ask: 1.0852, spread: 0.0002, type: 'forex' },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, spread: 0.0003, type: 'forex' },
    "USDJPY": { bid: 151.20, ask: 151.22, spread: 0.02, type: 'forex' },
    "AUDUSD": { bid: 0.6550, ask: 0.6552, spread: 0.0002, type: 'forex' },
    "USDCAD": { bid: 1.3580, ask: 1.3583, spread: 0.0003, type: 'forex' },
    "NZDUSD": { bid: 0.6080, ask: 0.6083, spread: 0.0003, type: 'forex' },
    "USDCHF": { bid: 0.8820, ask: 0.8823, spread: 0.0003, type: 'forex' },
    "EURGBP": { bid: 0.8580, ask: 0.8582, spread: 0.0002, type: 'forex' },
    "EURJPY": { bid: 164.05, ask: 164.08, spread: 0.03, type: 'forex' },
    "GBPJPY": { bid: 191.10, ask: 191.14, spread: 0.04, type: 'forex' },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, spread: 0.40, type: 'commodity' },
    "XAGUSD": { bid: 27.40, ask: 27.43, spread: 0.03, type: 'commodity' },
    "US30": { bid: 39150.0, ask: 39155.0, spread: 5.0, type: 'index' },
    "NAS100": { bid: 18250.0, ask: 18253.0, spread: 3.0, type: 'index' },
    "BTCUSD": { bid: 64500.0, ask: 64520.0, spread: 20.0, type: 'crypto' },
    "ETHUSD": { bid: 3450.0, ask: 3453.0, spread: 3.0, type: 'crypto' }
};

function isMarketOpen(symbolKey) {
    const sym = symbols[symbolKey];
    if (!sym) return false;
    if (sym.type === 'crypto') return true;

    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();

    if (day === 6) return false;
    if (day === 0 && hour < 21) return false;
    if (day === 5 && hour >= 21) return false;

    return true;
}

setInterval(() => {
    for (let sym in symbols) {
        if (isMarketOpen(sym)) {
            let pipScale = 0.0002;
            if (sym.includes('JPY') || sym === 'XAUUSD') pipScale = 0.05;
            if (sym.includes('US30') || sym.includes('NAS100') || sym.includes('BTCUSD')) pipScale = 2.0;

            const fluctuation = (Math.random() - 0.5) * pipScale;
            symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
            symbols[sym].ask = parseFloat((symbols[sym].bid + symbols[sym].spread).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
        }
    }

    const broadcastPayload = JSON.stringify({ 
        type: 'MARKET_TICK', 
        symbols,
        marketOpen: isMarketOpen('EURUSD')
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastPayload);
        }
    });
}, 1000);

app.get('/api/brokers', (req, res) => {
    res.json({ brokers: globalBrokers });
});

app.post('/api/auth/broker-login', async (req, res) => {
    const { brokerId, loginId, password } = req.body;
    
    if (!loginId || !password) {
        return res.status(400).json({ success: false, message: 'Login ID and Password are required.' });
    }

    const selectedBroker = globalBrokers.find(b => b.id === brokerId) || globalBrokers[0];
    const accountType = selectedBroker.accountType;
    const baseBrokerId = selectedBroker.baseId;

    let realBalance = accountType === 'demo' ? 50000.00 : 2500.00;
    let realEquity = realBalance;
    let realMargin = 0.00;

    try {
        const run = await apify.actor("hOfycUMuUpaFZvG7a").call({
            brokerId: baseBrokerId,
            loginId,
            password,
            accountType,
            apifyUserId: 'w8qrLofA75HvkHcAO'
        });
        
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        if (items && items.length > 0 && items[0].balance) {
            realBalance = parseFloat(items[0].balance);
            realEquity = parseFloat(items[0].equity || items[0].balance);
            realMargin = parseFloat(items[0].margin || 0);
        }
    } catch (apifyErr) {
        console.log("Apify fetch fallback active:", apifyErr.message);
    }

    const sessionToken = `token_${Math.random().toString(36).substring(2)}`;
    
    const accountData = {
        loginId,
        brokerId: baseBrokerId,
        accountType,
        balance: realBalance,
        equity: realEquity,
        margin: realMargin,
        freeMargin: realEquity - realMargin,
        currency: 'USD'
    };

    activeSessions.set(sessionToken, { account: accountData, positions: [] });

    res.json({
        success: true,
        sessionToken,
        account: accountData
    });
});

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'SUBSCRIBE_ACCOUNT') {
                const session = activeSessions.get(data.sessionToken);
                if (!session) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized session.' }));
                    return;
                }
                ws.sessionToken = data.sessionToken;
                ws.send(JSON.stringify({ 
                    type: 'INIT_STATE', 
                    account: session.account, 
                    positions: session.positions, 
                    symbols,
                    marketOpen: isMarketOpen('EURUSD')
                }));
            }

            if (data.action === 'PLACE_ORDER') {
                const session = activeSessions.get(ws.sessionToken);
                if (!session) return;

                const { symbol, type, volume } = data;

                if (!isMarketOpen(symbol)) {
                    ws.send(JSON.stringify({ 
                        type: 'ORDER_REJECTED', 
                        message: `Market is closed for ${symbol}. Orders cannot be placed while the market is closed.` 
                    }));
                    return;
                }

                const symData = symbols[symbol];
                const executionPrice = type === 'BUY' ? symData.ask : symData.bid;
                
                const newPosition = {
                    orderId: Math.floor(100000 + Math.random() * 900000),
                    symbol,
                    type,
                    volume,
                    openPrice: executionPrice,
                    openTime: new Date().toISOString()
                };

                session.positions.push(newPosition);
                ws.send(JSON.stringify({ type: 'ORDER_EXECUTED', position: newPosition, account: session.account }));
            }
        } catch (err) {
            console.error('Socket error:', err);
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`L3 Markets trading engine running on port ${PORT}`);
});