const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const https = require('https');
const http = require('http');
const selfsigned = require('selfsigned');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(session({
    secret: 'dikgang-sol-plaatjie-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if deploying strictly on HTTPS with trusted certificate
}));

// Setup Multer for file uploads (Images, PDFs, & Proof of Payment)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// ==========================================
// TiDB CLOUD DATABASE CONNECTION POOL
// ==========================================
const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '46EdNwRpTQ544FS.root',
    password: 'yyp96nFLBPM9exvt',
    database: 'bongi_trade',
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// DATABASE INITIALIZATION & MIGRATIONS
// ==========================================
async function initDB() {
    try {
        const connection = await pool.getConnection();

        await connection.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                slug VARCHAR(100) NOT NULL UNIQUE
            )
        `);

        // Insert BrieflyZA and major media house categories
        const defaultCategories = [
            ['News', 'news'],
            ['Politics', 'politics'],
            ['Entertainment', 'entertainment'],
            ['Business', 'business'],
            ['Sport', 'sport'],
            ['Lifestyle', 'lifestyle'],
            ['Opinion', 'opinion'],
            ['Crime', 'crime'],
            ['World', 'world'],
            ['Local Kimberley', 'local-kimberley'],
            ['Technology', 'technology'],
            ['Education', 'education']
        ];
        for (let cat of defaultCategories) {
            await connection.query('INSERT IGNORE INTO categories (name, slug) VALUES (?, ?)', cat);
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                email VARCHAR(255),
                whatsapp VARCHAR(50),
                business_address TEXT,
                role ENUM('admin', 'journalist', 'client') NOT NULL,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Ensure default admin account exists (admin / admin)
        const [adminCheck] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (adminCheck.length === 0) {
            const hashedAdminPass = await bcrypt.hash('admin', 10);
            await connection.query(
                'INSERT INTO users (username, password, full_name, email, whatsapp, business_address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['admin', hashedAdminPass, 'System Administrator', 'admin@dikgangtsasolplaatjie.co.za', '0820000000', 'Kimberley Municipal Offices', 'admin', 'approved']
            );
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                category_id INT,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                image_url LONGTEXT,
                image_source VARCHAR(255),
                pdf_url LONGTEXT,
                video_embed TEXT,
                journalist_id INT,
                journalist_name VARCHAR(255) DEFAULT 'Staff Reporter',
                views INT DEFAULT 0,
                pinned_ad_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                article_id INT NOT NULL,
                username VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                client_id INT,
                business_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                ad_type ENUM('banner', 'interstitial', 'video') DEFAULT 'banner',
                target_link TEXT NOT NULL,
                media_url LONGTEXT NOT NULL,
                payment_proof_url LONGTEXT,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                business_address TEXT NOT NULL,
                status ENUM('pending', 'active', 'rejected') DEFAULT 'pending',
                views_count INT DEFAULT 0,
                clicks_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                whatsapp VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        connection.release();
        console.log('TiDB Database initialized successfully for Dikgang tsa Sol Plaatjie.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDB();

// ==========================================
// WEB & STATIC PAGES
// ==========================================
app.get('/', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC LIMIT 15');
        const [categories] = await pool.query('SELECT * FROM categories');
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = "active" LIMIT 3');

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Dikgang tsa Sol Plaatjie | #1 News Agency</title>
                <meta name="description" content="South Africa's premier online news agency delivering breaking news, politics, crime, sport, and municipal updates.">
                <style>
                    body { font-family: Arial, sans-serif; margin: 0; background: #f8f9fa; color: #212529; }
                    header { background: #0b1f36; color: #fff; padding: 20px; display: flex; justify-content: space-between; align-items: center; }
                    header nav a { color: #fff; margin-left: 15px; text-decoration: none; font-weight: bold; }
                    .container { max-width: 1100px; margin: 20px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                    .article-card { border-bottom: 1px solid #e9ecef; padding: 15px 0; }
                    .article-card h3 a { color: #0b1f36; text-decoration: none; }
                    .badge { background: #ffc107; color: #000; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
                    .meta { font-size: 0.85rem; color: #6c757d; margin-top: 5px; }
                    .cat-btn { background: #0056b3; color: white; padding: 5px 10px; border-radius: 4px; text-decoration: none; margin-right: 5px; display: inline-block; margin-bottom: 5px; }
                </style>
            </head>
            <body>
                <header>
                    <h1>Dikgang tsa Sol Plaatjie</h1>
                    <nav>
                        <a href="/">Home</a>
                        <a href="/about">About</a>
                        <a href="/personal-data">Personal Data</a>
                        <a href="/privacy-ads">Ads Data</a>
                        <a href="/journalists">Journalists</a>
                        <a href="/client-portal">Client Portal</a>
                        <a href="/login">Staff Login</a>
                    </nav>
                </header>
                <div class="container">
                    <h2>News Categories</h2>
                    <div style="margin-bottom: 20px;">
                        ${categories.map(c => `<a href="/category/${c.slug}" class="cat-btn">${c.name}</a>`).join('')}
                    </div>
                    <h2>Latest Breaking News</h2>
                    ${articles.map(a => `
                        <div class="article-card">
                            <span class="badge">${a.category}</span>
                            <h3><a href="/article/${a.slug}">${a.title}</a></h3>
                            <div class="meta">By ${a.journalist_name} | Published: ${new Date(a.created_at).toLocaleString()} \vert{} Views:${a.views}</div>
                        </div>
                    `).join('')}
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Database error: " + err.message);
    }
});

app.get('/about', (req, res) => res.send(`<h1>About Dikgang tsa Sol Plaatjie</h1><p>We are a dedicated South African news agency providing verified breaking news, investigative reports, and community updates in Sol Plaatje and nationwide.</p><a href="/">&larr; Back to Home</a>`));
app.get('/personal-data', (req, res) => res.send(`<h1>Personal Data Policy</h1><p>We collect comment registration details and journalist profiles securely in compliance with POPIA standards.</p><a href="/">&larr; Back to Home</a>`));
app.get('/privacy-ads', (req, res) => res.send(`<h1>Data Collected for Ads</h1><p>We track ad impressions and clicks to compute transparent metrics (R2 per 200 views with 50% agency split) and manage business client accounts.</p><a href="/">&larr; Back to Home</a>`));

app.get('/journalists', async (req, res) => {
    const [journalists] = await pool.query("SELECT username, full_name, email, whatsapp, created_at FROM users WHERE role='journalist' AND status='approved'");
    res.send(`
        <h1>Approved Journalists</h1>
        <ul>
            ${journalists.map(j => `<li><strong>${j.full_name || j.username}</strong> (${j.email}) - WhatsApp:${j.whatsapp || 'N/A'}</li>`).join('')}
        </ul>
        <a href="/">&larr; Back to Home</a>
    `);
});

// ==========================================
// REST API ENDPOINTS FOR WEB & MOBILE APPS (Android / iOS)
// ==========================================

// Get all articles with search and category filters
app.get('/api/articles', async (req, res) => {
    try {
        let query = 'SELECT * FROM articles WHERE 1=1';
        let params = [];

        if (req.query.search) {
            query += ' AND (title LIKE ? OR content LIKE ?)';
            const searchTerm = `%${req.query.search}%`;
            params.push(searchTerm, searchTerm);
        }

        if (req.query.category && req.query.category !== 'Trending') {
            query += ' AND category = ?';
            params.push(req.query.category);
        }

        query += ' ORDER BY created_at DESC';
        const [articles] = await pool.query(query, params);
        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Categories
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Single Article by Slug (SEO #1 Schema & View Increment)
app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).json({ error: 'Article not found' });
        
        const article = articles[0];
        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        let pinnedAd = null;
        if (article.pinned_ad_id) {
            const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [article.pinned_ad_id]);
            if (ads.length > 0) pinnedAd = ads[0];
        }

        res.json({ article, comments, pinnedAd });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Web Dynamic Article Page Route
app.get('/article/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).send('Article not found');
        const article = articles[0];

        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>${article.title} - Dikgang tsa Sol Plaatjie</title>
                <meta name="description" content="${article.title}">
                <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "NewsArticle",
                  "headline": "${article.title}",
                  "image": ["${article.image_url || ''}"],
                  "datePublished": "${article.created_at}",
                  "author": [{"@type": "Person", "name": "${article.journalist_name}"}]
                }
                </script>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 20px auto; padding: 20px; line-height: 1.6; background: #fff; }
                    .meta { color: #6c757d; font-size: 0.9rem; border-bottom: 1px solid #dee2e6; padding-bottom: 10px; margin-bottom: 20px; }
                    img { max-width: 100%; height: auto; }
                    .comment-box { background: #f1f3f5; padding: 12px; margin-top: 10px; border-radius: 5px; }
                    .popup { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.6); justify-content:center; align-items:center; }
                    .popup-content { background: #fff; padding: 25px; border-radius: 8px; width: 350px; }
                </style>
            </head>
            <body>
                <a href="/">&larr; Back to Home</a>
                <h1>${article.title}</h1>
                <div class="meta">Category: <strong>${article.category}</strong> | Journalist: <strong>${article.journalist_name}</strong> | Published: ${new Date(article.created_at).toLocaleString()} | Views: ${article.views + 1}</div>
                
                ${article.image_url ? `<img src="${article.image_url}" alt="${article.title}"><br><small>Source: ${article.image_source || 'Staff'}</small>` : ''}
                
                <div style="margin-top: 20px;">${article.content}</div>
                ${article.video_embed ? `<div style="margin-top:20px;"><h3>Embedded Media:</h3>${article.video_embed}</div>` : ''}

                <hr style="margin: 40px 0;">
                <h3>Comments (${comments.length})</h3>
                <button onclick="openPopup()" style="padding: 10px 15px; background: #0056b3; color: white; border: none; border-radius: 4px; cursor: pointer;">Add Comment</button>
                
                <div>
                    ${comments.map(c => `
                        <div class="comment-box">
                            <strong>${c.username}</strong> <small>(${new Date(c.created_at).toLocaleString()})</small>
                            <p>${c.comment}</p>
                        </div>
                    `).join('')}
                </div>

                <!-- Comment Popup Form -->
                <div id="commentPopup" class="popup">
                    <div class="popup-content">
                        <h3>Comment Popup</h3>
                        <form action="/api/article/${article.id}/comment" method="POST">
                            <label>Username:</label><br><input type="text" name="username" required style="width:100%; margin-bottom:8px;"><br>
                            <label>Email Address:</label><br><input type="email" name="email" required style="width:100%; margin-bottom:8px;"><br>
                            <label>WhatsApp Number:</label><br><input type="text" name="whatsapp" required style="width:100%; margin-bottom:8px;"><br>
                            <label>Comment:</label><br><textarea name="comment" required style="width:100%; height:70px; margin-bottom:8px;"></textarea><br>
                            <button type="submit" style="background:#28a745; color:white; padding:8px 12px; border:none; cursor:pointer;">Submit</button>
                            <button type="button" onclick="closePopup()" style="background:#dc3545; color:white; padding:8px 12px; border:none; cursor:pointer;">Cancel</button>
                        </form>
                    </div>
                </div>

                <script>
                    function openPopup() { document.getElementById('commentPopup').style.display = 'flex'; }
                    function closePopup() { document.getElementById('commentPopup').style.display = 'none'; }
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error loading article: " + err.message);
    }
});

// Post Comment API & Form Handler
app.post('/api/article/:id/comment', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        await pool.query('INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, username, email, whatsapp, comment]);
        res.redirect('back');
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Publish Article (Journalists & Admin Only - Requires Approval)
app.post('/api/articles', upload.single('image'), async (req, res) => {
    try {
        let { title, category, content, image_source, video_embed, journalist_name, pinned_ad_id } = req.body;
        
        let slug = title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '') + '-' + Date.now();

        const image_url = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;

        const [result] = await pool.query(
            `INSERT INTO articles (title, slug, category, content, image_url, image_source, video_embed, journalist_name, pinned_ad_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, slug, category, content, image_url || null, image_source || null, video_embed || null, journalist_name || 'Staff Reporter', pinned_ad_id || null]
        );

        // Notify subscribers
        const [subscribers] = await pool.query('SELECT * FROM subscribers');
        subscribers.forEach(sub => {
            console.log(`[DISPATCH] Alerting subscriber ${sub.email} about new article: "${title}"`);
        });

        res.status(201).json({ success: true, message: 'Article published successfully', slug, articleId: result.insertId });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// AD MANAGEMENT & REVENUE ANALYTICS API
// ==========================================

// Get Active Ads
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = "active" ORDER BY created_at DESC');
        res.json(ads);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Client Ad Submission (Requires Proof of Payment, Email, WhatsApp, Business Address)
app.post('/api/ads', upload.single('payment_proof'), async (req, res) => {
    try {
        const { business_name, title, ad_type, target_link, media_url, email, whatsapp, business_address, client_id } = req.body;
        const payment_proof_url = req.file ? `/uploads/${req.file.filename}` : req.body.payment_proof_url;

        const [result] = await pool.query(
            `INSERT INTO ads (client_id, business_name, title, ad_type, target_link, media_url, payment_proof_url, email, whatsapp, business_address, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [client_id || null, business_name, title, ad_type || 'banner', target_link, media_url, payment_proof_url, email, whatsapp, business_address]
        );

        res.status(201).json({ 
            success: true, 
            message: 'Ad submitted successfully for admin review. Clients are charged R2 per 200 views.',
            adId: result.insertId 
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Track Ad Impressions & Clicks
app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const { action } = req.body; // 'view' or 'click'
        if (action === 'view') {
            await pool.query('UPDATE ads SET views_count = views_count + 1 WHERE id = ?', [req.params.id]);
        } else if (action === 'click') {
            await pool.query('UPDATE ads SET clicks_count = clicks_count + 1 WHERE id = ?', [req.params.id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// AUTHENTICATION & LOGIN (Hidden Admin / Journalists)
// ==========================================
app.get('/login', (req, res) => {
    res.send(`
        <h2>Staff & Admin Login</h2>
        <form action="/api/auth/login" method="POST">
            <label>Username:</label><br><input type="text" name="username" required><br><br>
            <label>Password:</label><br><input type="password" name="password" required><br><br>
            <button type="submit">Login</button>
        </form>
        <p>Journalist registration? <a href="/journalist-register">Register here</a></p>
        <a href="/">&larr; Home</a>
    `);
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = users[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        if (user.status !== 'approved') return res.status(403).json({ error: 'Account pending admin approval' });

        req.session.user = user;
        res.json({ success: true, message: 'Login successful', role: user.role, user });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Journalist Registration
app.get('/journalist-register', (req, res) => {
    res.send(`
        <h2>Journalist Registration</h2>
        <form action="/api/auth/register" method="POST">
            <label>Full Name:</label><br><input type="text" name="full_name" required><br><br>
            <label>Username:</label><br><input type="text" name="username" required><br><br>
            <label>Email:</label><br><input type="email" name="email" required><br><br>
            <label>WhatsApp:</label><br><input type="text" name="whatsapp" required><br><br>
            <label>Password:</label><br><input type="password" name="password" required><br><br>
            <button type="submit">Register</button>
        </form>
        <a href="/login">&larr; Login</a>
    `);
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, email, whatsapp, password } = req.body;
        const hashed = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO users (username, password, full_name, email, whatsapp, role, status) VALUES (?, ?, ?, ?, ?, "journalist", "pending")',
            [username, hashed, full_name, email, whatsapp]
        );
        res.json({ success: true, message: 'Registration submitted. Awaiting admin approval.' });
    } catch (err) {
        res.status(500).json({ error: 'Username or email already exists' });
    }
});

// ==========================================
// ADMIN DASHBOARD & PDF ANALYTICS DOWNLOAD
// ==========================================
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, full_name, email, whatsapp, role, status FROM users');
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
        const [ads] = await pool.query('SELECT ads.*, users.username as client_name FROM ads LEFT JOIN users ON ads.client_id = users.id ORDER BY ads.created_at DESC');
        
        // Calculate Ad revenues (R2 per 200 views with 50% agency split)
        const computedAds = ads.map(ad => {
            const totalRevenue = (ad.views_count / 200) * 2;
            const agencyShare = totalRevenue * 0.5;
            return { ...ad, totalRevenue, agencyShare };
        });

        res.json({ users, articles, ads: computedAds });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Download Ad Analytics PDF Report for Manual Client Dispatch
app.get('/admin/download-pdf-analytics', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT ads.*, users.username as client_name FROM ads LEFT JOIN users ON ads.client_id = users.id');

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=dikgang-ad-analytics.pdf');
        doc.pipe(res);

        doc.fontSize(20).text('Dikgang tsa Sol Plaatjie - Ad Analytics Report', { align: 'center' });
        doc.moveDown();

        ads.forEach(ad => {
            const totalCost = (ad.views_count / 200) * 2;
            const agencyShare = totalCost * 0.5;
            doc.fontSize(12).text(`Ad ID: #${ad.id} | Business: ${ad.business_name} | Type: ${ad.ad_type}`);
            doc.text(`Views: ${ad.views_count} | Clicks: ${ad.clicks_count}`);
            doc.text(`Total Bill (R2 / 200 views): R${totalCost.toFixed(2)} | 50% Agency Share: R${agencyShare.toFixed(2)}`);
            doc.text(`-----------------------------------------------------------------------------------`);
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin Approve Journalist or Ad
app.post('/api/admin/approve-user/:id', async (req, res) => {
    await pool.query('UPDATE users SET status="approved" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'User approved' });
});

app.post('/api/admin/approve-ad/:id', async (req, res) => {
    await pool.query('UPDATE ads SET status="active" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Ad approved and activated' });
});

// ==========================================
// SECURE HTTPS & HTTP SERVER LAUNCH
// ==========================================
const PORT = process.env.PORT || 3000;

// Generate programmatic self-signed SSL certificate for secure HTTPS execution
const attrs = [{ name: 'commonName', value: 'dikgangtsasolplaatjie.co.za' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const credentials = { key: pems.private, cert: pems.cert };

http.createServer(app).listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie HTTP Server running on port ${PORT}`);
});

https.createServer(credentials, app).listen(PORT + 443, () => {
    console.log(`Dikgang tsa Sol Plaatjie Secure HTTPS Server running on port ${PORT + 443}`);
});