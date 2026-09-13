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
    { id: 'tickmill-uk', name: 'Tickmill UK Ltd', serverType: 'MT5-Live', host: 'tickmill.live.com:443' }
];

const activeSessions = new Map();

const symbols = {
    // Forex Majors
    "EURUSD": { bid: 1.0850, ask: 1.0852, spread: 0.0002, type: 'forex' },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, spread: 0.0003, type: 'forex' },
    "USDJPY": { bid: 151.20, ask: 151.22, spread: 0.02, type: 'forex' },
    "AUDUSD": { bid: 0.6550, ask: 0.6552, spread: 0.0002, type: 'forex' },
    "USDCAD": { bid: 1.3580, ask: 1.3583, spread: 0.0003, type: 'forex' },
    "NZDUSD": { bid: 0.6080, ask: 0.6083, spread: 0.0003, type: 'forex' },
    "USDCHF": { bid: 0.8820, ask: 0.8823, spread: 0.0003, type: 'forex' },

    // Forex Crosses
    "EURGBP": { bid: 0.8580, ask: 0.8582, spread: 0.0002, type: 'forex' },
    "EURJPY": { bid: 164.05, ask: 164.08, spread: 0.03, type: 'forex' },
    "GBPJPY": { bid: 191.10, ask: 191.14, spread: 0.04, type: 'forex' },
    "AUDJPY": { bid: 99.05, ask: 99.08, spread: 0.03, type: 'forex' },
    "CADJPY": { bid: 111.35, ask: 111.39, spread: 0.04, type: 'forex' },
    "EURNZD": { bid: 1.7840, ask: 1.7845, spread: 0.0005, type: 'forex' },
    "EURAUD": { bid: 1.6560, ask: 1.6565, spread: 0.0005, type: 'forex' },

    // Metals & Commodities
    "XAUUSD": { bid: 2320.50, ask: 2320.90, spread: 0.40, type: 'commodity' },
    "XAGUSD": { bid: 27.40, ask: 27.43, spread: 0.03, type: 'commodity' },
    "BRENT": { bid: 85.20, ask: 85.25, spread: 0.05, type: 'commodity' },
    "WTI": { bid: 81.10, ask: 81.15, spread: 0.05, type: 'commodity' },

    // Global Indices
    "US30": { bid: 39150.0, ask: 39155.0, spread: 5.0, type: 'index' },
    "NAS100": { bid: 18250.0, ask: 18253.0, spread: 3.0, type: 'index' },
    "SPX500": { bid: 5210.0, ask: 5211.0, spread: 1.0, type: 'index' },
    "GER40": { bid: 18120.0, ask: 18123.0, spread: 3.0, type: 'index' },
    "UK100": { bid: 7930.0, ask: 7932.0, spread: 2.0, type: 'index' },
    "JPN225": { bid: 40400.0, ask: 40410.0, spread: 10.0, type: 'index' },

    // Cryptocurrencies (24/7)
    "BTCUSD": { bid: 64500.0, ask: 64520.0, spread: 20.0, type: 'crypto' },
    "ETHUSD": { bid: 3450.0, ask: 3453.0, spread: 3.0, type: 'crypto' }
};

// Check if market is currently open based on UTC time (Forex/Indices/Commodities close weekends)
function isMarketOpen(symbolKey) {
    const sym = symbols[symbolKey];
    if (!sym) return false;
    if (sym.type === 'crypto') return true; // Crypto trades 24/7

    const now = new Date();
    const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getUTCHours();

    // Saturday: closed all day
    if (day === 6) return false;
    // Sunday before 21:00 UTC: closed
    if (day === 0 && hour < 21) return false;
    // Friday after 21:00 UTC: closed
    if (day === 5 && hour >= 21) return false;

    return true;
}

// Broadcast ticker prices only if markets are open
setInterval(() => {
    for (let sym in symbols) {
        // Only tick prices if the market is open (crypto ticks 24/7, forex/indices freeze when closed)
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
        marketStatus: {
            forexOpen: isMarketOpen('EURUSD'),
            cryptoOpen: true
        }
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

app.post('/api/auth/broker-login', (req, res) => {
    const { brokerId, loginId, password } = req.body;
    
    if (!loginId || !password) {
        return res.status(400).json({ success: false, message: 'Login ID and Password are required.' });
    }

    const sessionToken = `token_${Math.random().toString(36).substring(2)}`;
    
    const accountData = {
        loginId,
        brokerId: brokerId || 'pepperstone-live',
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

                // Enforce market hours check: Reject order if market is closed
                if (!isMarketOpen(symbol)) {
                    ws.send(JSON.stringify({ 
                        type: 'ORDER_REJECTED', 
                        message: `Market is closed for ${symbol}. Orders cannot be placed at this time.` 
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