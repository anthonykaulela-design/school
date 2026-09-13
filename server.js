require('dotenv').config();
const express = require('express');
const http = http = require('http');
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
        ["1001001", { loginId: "1001001", password: "password123", broker: "Pepperstone MT5 Live", balance: 25000.00, equity: 25000.00, margin: 0.00, currency: "USD" }],
        ["1001002", { loginId: "1001002", password: "password123", broker: "IC Markets MT5 Demo", balance: 10000.00, equity: 10000.00, margin: 0.00, currency: "USD" }]
    ]),
    sessions: new Map(), // sessionToken -> account object
    positions: new Map(), // sessionToken -> array of open positions
    history: new Map()   // sessionToken -> array of closed trades
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

// Real-time Tick & Equity Engine
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

    // Recalculate open positions PnL and equity for all active sessions
    mockDatabase.sessions.forEach((account, token) => {
        const positions = mockDatabase.positions.get(token) || [];
        let totalFloatingPnL = 0;
        let totalMargin = 0;

        positions.forEach(pos => {
            const currentSym = symbols[pos.symbol];
            if (!currentSym) return;
            const currentPrice = pos.type === 'BUY' ? currentSym.bid : currentSym.ask;
            const diff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
            
            // Standard lot calculation approximation
            let multiplier = 100000;
            if (pos.symbol.includes('JPY')) multiplier = 1000;
            if (pos.symbol === 'XAUUSD') multiplier = 100;
            if (pos.symbol === 'BTCUSD') multiplier = 1;

            pos.profit = parseFloat((diff * pos.volume * multiplier).toFixed(2));
            totalFloatingPnL += pos.profit;
            totalMargin += (pos.volume * 1000) / 20; // 1:50 leverage margin model
        });

        account.equity = parseFloat((account.balance + totalFloatingPnL).toFixed(2));
        account.margin = parseFloat(totalMargin.toFixed(2));
        account.freeMargin = parseFloat((account.equity - account.margin).toFixed(2));
    });

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

// API Endpoints
app.get('/api/brokers', (req, res) => {
    res.json({
        brokers: [
            { id: 'pepperstone-live', name: 'Pepperstone Group Ltd (Live)', accountType: 'live', serverType: 'MT5' },
            { id: 'icmarkets-demo', name: 'IC Markets Global (Demo)', accountType: 'demo', serverType: 'MT5' },
            { id: 'xm-live', name: 'XM Global Limited (Live)', accountType: 'live', serverType: 'MT5' },
            { id: 'exness-live', name: 'Exness Technology Ltd (Live)', accountType: 'live', serverType: 'MT5' }
        ]
    });
});

app.post('/api/auth/broker-login', (req, res) => {
    const { brokerId, loginId, password } = req.body;
    
    if (!loginId || !password) {
        return res.status(400).json({ success: false, message: 'Login ID and Password are required.' });
    }

    // Check or auto-provision account in local database
    let account = mockDatabase.accounts.get(loginId);
    if (!account) {
        account = {
            loginId,
            broker: brokerId,
            balance: 10000.00,
            equity: 10000.00,
            margin: 0.00,
            currency: 'USD'
        };
        mockDatabase.accounts.set(loginId, account);
    }

    const sessionToken = `mt5_token_${Math.random().toString(36.substring(2))}`;
    mockDatabase.sessions.set(sessionToken, account);
    if (!mockDatabase.positions.has(sessionToken)) mockDatabase.positions.set(sessionToken, []);
    if (!mockDatabase.history.has(sessionToken)) mockDatabase.history.set(sessionToken, []);

    return res.json({
        success: true,
        sessionToken,
        account
    });
});

// WebSocket Handler for Real-Time Terminal Actions
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const sessionToken = data.sessionToken || ws.sessionToken;
            const account = mockDatabase.sessions.get(sessionToken);

            if (!account && data.action !== 'SUBSCRIBE_ACCOUNT') {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized session.' }));
                return;
            }

            if (data.action === 'SUBSCRIBE_ACCOUNT') {
                ws.sessionToken = data.sessionToken;
                const acc = mockDatabase.sessions.get(data.sessionToken);
                const positions = mockDatabase.positions.get(data.sessionToken) || [];
                const history = mockDatabase.history.get(data.sessionToken) || [];

                ws.send(JSON.stringify({
                    type: 'INIT_STATE',
                    account: acc,
                    positions,
                    history,
                    symbols,
                    marketOpen: isMarketOpen('EURUSD')
                }));
            }

            if (data.action === 'PLACE_ORDER') {
                const { symbol, type, volume } = data;
                if (!isMarketOpen(symbol)) {
                    ws.send(JSON.stringify({ type: 'ORDER_REJECTED', message: `Market closed for ${symbol}.` }));
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
    console.log(`MetaTrader 5 Native Custom Engine v1.00 running on port ${PORT}`);
});