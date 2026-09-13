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
    "EURUSD": { bid: 1.0850, ask: 1.0852, high: 1.0875, low: 1.0830, spread: 2, type: 'forex' },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, high: 1.2680, low: 1.2610, spread: 3, type: 'forex' },
    "USDJPY": { bid: 151.20, ask: 151.22, high: 151.60, low: 150.90, spread: 2, type: 'forex' },
    "AUDUSD": { bid: 0.6550, ask: 0.6552, high: 0.6580, low: 0.6530, spread: 2, type: 'forex' },
    "USDCAD": { bid: 1.3580, ask: 1.3583, high: 1.3610, low: 1.3550, spread: 3, type: 'forex' },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, high: 2335.00, low: 2310.00, spread: 40, type: 'commodity' },
    "US30": { bid: 39150.0, ask: 39155.0, high: 39300.0, low: 39050.0, spread: 50, type: 'index' },
    "BTCUSD": { bid: 64500.0, ask: 64520.0, high: 65200.0, low: 63800.0, spread: 200, type: 'crypto' }
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
            if (sym.includes('US30') || sym.includes('BTCUSD')) pipScale = 2.0;

            const fluctuation = (Math.random() - 0.5) * pipScale;
            symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
            symbols[sym].ask = parseFloat((symbols[sym].bid + (symbols[sym].spread * (sym.includes('JPY') ? 0.01 : 0.0001))).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
            if (symbols[sym].bid > symbols[sym].high) symbols[sym].high = symbols[sym].bid;
            if (symbols[sym].bid < symbols[sym].low) symbols[sym].low = symbols[sym].bid;
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

    try {
        const run = await apify.actor("hOfycUMuUpaFZvG7a").call({
            brokerId: baseBrokerId,
            loginId: String(loginId),
            password: String(password),
            accountType,
            apifyUserId: 'w8qrLofA75HvkHcAO'
        });
        
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();
        
        if (!items || items.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Failed to retrieve exact account records from broker database.' 
            });
        }

        const record = items[0];
        const balance = parseFloat(record.balance ?? record.accountBalance ?? 10000.00);
        const equity = parseFloat(record.equity ?? record.accountEquity ?? balance);
        const margin = parseFloat(record.margin ?? record.accountMargin ?? 0.00);

        const sessionToken = `token_${Math.random().toString(36).substring(2)}`;
        
        const accountData = {
            loginId,
            brokerId: baseBrokerId,
            accountType,
            balance,
            equity,
            margin,
            freeMargin: equity - margin,
            currency: record.currency || 'USD'
        };

        activeSessions.set(sessionToken, { account: accountData, positions: [], history: [] });

        return res.json({ success: true, sessionToken, account: accountData });

    } catch (err) {
        console.error('Database connection error:', err.message);
        return res.status(500).json({ success: false, message: `Broker auth error: ${err.message}` });
    }
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
                    history: session.history,
                    symbols,
                    marketOpen: isMarketOpen('EURUSD')
                }));
            }

            if (data.action === 'PLACE_ORDER') {
                const session = activeSessions.get(ws.sessionToken);
                if (!session) return;

                const { symbol, type, volume, sl, tp } = data;
                if (!isMarketOpen(symbol)) {
                    ws.send(JSON.stringify({ type: 'ORDER_REJECTED', message: `Market is closed for ${symbol}.` }));
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
                    sl: sl || 0,
                    tp: tp || 0,
                    profit: 0.00,
                    openTime: new Date().toISOString()
                };

                session.positions.push(newPosition);
                ws.send(JSON.stringify({ type: 'ORDER_EXECUTED', position: newPosition, account: session.account, positions: session.positions }));
            }

            if (data.action === 'CLOSE_ORDER') {
                const session = activeSessions.get(ws.sessionToken);
                if (!session) return;

                const index = session.positions.findIndex(p => p.orderId === data.orderId);
                if (index !== -1) {
                    const closed = session.positions.splice(index, 1)[0];
                    closed.closeTime = new Date().toISOString();
                    closed.closePrice = symbols[closed.symbol].bid;
                    closed.netProfit = (Math.random() * 20 - 10).toFixed(2);
                    session.account.balance += parseFloat(closed.netProfit);
                    session.account.equity = session.account.balance;
                    session.history.push(closed);

                    ws.send(JSON.stringify({ type: 'ORDER_CLOSED', orderId: data.orderId, account: session.account, positions: session.positions, history: session.history }));
                }
            }
        } catch (err) {
            console.error('Socket message error:', err);
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`L3 Markets MT5 Engine v1.00 running on port ${PORT}`);
});