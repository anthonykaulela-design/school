const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory data store for platform accounts, quotes, and active positions
const accounts = {
    "ACC1001": { id: "ACC1001", balance: 10000.00, equity: 10000.00, margin: 0, leverage: 100 }
};

const symbols = {
    "EURUSD": { bid: 1.0850, ask: 1.0852, spread: 0.0002 },
    "GBPUSD": { bid: 1.2640, ask: 1.2643, spread: 0.0003 },
    "USDJPY": { bid: 151.20, ask: 151.22, spread: 0.02 },
    "XAUUSD": { bid: 2320.50, ask: 2320.90, spread: 0.40 }
};

const openPositions = [];
let orderIdCounter = 1;

// Real-time price tick generator & broadcaster
setInterval(() => {
    for (let sym in symbols) {
        const fluctuation = (Math.random() - 0.5) * (sym === "USDJPY" ? 0.05 : 0.0004);
        symbols[sym].bid = parseFloat((symbols[sym].bid + fluctuation).toFixed(sym === "USDJPY" ? 2 : 5));
        symbols[sym].ask = parseFloat((symbols[sym].bid + symbols[sym].spread).toFixed(sym === "USDJPY" ? 2 : 5));
    }

    // Recalculate floating profit/loss and equity for accounts
    for (let accId in accounts) {
        let floatingPnL = 0;
        openPositions.filter(p => p.accountId === accId).forEach(pos => {
            const currentPrice = pos.type === 'BUY' ? symbols[pos.symbol].bid : symbols[pos.symbol].ask;
            const priceDiff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
            floatingPnL += priceDiff * pos.volume * 100000;
        });
        accounts[accId].equity = parseFloat((accounts[accId].balance + floatingPnL).toFixed(2));
    }

    const marketTickPayload = JSON.stringify({
        type: 'MARKET_UPDATE',
        symbols,
        accounts,
        openPositions
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(marketTickPayload);
        }
    });
}, 1000);

// WebSocket connection handler for terminal clients
wss.on('connection', (ws) => {
    console.log('New trading terminal connected');

    // Send initial snapshot state
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        accounts,
        symbols,
        openPositions
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'PLACE_ORDER') {
                const { accountId, symbol, type, volume } = data;
                const account = accounts[accountId];
                const symData = symbols[symbol];

                if (!account || !symData) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid account ID or asset symbol.' }));
                    return;
                }

                const executionPrice = type === 'BUY' ? symData.ask : symData.bid;
                const contractSize = 100000;
                const requiredMargin = (volume * contractSize) / account.leverage;

                if ((account.equity - account.margin) < requiredMargin) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Order rejected: Insufficient free margin.' }));
                    return;
                }

                const newPosition = {
                    orderId: orderIdCounter++,
                    accountId,
                    symbol,
                    type,
                    volume,
                    openPrice: executionPrice,
                    openTime: new Date().toISOString()
                };

                openPositions.push(newPosition);
                account.margin += requiredMargin;

                ws.send(JSON.stringify({
                    type: 'ORDER_SUCCESS',
                    position: newPosition,
                    account
                }));
            }

            if (data.action === 'CLOSE_ORDER') {
                const { orderId } = data;
                const posIndex = openPositions.findIndex(p => p.orderId === orderId);

                if (posIndex === -1) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Position not found.' }));
                    return;
                }

                const pos = openPositions[posIndex];
                const account = accounts[pos.accountId];
                const currentPrice = pos.type === 'BUY' ? symbols[pos.symbol].bid : symbols[pos.symbol].ask;
                const priceDiff = pos.type === 'BUY' ? (currentPrice - pos.openPrice) : (pos.openPrice - currentPrice);
                const profitLoss = priceDiff * pos.volume * 100000;

                account.balance += profitLoss;
                const freedMargin = (pos.volume * 100000) / account.leverage;
                account.margin = Math.max(0, account.margin - freedMargin);

                openPositions.splice(posIndex, 1);

                ws.send(JSON.stringify({
                    type: 'CLOSE_SUCCESS',
                    orderId,
                    profit: profitLoss,
                    account
                }));
            }
        } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Trading terminal disconnected');
    });
});

// REST endpoint for account retrieval & historical records
app.get('/api/account/:id', (req, res) => {
    const account = accounts[req.params.id];
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({
        account,
        positions: openPositions.filter(p => p.accountId === req.params.id)
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Trading platform backend engine listening on port ${PORT}`);
});