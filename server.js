require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Self-contained Local Broker & Account Database
const mockDatabase = {
    accounts: new Map([
        ["1001001", { loginId: "1001001", password: "password123", broker: "L3 Markets Prime - NY Equinix LD4", type: "Real", balance: 50000.00, equity: 50000.00, margin: 0.00, currency: "USD", leverage: "1:500" }],
        ["2002002", { loginId: "2002002", password: "password123", broker: "L3 Markets Sandbox - Demo NY", type: "Demo", balance: 25000.00, equity: 25000.00, margin: 0.00, currency: "USD", leverage: "1:100" }],
        ["1003001", { loginId: "1003001", password: "password123", broker: "IC Prime Institutional - London LD5", type: "Real", balance: 120000.00, equity: 120000.00, margin: 0.00, currency: "USD", leverage: "1:200" }],
        ["2004001", { loginId: "2004001", password: "password123", broker: "Pepperstone Pro - Frankfurt TY3", type: "Real", balance: 15000.00, equity: 15000.00, margin: 0.00, currency: "EUR", leverage: "1:400" }]
    ]),
    sessions: new Map(),
    positions: new Map(),
    history: new Map()
};

// Comprehensive Symbol List (Zero Omissions)
const symbols = {
    "EURUSD": { bid: 1.0850, ask: 1.0852, high: 1.0875, low: 1.0830, spread: 1.1, type: 'forex', sentiment: 'Bullish 68%' },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, high: 1.2680, low: 1.2610, spread: 1.4, type: 'forex', sentiment: 'Neutral 51%' },
    "USDJPY": { bid: 151.20, ask: 151.22, high: 151.60, low: 150.90, spread: 1.2, type: 'forex', sentiment: 'Bearish 62%' },
    "AUDUSD": { bid: 0.6550, ask: 0.6552, high: 0.6580, low: 0.6530, spread: 1.5, type: 'forex', sentiment: 'Bullish 55%' },
    "USDCAD": { bid: 1.3580, ask: 1.3583, high: 1.3610, low: 1.3550, spread: 1.8, type: 'forex', sentiment: 'Neutral 48%' },
    "NZDUSD": { bid: 0.6080, ask: 0.6083, high: 0.6110, low: 0.6050, spread: 2.0, type: 'forex', sentiment: 'Bullish 53%' },
    "EURJPY": { bid: 164.05, ask: 164.09, high: 164.50, low: 163.70, spread: 2.2, type: 'forex', sentiment: 'Bullish 71%' },
    "GBPJPY": { bid: 191.10, ask: 191.15, high: 191.80, low: 190.50, spread: 2.8, type: 'forex', sentiment: 'Bullish 65%' },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, high: 2335.00, low: 2310.00, spread: 22.0, type: 'commodity', sentiment: 'Strong Bullish 82%' },
    "XAGUSD": { bid: 27.40, ask: 27.43, high: 27.80, low: 27.10, spread: 2.5, type: 'commodity', sentiment: 'Bullish 60%' },
    "US30":   { bid: 39150.0, ask: 39155.0, high: 39300.0, low: 39050.0, spread: 10.0, type: 'index', sentiment: 'Bullish 64%' },
    "US500":  { bid: 5210.0, ask: 5211.0, high: 5230.0, low: 5190.0, spread: 3.5, type: 'index', sentiment: 'Bullish 69%' },
    "NAS100": { bid: 18250.0, ask: 18252.5, high: 18350.0, low: 18150.0, spread: 5.0, type: 'index', sentiment: 'Strong Bullish 76%' },
    "GER40":  { bid: 18120.0, ask: 18123.0, high: 18200.0, low: 18050.0, spread: 7.0, type: 'index', sentiment: 'Neutral 50%' },
    "BTCUSD": { bid: 64500.0, ask: 64520.0, high: 65200.0, low: 63800.0, spread: 12.0, type: 'crypto', sentiment: 'Strong Bullish 85%' },
    "ETHUSD": { bid: 3450.0, ask: 3452.0, high: 3520.0, low: 3380.0, spread: 2.0, type: 'crypto', sentiment: 'Bullish 78%' },
    "SOLUSD": { bid: 145.20, ask: 145.35, high: 152.00, low: 140.00, spread: 0.4, type: 'crypto', sentiment: 'Bullish 73%' },
    "NVDA":   { bid: 880.00, ask: 880.50, high: 895.00, low: 865.00, spread: 0.3, type: 'stock', sentiment: 'Strong Bullish 90%' },
    "TSLA":   { bid: 172.50, ask: 172.70, high: 178.00, low: 169.00, spread: 0.25, type: 'stock', sentiment: 'Bearish 58%' },
    "AAPL":   { bid: 171.20, ask: 171.30, high: 173.50, low: 169.80, spread: 0.2, type: 'stock', sentiment: 'Neutral 52%' }
};

// Real-Time Tick Simulation & Risk Engine
setInterval(() => {
    for (let sym in symbols) {
        let pipScale = 0.0002;
        if (sym.includes('JPY') || sym === 'XAUUSD') pipScale = 0.05;
        if (sym.includes('US30') || sym.includes('NAS100') || sym.includes('BTCUSD')) pipScale = 2.0;
        if (sym.length <= 5 && !sym.includes('USD')) pipScale = 0.5;

        const fluctuation = (Math.random() - 0.5) * pipScale;
        symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 4)));
        symbols[sym].ask = parseFloat((symbols[sym].bid + (symbols[sym].spread * (sym.includes('JPY') ? 0.01 : 0.0001))).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 4)));
    }

    mockDatabase.sessions.forEach((account, token) => {
        const positions = mockDatabase.positions.get(token) || [];
        let totalPnL = 0;
        let totalMargin = 0;

        positions.forEach(pos => {
            const currentSym = symbols[pos.symbol];
            if (!currentSym) return;
            const currentPrice = pos.type === 'BUY' ? currentSym.bid : currentSym.ask;
            const diff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
            
            let multiplier = 100000;
            if (pos.symbol.includes('JPY')) multiplier = 1000;
            if (pos.symbol === 'XAUUSD') multiplier = 100;
            if (pos.symbol.includes('BTC') || pos.symbol.includes('ETH')) multiplier = 1;

            pos.profit = parseFloat((diff * pos.volume * multiplier).toFixed(2));
            totalPnL += pos.profit;
            totalMargin += (pos.volume * 1000) / 50;
        });

        account.equity = parseFloat((account.balance + totalPnL).toFixed(2));
        account.margin = parseFloat(totalMargin.toFixed(2));
        account.freeMargin = parseFloat((account.equity - account.margin).toFixed(2));
    });

    const broadcastPayload = JSON.stringify({ type: 'MARKET_TICK', symbols });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastPayload);
    });
}, 1000);

// API Endpoints for Broker & Account Server Selection
app.get('/api/brokers', (req, res) => {
    res.json({
        brokers: [
            { id: 'l3-prime-live', name: 'L3 Markets Prime - Live Server 01', type: 'Real', group: 'L3 Markets Institutional', ping: '11 ms', serverAddress: 'prime-live.l3markets.io:443' },
            { id: 'l3-sandbox-demo', name: 'L3 Markets Sandbox - Demo Server', type: 'Demo', group: 'L3 Markets Sandbox', ping: '12 ms', serverAddress: 'sandbox-demo.l3markets.io:443' },
            { id: 'ic-institutional', name: 'IC Prime Institutional - Live LD5', type: 'Real', group: 'IC Prime', ping: '16 ms', serverAddress: 'ic-live.ld5.broker:443' },
            { id: 'pepperstone-pro', name: 'Pepperstone Pro - Frankfurt TY3', type: 'Real', group: 'Pepperstone', ping: '19 ms', serverAddress: 'pepperstone.ty3.broker:443' },
            { id: 'exness-global-demo', name: 'Exness Global - Trial / Demo Server', type: 'Demo', group: 'Exness', ping: '24 ms', serverAddress: 'exness-demo.global:443' }
        ]
    });
});

app.post('/api/auth/broker-login', (req, res) => {
    const { serverId, loginId, password } = req.body;
    if (!loginId || !password) {
        return res.status(400).json({ success: false, message: 'Login ID and Password are required.' });
    }

    let account = mockDatabase.accounts.get(loginId);
    if (!account) {
        account = {
            loginId,
            broker: serverId,
            type: serverId.includes('demo') ? 'Demo' : 'Real',
            balance: 25000.00,
            equity: 25000.00,
            margin: 0.00,
            currency: 'USD',
            leverage: '1:200'
        };
        mockDatabase.accounts.set(loginId, account);
    }

    const sessionToken = `l3_token_${Math.random().toString(36).substring(2)}`;
    mockDatabase.sessions.set(sessionToken, account);
    if (!mockDatabase.positions.has(sessionToken)) mockDatabase.positions.set(sessionToken, []);
    if (!mockDatabase.history.has(sessionToken)) mockDatabase.history.set(sessionToken, []);

    return res.json({ success: true, sessionToken, account });
});

// WebSocket Event Handler
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const sessionToken = data.sessionToken || ws.sessionToken;
            const account = mockDatabase.sessions.get(sessionToken);

            if (!account && data.action !== 'SUBSCRIBE_ACCOUNT') return;

            if (data.action === 'SUBSCRIBE_ACCOUNT') {
                ws.sessionToken = data.sessionToken;
                ws.send(JSON.stringify({
                    type: 'INIT_STATE',
                    account,
                    positions: mockDatabase.positions.get(data.sessionToken) || [],
                    history: mockDatabase.history.get(data.sessionToken) || [],
                    symbols
                }));
            }

            if (data.action === 'PLACE_ORDER') {
                const { symbol, type, volume, sl, tp } = data;
                const symData = symbols[symbol];
                const executionPrice = type === 'BUY' ? symData.ask : symData.bid;
                
                const newPosition = {
                    orderId: Math.floor(10000000 + Math.random() * 90000000),
                    symbol,
                    type,
                    volume,
                    openPrice: executionPrice,
                    sl: sl || 0,
                    tp: tp || 0,
                    profit: 0.00,
                    openTime: new Date().toISOString()
                };

                const positions = mockDatabase.positions.get(sessionToken);
                positions.push(newPosition);

                ws.send(JSON.stringify({
                    type: 'ORDER_EXECUTED',
                    account,
                    positions,
                    history: mockDatabase.history.get(sessionToken)
                }));
            }

            if (data.action === 'CLOSE_ORDER') {
                const positions = mockDatabase.positions.get(sessionToken);
                const index = positions.findIndex(p => p.orderId === data.orderId);
                
                if (index !== -1) {
                    const closed = positions.splice(index, 1)[0];
                    closed.closeTime = new Date().toISOString();
                    closed.closePrice = symbols[closed.symbol].bid;
                    closed.netProfit = closed.profit;

                    account.balance += closed.netProfit;
                    account.equity = account.balance;

                    const history = mockDatabase.history.get(sessionToken);
                    history.push(closed);

                    ws.send(JSON.stringify({
                        type: 'ORDER_CLOSED',
                        account,
                        positions,
                        history
                    }));
                }
            }
        } catch (err) {
            console.error('Socket error:', err);
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`L3 Markets Desktop Server engine running on port ${PORT}`);
});