const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Comprehensive global broker directory mimicking MetaTrader's server database
const globalBrokers = [
    { id: 'pepperstone-live', name: 'Pepperstone Group Ltd', serverType: 'MT5-Live', host: 'pepperstone.live.com:443' },
    { id: 'icmarkets-server', name: 'International Capital Markets (IC Markets)', serverType: 'MT5-Live', host: 'icmarkets.live.com:443' },
    { id: 'xm-global', name: 'XM Global Limited', serverType: 'MT5-Real', host: 'xmglobal.live.com:443' },
    { id: 'exness-real', name: 'Exness Technology Ltd', serverType: 'MT5-Real', host: 'exness.real.com:443' },
    { id: 'deriv-server', name: 'Deriv (SVG) LLC', serverType: 'MT5-Server', host: 'deriv.server.com:443' },
    { id: 'FBS-real', name: 'FBS Markets Inc', serverType: 'MT5-Real', host: 'fbs.real.com:443' },
    { id: 'octafx-live', name: 'Octa Markets Incorporated', serverType: 'MT5-Live', host: 'octafx.live.com:443' },
    { id: 'alpari-core', name: 'Alpari Com Limited', serverType: 'MT5-ECN', host: 'alpari.ecn.com:443' },
    { id: 'roboforex-pro', name: 'RoboForex Ltd', serverType: 'MT5-Pro', host: 'roboforex.pro.com:443' },
    { id: 'tickmill-uk', name: 'Tickmill UK Ltd', serverType: 'MT5-Live', host: 'tickmill.live.com:443' },
    { id: 'custom-broker', name: 'Add Custom / Private Broker Server', serverType: 'Custom-FIX', host: 'localhost:443' }
];

const activeSessions = new Map();

const symbols = {
    "EURUSD": { bid: 1.0850, ask: 1.0852, spread: 0.0002 },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, spread: 0.0003 },
    "USDJPY": { bid: 151.20, ask: 151.22, spread: 0.02 },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, spread: 0.40 }
};

setInterval(() => {
    for (let sym in symbols) {
        const fluctuation = (Math.random() - 0.5) * (sym === "USDJPY" ? 0.05 : 0.0004);
        symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym === "USDJPY" ? 2 : 5));
        symbols[sym].ask = parseFloat((symbols[sym].bid + symbols[sym].spread).toFixed(sym === "USDJPY" ? 2 : 5));
    }

    const broadcastPayload = JSON.stringify({ type: 'MARKET_TICK', symbols });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastPayload);
        }
    });
}, 1000);

app.get('/api/brokers', (req, res) => {
    res.json({ brokers: globalBrokers });
});

app.post('/api/auth/broker-login', (req, res) => {
    const { brokerId, loginId, password, customHost } = req.body;
    
    if (!loginId || !password) {
        return res.status(400).json({ success: false, message: 'Login ID and Password are required.' });
    }

    const sessionToken = `token_${Math.random().toString(36).substring(2)}`;
    
    const accountData = {
        loginId,
        brokerId: brokerId || 'custom-broker',
        serverHost: customHost || 'Global Trade Gateway',
        balance: 50000.00,
        equity: 50000.00,
        margin: 0.00,
        freeMargin: 50000.00,
        leverage: 500,
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
                ws.send(JSON.stringify({ type: 'INIT_STATE', account: session.account, positions: session.positions, symbols }));
            }

            if (data.action === 'PLACE_ORDER') {
                const session = activeSessions.get(ws.sessionToken);
                if (!session) return;

                const { symbol, type, volume } = data;
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