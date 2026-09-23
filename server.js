const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Pool (Configured for TiDB Cloud with SSL)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sol_plaatje_news',
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});
// Initialize Database Tables & Seed Sample Articles
async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Create Articles Table (includes breaking news and sharing count support)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                journalist_name VARCHAR(150),
                content TEXT NOT NULL,
                image_url LONGTEXT,
                image_source VARCHAR(255),
                video_embed VARCHAR(255),
                views INT DEFAULT 0,
                shares INT DEFAULT 0,
                is_breaking TINYINT(1) DEFAULT 0,
                status VARCHAR(50) DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Safe column additions for existing tables
        try { await connection.execute('ALTER TABLE articles ADD COLUMN shares INT DEFAULT 0'); } catch(e) {}
        try { await connection.execute('ALTER TABLE articles ADD COLUMN is_breaking TINYINT(1) DEFAULT 0'); } catch(e) {}

        // Create Comments Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS comments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                article_id INT,
                username VARCHAR(100) NOT NULL,
                email VARCHAR(150),
                whatsapp VARCHAR(50),
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            )
        `);

        // Create Ads Table (includes ad-pinning support)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                business_name VARCHAR(150) NOT NULL,
                type VARCHAR(50) DEFAULT 'banner',
                email VARCHAR(150),
                whatsapp VARCHAR(50),
                link_url VARCHAR(255),
                media_url LONGTEXT,
                status VARCHAR(50) DEFAULT 'active',
                views INT DEFAULT 0,
                clicks INT DEFAULT 0,
                is_pinned TINYINT(1) DEFAULT 0,
                pinned_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try { await connection.execute('ALTER TABLE ads ADD COLUMN is_pinned TINYINT(1) DEFAULT 0'); } catch(e) {}
        try { await connection.execute('ALTER TABLE ads ADD COLUMN pinned_order INT DEFAULT 0'); } catch(e) {}

        // Create Referrers Table (includes login portal credentials & points tracking for Share & Earn)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS referrers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                username VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                email VARCHAR(150) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                residential_address TEXT NOT NULL,
                referral_code VARCHAR(50) UNIQUE,
                points INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try { await connection.execute('ALTER TABLE referrers ADD COLUMN username VARCHAR(100)'); } catch(e) {}
        try { await connection.execute('ALTER TABLE referrers ADD COLUMN password VARCHAR(255)'); } catch(e) {}
        try { await connection.execute('ALTER TABLE referrers ADD COLUMN referral_code VARCHAR(50)'); } catch(e) {}
        try { await connection.execute('ALTER TABLE referrers ADD COLUMN points INT DEFAULT 0'); } catch(e) {}

        // Create Article Translations Table (Full language translation support for English, Afrikaans, Setswana)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS article_translations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                article_id INT,
                language VARCHAR(10) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
                UNIQUE KEY unique_article_lang (article_id, language)
            )
        `);

        // Create Users / Admin Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(150) NOT NULL,
                role VARCHAR(50) DEFAULT 'editor',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed Default Admin if none exists
        const [users] = await connection.execute('SELECT * FROM users WHERE username = ?', ['admin']);
        if (users.length === 0) {
            await connection.execute(
                'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
                ['admin', 'admin123', 'Sol Plaatje Chief Editor', 'admin']
            );
        }

        // Seed Sample Articles if table is empty
        const [rows] = await connection.execute('SELECT COUNT(*) as count FROM articles');
        if (rows[0].count === 0) {
            const sampleArticles = [
                {
                    title: 'Sol Plaatje Municipality Announces Scheduled Maintenance on Kimberley Water Reticulation Lines',
                    slug: 'sol-plaatje-maintenance-water-lines',
                    category: 'Municipal Governance',
                    journalist_name: 'Tebogo Kaulela',
                    content: 'The Sol Plaatje Local Municipality has issued an urgent notice regarding scheduled maintenance on primary water reticulation lines supplying Kimberley and Galeshewe. Residents are advised to store adequate water supplies as pressure drops are expected across Wards 1 through 15 during off-peak hours.',
                    image_url: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800',
                    image_source: 'Sol Plaatje Communications',
                    is_breaking: 1
                },
                {
                    title: 'Northern Cape High Court Hands Down Landmark Judgment on Municipal Public Participation',
                    slug: 'nc-high-court-municipal-judgment',
                    category: 'Crime & Courts',
                    journalist_name: 'Legal Desk Reporter',
                    content: 'In a significant ruling for local administrative law, the Northern Cape Division of the High Court reviewed municipal public consultation obligations under the Promotion of Administrative Justice Act (PAJA), reinforcing community rights regarding electricity tariff structuring.',
                    image_url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800',
                    image_source: 'High Court Records',
                    is_breaking: 0
                },
                {
                    title: 'Galeshewe Community Sports Tournament Finals Scheduled at Mittah Seperepere Centre',
                    slug: 'galeshewe-sports-tournament-finals',
                    category: 'Sport',
                    journalist_name: 'Sport Editor',
                    content: 'Local football and netball clubs converge this weekend at the Mittah Seperepere Convention Centre grounds for the finals of the annual Sol Plaatje Community Unity Cup, bringing together teams from Ratanang, Greenpoint, and surrounding wards.',
                    image_url: 'https://images.unsplash.com/photo-1517649763962-0c623266cf10?w=800',
                    image_source: 'Tournament Organisers',
                    is_breaking: 0
                }
            ];

            for (const art of sampleArticles) {
                await connection.execute(
                    'INSERT INTO articles (title, slug, category, journalist_name, content, image_url, image_source, is_breaking) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [art.title, art.slug, art.category, art.journalist_name, art.content, art.image_url, art.image_source, art.is_breaking]
                );
            }
        }

        connection.release();
        console.log('Database initialized and seeded successfully.');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}

initDatabase();

// --- API ROUTES ---

// Get Articles (with category, search, language translation, and trending filters)
app.get('/api/articles', async (req, res) => {
    try {
        let query = 'SELECT * FROM articles WHERE status = ?';
        let params = ['published'];

        if (req.query.category) {
            query += ' AND category = ?';
            params.push(req.query.category);
        }
        if (req.query.search) {
            query += ' AND (title LIKE ? OR content LIKE ?)';
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }
        if (req.query.trending === 'true') {
            query += ' ORDER BY (views + (shares * 2)) DESC';
        } else {
            query += ' ORDER BY created_at DESC';
        }

        const [articles] = await pool.execute(query, params);

        // Full Language Translation Support (Afrikaans 'af', Setswana 'tn')
        const lang = req.query.lang;
        if (lang && ['af', 'tn'].includes(lang)) {
            for (let article of articles) {
                const [trans] = await pool.execute(
                    'SELECT title, content FROM article_translations WHERE article_id = ? AND language = ?',
                    [article.id, lang]
                );
                if (trans.length > 0) {
                    article.title = trans[0].title;
                    article.content = trans[0].content;
                } else {
                    article.title = `[${lang.toUpperCase()}] ${article.title}`;
                }
            }
        }

        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trending News Category Endpoint
app.get('/api/articles/trending', async (req, res) => {
    try {
        const [articles] = await pool.execute(
            'SELECT * FROM articles WHERE status = ? ORDER BY (views + (shares * 2)) DESC LIMIT 10',
            ['published']
        );
        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Moving Breaking News Ticker Screen Endpoint
app.get('/api/breaking-news', async (req, res) => {
    try {
        const [articles] = await pool.execute(
            'SELECT id, title, slug, category, created_at FROM articles WHERE status = ? AND is_breaking = 1 ORDER BY created_at DESC',
            ['published']
        );
        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Single Article by Slug (with language translation support)
app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.execute('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).json({ error: 'Article not found' });

        let article = articles[0];
        
        // Increment view count
        await pool.execute('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

        // Language Translation Support
        const lang = req.query.lang;
        if (lang && ['af', 'tn'].includes(lang)) {
            const [trans] = await pool.execute(
                'SELECT title, content FROM article_translations WHERE article_id = ? AND language = ?',
                [article.id, lang]
            );
            if (trans.length > 0) {
                article.title = trans[0].title;
                article.content = trans[0].content;
            } else {
                article.title = `[${lang.toUpperCase()}] ${article.title}`;
            }
        }

        // Fetch comments
        const [comments] = await pool.execute('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        res.json({ article, comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Post Article Comment
app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        const articleId = req.params.id;
        await pool.execute(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [articleId, username, email, whatsapp, comment]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create New Article (with breaking news & translation options)
app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, journalist_name, content, image_url, image_source, status, is_breaking, translations } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        
        const [result] = await pool.execute(
            'INSERT INTO articles (title, slug, category, journalist_name, content, image_url, image_source, status, is_breaking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [title, slug, category, journalist_name, content, image_url, image_source, status || 'published', is_breaking ? 1 : 0]
        );

        const articleId = result.insertId;

        // Save translations if provided
        if (translations && typeof translations === 'object') {
            for (const [lang, transData] of Object.entries(translations)) {
                if (['af', 'tn'].includes(lang) && transData.title && transData.content) {
                    await pool.execute(
                        'INSERT INTO article_translations (article_id, language, title, content) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content)',
                        [articleId, lang, transData.title, transData.content]
                    );
                }
            }
        }

        res.json({ success: true, slug, articleId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Universal Social Media Sharing Track & Reward Endpoint
app.post('/api/articles/:id/share', async (req, res) => {
    try {
        const articleId = req.params.id;
        const { referral_code } = req.body;

        // Increment article share count
        await pool.execute('UPDATE articles SET shares = shares + 1 WHERE id = ?', [articleId]);

        // Reward referrer points if shared via a valid code
        if (referral_code) {
            const [refs] = await pool.execute('SELECT * FROM referrers WHERE referral_code = ?', [referral_code]);
            if (refs.length > 0) {
                await pool.execute('UPDATE referrers SET points = points + 10 WHERE referral_code = ?', [referral_code]);
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Active Ads (Ordered by Pinned status first)
app.get('/api/ads', async (req, res) => {
    try {
        const showAll = req.query.all;
        let query = 'SELECT * FROM ads';
        if (!showAll) {
            query += " WHERE status = 'active'";
        }
        query += ' ORDER BY is_pinned DESC, pinned_order DESC, created_at DESC';
        const [ads] = await pool.execute(query);
        res.json(ads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit Advert
app.post('/api/ads', async (req, res) => {
    try {
        const { title, business_name, type, email, whatsapp, link_url, media_url } = req.body;
        await pool.execute(
            'INSERT INTO ads (title, business_name, type, email, whatsapp, link_url, media_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, business_name, type || 'banner', email, whatsapp, link_url, media_url, 'pending']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Track Ad Click
app.post('/api/ads/:id/track', async (req, res) => {
    try {
        await pool.execute('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin & Journalist Ad-Pinning Routes
app.post('/api/admin/ads/:id/pin', async (req, res) => {
    try {
        const { pinned_order } = req.body;
        await pool.execute('UPDATE ads SET is_pinned = 1, pinned_order = ? WHERE id = ?', [pinned_order || 1, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ads/:id/unpin', async (req, res) => {
    try {
        await pool.execute('UPDATE ads SET is_pinned = 0, pinned_order = 0 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit Referrer (Share & Earn Registration)
app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address, username, password } = req.body;
        const referral_code = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await pool.execute(
            'INSERT INTO referrers (name, email, whatsapp, residential_address, username, password, referral_code, points) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
            [name, email, whatsapp, residential_address, username || email, password || 'share123', referral_code]
        );
        res.json({ success: true, referral_code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Referrer Login Portal (Share & Earn Login)
app.post('/api/referrers/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [referrers] = await pool.execute(
            'SELECT * FROM referrers WHERE (username = ? OR email = ?) AND password = ?',
            [username, username, password]
        );
        if (referrers.length === 0) return res.status(401).json({ error: 'Invalid referrer credentials' });

        res.json({ referrer: referrers[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Referrer Dashboard Stats
app.get('/api/referrers/:id/dashboard', async (req, res) => {
    try {
        const [referrers] = await pool.execute('SELECT * FROM referrers WHERE id = ?', [req.params.id]);
        if (referrers.length === 0) return res.status(404).json({ error: 'Referrer not found' });
        res.json({ referrer: referrers[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await pool.execute('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        res.json({ user: users[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Dashboard Data
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [articles] = await pool.execute('SELECT * FROM articles ORDER BY created_at DESC');
        const [ads] = await pool.execute('SELECT * FROM ads ORDER BY is_pinned DESC, created_at DESC');
        const [referrers] = await pool.execute('SELECT * FROM referrers ORDER BY points DESC');
        res.json({ articles, ads, referrers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Activate Ad
app.post('/api/admin/ads/:id/activate', async (req, res) => {
    try {
        await pool.execute('UPDATE ads SET status = ? WHERE id = ?', ['active', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Breaking News Status
app.post('/api/admin/articles/:id/breaking', async (req, res) => {
    try {
        const { is_breaking } = req.body;
        await pool.execute('UPDATE articles SET is_breaking = ? WHERE id = ?', [is_breaking ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie server running on http://localhost:${PORT}`);
});