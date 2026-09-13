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

// Self-contained Local Broker Database & Accounts
const mockDatabase = {
    accounts: new Map([
        ["1001001", { loginId: "1001001", password: "password123", broker: "IC Markets - Live Server 01", type: "Live", balance: 25000.00, equity: 25000.00, margin: 0.00, currency: "USD" }],
        ["2002002", { loginId: "2002002", password: "password123", broker: "IC Markets - Demo Server", type: "Demo", balance: 10000.00, equity: 10000.00, margin: 0.00, currency: "USD" }],
        ["1003001", { loginId: "1003001", password: "password123", broker: "Pepperstone Group - Live 03", type: "Live", balance: 50000.00, equity: 50000.00, margin: 0.00, currency: "USD" }],
        ["2003002", { loginId: "2003002", password: "password123", broker: "Pepperstone Group - Demo", type: "Demo", balance: 10000.00, equity: 10000.00, margin: 0.00, currency: "USD" }]
    ]),
    sessions: new Map(),
    positions: new Map(),
    history: new Map()
};

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

// Tick & Equity Engine
setInterval(() => {
    for (let sym in symbols) {
        if (isMarketOpen(sym)) {
            let pipScale = 0.0002;
            if (sym.includes('JPY') || sym === 'XAUUSD') pipScale = 0.05;
            if (sym.includes('US30') || sym.includes('BTCUSD')) pipScale = 2.0;

            const fluctuation = (Math.random() - 0.5) * pipScale;
            symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
            symbols[sym].ask = parseFloat((symbols[sym].bid + (symbols[sym].spread * (sym.includes('JPY') ? 0.01 : 0.0001))).toFixed(sym.includes('JPY') ? 2 : (sym.includes('BTC') ? 1 : 5)));
        }
    }

    mockDatabase.sessions.forEach((account, token) => {
        const positions = mockDatabase.positions.get(token) || [];
        let totalFloatingPnL = 0;
        let totalMargin = 0;

        positions.forEach(pos => {
            const currentSym = symbols[pos.symbol];
            if (!currentSym) return;
            const currentPrice = pos.type === 'BUY' ? currentSym.bid : currentSym.ask;
            const diff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
            
            let multiplier = 100000;
            if (pos.symbol.includes('JPY')) multiplier = 1000;
            if (pos.symbol === 'XAUUSD') multiplier = 100;
            if (pos.symbol === 'BTCUSD') multiplier = 1;

            pos.profit = parseFloat((diff * pos.volume * multiplier).toFixed(2));
            totalFloatingPnL += pos.profit;
            totalMargin += (pos.volume * 1000) / 20;
        });

        account.equity = parseFloat((account.balance + totalFloatingPnL).toFixed(2));
        account.margin = parseFloat(totalMargin.toFixed(2));
        account.freeMargin = parseFloat((account.equity - account.margin).toFixed(2));
    });

    const broadcastPayload = JSON.stringify({ type: 'MARKET_TICK', symbols });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastPayload);
    });
}, 1000);

// API Endpoints: Comprehensive MT5 Broker & Server Listing
app.get('/api/brokers', (req, res) => {
    res.json({
        brokers: [
            { id: 'icmarkets-live', name: 'IC Markets (Global) - Live Server 01', type: 'Live', group: 'IC Markets', ping: '14 ms' },
            { id: 'icmarkets-demo', name: 'IC Markets (Global) - Demo Server', type: 'Demo', group: 'IC Markets', ping: '15 ms' },
            { id: 'pepperstone-live', name: 'Pepperstone Group - Live Server 03', type: 'Live', group: 'Pepperstone', ping: '22 ms' },
            { id: 'pepperstone-demo', name: 'Pepperstone Group - Demo Server', type: 'Demo', group: 'Pepperstone', ping: '20 ms' },
            { id: 'exness-real', name: 'Exness Technologies - Real Server 12', type: 'Live', group: 'Exness', ping: '18 ms' },
            { id: 'exness-trial', name: 'Exness Technologies - Trial / Demo', type: 'Demo', group: 'Exness', ping: '19 ms' },
            { id: 'xm-real', name: 'XM Global Limited - Real 01', type: 'Live', group: 'XM Global', ping: '35 ms' },
            { id: 'xm-demo', name: 'XM Global Limited - Demo', type: 'Demo', group: 'XM Global', ping: '33 ms' },
            { id: 'fxtm-live', name: 'FXTM Forex Time - Live Server', type: 'Live', group: 'FXTM', ping: '28 ms' },
            { id: 'fxtm-demo', name: 'FXTM Forex Time - Demo Server', type: 'Demo', group: 'FXTM', ping: '27 ms' }
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
        // Auto-provision new account for demo/real simulation
        account = {
            loginId,
            broker: serverId,
            type: serverId.includes('demo') || serverId.includes('trial') ? 'Demo' : 'Live',
            balance: 10000.00,
            equity: 10000.00,
            margin: 0.00,
            currency: 'USD'
        };
        mockDatabase.accounts.set(loginId, account);
    }

    const sessionToken = `mt5_token_${Math.random().toString(36).substring(2)}`;
    mockDatabase.sessions.set(sessionToken, account);
    if (!mockDatabase.positions.has(sessionToken)) mockDatabase.positions.set(sessionToken, []);
    if (!mockDatabase.history.has(sessionToken)) mockDatabase.history.set(sessionToken, []);

    return res.json({ success: true, sessionToken, account });
});

// WebSocket Handler
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
                const { symbol, type, volume } = data;
                if (!isMarketOpen(symbol)) return;

                const symData = symbols[symbol];
                const executionPrice = type === 'BUY' ? symData.ask : symData.bid;
                
                const newPosition = {
                    orderId: Math.floor(100000 + Math.random() * 900000),
                    symbol,
                    type,
                    volume,
                    openPrice: executionPrice,
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
            console.error(err);
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`MT5 Custom Engine with Broker/Account Switcher running on port ${PORT}`);
});