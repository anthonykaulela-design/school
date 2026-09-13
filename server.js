const express = require('express');
const http = http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Expanded platform data store with mock broker accounts & credentials
const accounts = {
    "ACC1001": { 
        id: "ACC1001", 
        password: "password123", 
        broker: "MetaTrader Demo LLC", 
        server: "MetaQuotes-Demo", 
        balance: 10000.00, 
        equity: 10000.00, 
        margin: 0, 
        leverage: 100 
    }
};

const symbols = {
    "EURUSD": { bid: 1.0850, ask: 1.0852, spread: 0.0002 },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, spread: 0.0003 },
    "USDJPY": { bid: 151.20, ask: 151.22, spread: 0.02 },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, spread: 0.40 }
};

const openPositions = [];
const tradeHistory = [];
let orderIdCounter = 1;

// REST Login Authentication Endpoint
app.post('/api/login', (req, res) => {
    const { broker, server: srv, accountId, password } = req.body;
    const account = accounts[accountId];

    if (!account) {
        return res.status(401).json({ success: false, message: 'Account not found.' });
    }

    if (account.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid password.' });
    }

    res.json({ 
        success: true, 
        account: {
            id: account.id,
            broker: account.broker,
            server: account.server,
            balance: account.balance,
            equity: account.equity,
            leverage: account.leverage
        } 
    });
});

// Real-time market tick generator & margin monitoring
setInterval(() => {
    for (let sym in symbols) {
        const fluctuation = (Math.random() - 0.5) * (sym === "USDJPY" ? 0.05 : 0.0004);
        symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym === "USDJPY" ? 2 : 5));
        symbols[sym].ask = parseFloat((symbols[sym].bid + symbols[sym].spread).toFixed(sym === "USDJPY" ? 2 : 5));
    }

    for (let accId in accounts) {
        let floatingPnL = 0;
        openPositions.filter(p => p.accountId === accId).forEach(pos => {
            const currentPrice = pos.type === 'BUY' ? symbols[pos.symbol].bid : symbols[pos.symbol].ask;
            const priceDiff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
            floatingPnL += priceDiff * pos.volume * 100000;
        });
        accounts[accId].equity = parseFloat((accounts[accId].balance + floatingPnL).toFixed(2));
    }

    const payload = JSON.stringify({
        type: 'MARKET_UPDATE',
        symbols,
        accounts,
        openPositions
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, 1000);

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'PLACE_ORDER') {
                const { accountId, symbol, type, volume, takeProfit, stopLoss } = data;
                const account = accounts[accountId];
                const symData = symbols[symbol];

                if (!account || !symData) return;

                const executionPrice = type === 'BUY' ? symData.ask : symData.bid;
                const requiredMargin = (volume * 100000) / account.leverage;

                if ((account.equity - account.margin) < requiredMargin) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Insufficient margin for order.' }));
                    return;
                }

                const newPosition = {
                    orderId: orderIdCounter++,
                    accountId,
                    symbol,
                    type,
                    volume,
                    openPrice: executionPrice,
                    takeProfit: takeProfit ? parseFloat(takeProfit) : 0,
                    stopLoss: stopLoss ? parseFloat(stopLoss) : 0,
                    openTime: new Date().toISOString()
                };

                openPositions.push(newPosition);
                account.margin += requiredMargin;
            }

            if (data.action === 'CLOSE_ORDER') {
                const { orderId } = data;
                const posIndex = openPositions.findIndex(p => p.orderId === orderId);
                if (posIndex === -1) return;

                const pos = openPositions[posIndex];
                const account = accounts[pos.accountId];
                const currentPrice = pos.type === 'BUY' ? symbols[pos.symbol].bid : symbols[pos.symbol].ask;
                const priceDiff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
                const profit = priceDiff * pos.volume * 100000;

                account.balance += profit;
                const freedMargin = (pos.volume * 100000) / account.leverage;
                account.margin = Math.max(0, account.margin - freedMargin);

                tradeHistory.push({ ...pos, closePrice: currentPrice, profit, closeTime: new Date().toISOString() });
                openPositions.splice(posIndex, 1);
            }
        } catch (err) {
            console.error(err);
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Broker backend running on port ${PORT}`));