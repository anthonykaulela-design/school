const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
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
    cookie: { secure: false }
}));

// Setup Multer for file uploads
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
    host: process.env.DB_HOST || 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || '46EdNwRpTQ544FS.root',
    password: process.env.DB_PASSWORD || 'yyp96nFLBPM9exvt',
    database: process.env.DB_NAME || 'bongi_trade',
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
            ['Education', 'education'],
            ['Municipal Governance', 'municipal-governance'],
            ['Crime & Courts', 'crime-courts']
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

        const [adminCheck] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (adminCheck.length === 0) {
            const hashedAdminPass = await bcrypt.hash('admin', 10);
            await connection.query(
                'INSERT INTO users (username, password, full_name, email, whatsapp, business_address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['admin', hashedAdminPass, 'System Administrator', 'admin@dikgangtsasolplaatjie.co.za', '0820000000', 'Kimberley Municipal Offices', 'admin', 'approved']
            );
        }

        // Articles Table & Migrations
        await connection.query(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                journalist_name VARCHAR(255) DEFAULT 'Staff Reporter',
                views INT DEFAULT 0,
                status VARCHAR(50) DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try { await connection.query('ALTER TABLE articles DROP FOREIGN KEY fk_2'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles DROP FOREIGN KEY articles_ibfk_1'); } catch (e) {}

        try { await connection.query('ALTER TABLE articles ADD COLUMN category VARCHAR(100)'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN image_url LONGTEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN image_source VARCHAR(255)'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN pdf_url LONGTEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN video_embed TEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN journalist_id INT'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN journalist_name VARCHAR(255) DEFAULT "Staff Reporter"'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN views INT DEFAULT 0'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN pinned_ad_id INT DEFAULT NULL'); } catch (e) {}
        try { await connection.query('ALTER TABLE articles ADD COLUMN status VARCHAR(50) DEFAULT "published"'); } catch (e) {}

        await connection.query('UPDATE articles SET status = "published" WHERE status IS NULL OR status = ""');

        // Ads Table & Migrations
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                business_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                target_link TEXT NOT NULL,
                media_url LONGTEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try { await connection.query('ALTER TABLE ads ADD COLUMN client_id INT'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN business_name VARCHAR(255)'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN title VARCHAR(255)'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN ad_type VARCHAR(50) DEFAULT "banner"'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN target_link TEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN media_url LONGTEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN payment_proof_url LONGTEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN email VARCHAR(255)'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN whatsapp VARCHAR(50)'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN business_address TEXT'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN status VARCHAR(50) DEFAULT "active"'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN views_count INT DEFAULT 0'); } catch (e) {}
        try { await connection.query('ALTER TABLE ads ADD COLUMN clicks_count INT DEFAULT 0'); } catch (e) {}

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
            CREATE TABLE IF NOT EXISTS referrers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                residential_address TEXT NOT NULL,
                earnings DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        console.log('TiDB Database initialized and columns verified successfully.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDB();

// ==========================================
// STANDALONE SERVER-RENDERED ARTICLE PAGES
// ==========================================
app.get('/article/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).send('<h1>Article not found</h1><a href="/">&larr; Back to Home</a>');
        
        const article = articles[0];
        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        let pinnedAd = null;
        if (article.pinned_ad_id) {
            const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [article.pinned_ad_id]);
            if (ads.length > 0) pinnedAd = ads[0];
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>${article.title} - Dikgang tsa Sol Plaatjie</title>
                <meta name="description" content="${article.title}">
                <meta property="og:title" content="${article.title}">
                <meta property="og:description" content="${article.title}">
                <meta property="og:image" content="${article.image_url || ''}">
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-slate-50 text-slate-800 font-sans">
                <header class="bg-blue-900 text-white p-4 shadow sticky top-0 z-50">
                    <div class="max-w-4xl mx-auto flex justify-between items-center">
                        <a href="/" class="text-xl font-extrabold tracking-tight">Dikgang tsa Sol Plaatjie</a>
                        <a href="/" class="text-xs bg-blue-800 hover:bg-blue-700 px-3 py-1.5 rounded-lg font-bold transition">&larr; Back to News Feed</a>
                    </div>
                </header>
                <main class="max-w-4xl mx-auto p-4 sm:p-8 my-6 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <span class="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase">${article.category || 'General'}</span>
                    <h1 class="text-3xl sm:text-4xl font-extrabold text-blue-900 mt-3 mb-3 leading-tight">${article.title}</h1>
                    <div class="text-xs text-slate-500 mb-6 pb-4 border-b flex justify-between items-center">
                        <span>By <strong>${article.journalist_name || 'Staff Reporter'}</strong> | Published: ${new Date(article.created_at).toLocaleString()}</span>
                        <span class="bg-slate-100 px-2.5 py-1 rounded font-bold text-blue-900">${article.views} Views</span>
                    </div>
                    
                    ${article.image_url ? `
                        <div class="mb-6">
                            <img src="${article.image_url}" alt="${article.title}" class="w-full h-96 object-cover rounded-xl shadow-md">
                            ${article.image_source ? `<p class="text-xs text-slate-400 mt-2 italic">Image Source: ${article.image_source}</p>` : ''}
                        </div>
                    ` : ''}

                    <div class="prose max-w-none text-slate-700 leading-relaxed text-base space-y-4 mb-8">
                        ${article.content.replace(/\n/g, '<br>')}
                    </div>

                    ${article.pdf_url ? `
                        <div class="p-4 bg-blue-50 border border-blue-200 rounded-xl mb-8 flex justify-between items-center">
                            <div class="flex items-center space-x-3">
                                <span class="text-2xl">📄</span>
                                <div>
                                    <h4 class="font-bold text-blue-900 text-sm">Attached Official Document / PDF</h4>
                                    <p class="text-xs text-slate-500">Official publication reference file</p>
                                </div>
                            </div>
                            <a href="${article.pdf_url}" target="_blank" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">Download PDF</a>
                        </div>
                    ` : ''}

                    ${pinnedAd ? `
                        <div class="p-6 bg-amber-50 border-2 border-amber-300 rounded-2xl mb-8 flex items-center gap-6 shadow-sm">
                            <img src="${pinnedAd.media_url}" class="w-24 h-20 object-cover rounded-xl shadow">
                            <div>
                                <span class="text-[10px] bg-amber-200 text-amber-900 font-bold px-2 py-0.5 rounded uppercase">Pinned Featured Sponsor</span>
                                <h4 class="font-bold text-blue-900 text-base mt-1">${pinnedAd.title}</h4>
                                <a href="${pinnedAd.link_url}" target="_blank" class="text-xs text-blue-600 font-bold hover:underline mt-1 inline-block">Visit Advertiser &rarr;</a>
                            </div>
                        </div>
                    ` : ''}

                    <div class="border-t pt-8">
                        <h3 class="font-bold text-blue-900 text-xl mb-4">Comments (${comments.length})</h3>
                        <form action="/article/${article.slug}/comment" method="POST" class="bg-slate-50 p-6 rounded-2xl border space-y-3 mb-8">
                            <h4 class="font-bold text-blue-900 text-sm mb-2">Leave a Comment</h4>
                            <input type="text" name="username" placeholder="Your Name" required class="w-full border p-2.5 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-600">
                            <input type="email" name="email" placeholder="Email Address" required class="w-full border p-2.5 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-600">
                            <input type="text" name="whatsapp" placeholder="WhatsApp Number" required class="w-full border p-2.5 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-600">
                            <textarea name="comment" placeholder="Write your comment..." required class="w-full border p-2.5 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-600 h-24"></textarea>
                            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition shadow">Post Comment</button>
                        </form>
                        <div class="space-y-3">
                            ${comments.length === 0 ? '<p class="text-xs text-slate-400">No comments yet.</p>' : ''}
                            ${comments.map(c => `
                                <div class="p-4 bg-slate-50 rounded-xl border text-sm">
                                    <div class="flex justify-between items-center mb-1">
                                        <strong class="text-blue-900">${c.username}</strong>
                                        <span class="text-[10px] text-slate-400">${new Date(c.created_at).toLocaleString()}</span>
                                    </div>
                                    <p class="text-slate-700">${c.comment}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </main>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error loading article page');
    }
});

app.post('/article/:slug/comment', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        const [articles] = await pool.query('SELECT id FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length > 0) {
            await pool.query(
                'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
                [articles[0].id, username, email, whatsapp || '', comment]
            );
        }
        res.redirect(`/article/${req.params.slug}`);
    } catch (err) {
        res.status(500).send('Error posting comment');
    }
});

// ==========================================
// REST API ENDPOINTS
// ==========================================

app.get('/api/articles', async (req, res) => {
    try {
        // Relaxed query returning ALL articles in the database without status filters
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

        for (let art of articles) {
            if (art.pinned_ad_id) {
                const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [art.pinned_ad_id]);
                if (ads.length > 0) art.pinned_ad = ads[0];
            }
        }

        res.json(articles);
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM categories');
        const categories = rows.map(r => r.name);
        res.json(['Trending', ...categories]);
    } catch (err) {
        res.json(['Trending', 'News', 'Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Municipal Governance', 'Crime & Courts']);
    }
});

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

app.post('/api/articles', async (req, res) => {
    try {
        let { title, category, content, image_url, image_source, pdf_url, video_embed, journalist_name, journalist_id, pinned_ad_id } = req.body;

        let slug = title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '') + '-' + Date.now();

        const [result] = await pool.query(
            `INSERT INTO articles (title, slug, category, content, image_url, image_source, pdf_url, video_embed, journalist_id, journalist_name, pinned_ad_id, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
            [title, slug, category || 'General', content, image_url || null, image_source || null, pdf_url || null, video_embed || null, journalist_id || null, journalist_name || 'Staff Reporter', pinned_ad_id || null]
        );

        res.status(201).json({ success: true, message: 'Article created successfully', slug, articleId: result.insertId });
    } catch (err) {
        console.error('Error creating article:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/articles/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM articles WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Article not found' });
        res.json({ success: true, message: 'Article deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/articles/:id/reject', async (req, res) => {
    try {
        await pool.query('UPDATE articles SET status = "rejected" WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Article rejected successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        if (!username || !email || !comment) return res.status(400).json({ error: 'Missing required fields' });
        await pool.query(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, username, email, whatsapp || '', comment]
        );
        res.json({ success: true, message: 'Comment posted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/articles/:id/pin-ad', async (req, res) => {
    try {
        const { ad_id } = req.body;
        await pool.query('UPDATE articles SET pinned_ad_id = ? WHERE id = ?', [ad_id || null, req.params.id]);
        res.json({ success: true, message: 'Ad pinned successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
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

app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username or email already exists' });

        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, full_name, email, whatsapp, business_address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [username, hashed, full_name, email, whatsapp, address, role || 'journalist', 'pending']
        );

        res.json({ success: true, message: 'Registration successful! Awaiting admin approval.' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status != "rejected" OR status IS NULL ORDER BY created_at DESC');
        res.json(ads);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, client_id } = req.body;

        const [result] = await pool.query(
            `INSERT INTO ads (client_id, business_name, title, ad_type, target_link, media_url, payment_proof_url, email, whatsapp, business_address, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [client_id || null, business_name, title, type || 'banner', link_url, media_url, payment_proof_url, email, whatsapp, address]
        );

        res.json({ success: true, message: 'Ad submitted successfully', ad_id: result.insertId });
    } catch (err) {
        console.error('Error submitting ad:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const { action } = req.body;
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

app.get('/api/referrers', async (req, res) => {
    try {
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY created_at DESC');
        res.json(referrers);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        const [existing] = await pool.query('SELECT * FROM referrers WHERE email = ?', [email]);
        if (existing.length > 0) return res.json({ success: true, notification: 'You are already subscribed to Share & Earn!' });

        await pool.query(
            'INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)',
            [name, email, whatsapp, residential_address]
        );

        res.json({ success: true, notification: 'Successfully subscribed to Share & Earn program!' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/subscribers', async (req, res) => {
    try {
        const { email, whatsapp } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        await pool.query('INSERT IGNORE INTO subscribers (email, whatsapp) VALUES (?, ?)', [email, whatsapp || '']);
        res.status(201).json({ success: true, message: 'Subscribed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, full_name, email, whatsapp, role, status FROM users');
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
        const [rawAds] = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');

        const ads = rawAds.map(ad => {
            const totalRevenue = (ad.views_count / 200) * 2;
            const agencyShare = totalRevenue * 0.5;
            return { ...ad, totalRevenue, agencyShare };
        });

        res.json({ users, articles, ads });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/admin/download-pdf-analytics', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads');

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=dikgang-ad-analytics.pdf');
        doc.pipe(res);

        doc.fontSize(18).text('Dikgang tsa Sol Plaatjie - Ad Analytics Report', { align: 'center' });
        doc.moveDown();

        ads.forEach(ad => {
            const totalCost = (ad.views_count / 200) * 2;
            doc.fontSize(11).text(`Ad ID: #${ad.id} | Business: ${ad.business_name} | Type: ${ad.ad_type}`);
            doc.text(`Views: ${ad.views_count} | Clicks: ${ad.clicks_count} | Revenue: R${totalCost.toFixed(2)}`);
            doc.text('-----------------------------------------------------------');
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// SERVER LAUNCH
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie Server running on port ${PORT}`);
});