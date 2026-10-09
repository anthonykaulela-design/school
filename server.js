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
                status VARCHAR(50) DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Safe column updates for existing tables
        try { await connection.query('ALTER TABLE articles ADD COLUMN status VARCHAR(50) DEFAULT "published"'); } catch (e) {}

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        console.log('TiDB Database initialized successfully for Dikgang tsa Sol Plaatjie.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDB();

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Get all articles (supports search & category filters)
app.get('/api/articles', async (req, res) => {
    try {
        let query = 'SELECT * FROM articles WHERE (status = "published" OR status IS NULL)';
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

        // Attach pinned ads if assigned
        for (let art of articles) {
            if (art.pinned_ad_id) {
                const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [art.pinned_ad_id]);
                if (ads.length > 0) {
                    art.pinned_ad = ads[0];
                }
            }
        }

        res.json(articles);
    } catch (err) {
        console.error('Error fetching articles:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Categories
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM categories');
        const categories = rows.map(r => r.name);
        res.json(['Trending', ...categories]);
    } catch (err) {
        res.json(['Trending', 'News', 'Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Municipal Governance', 'Crime & Courts']);
    }
});

// Get Single Article by Slug & Increment Views
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
        console.error('Error fetching article:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create Article (With Auto-Slug Generation)
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
            [title, slug, category, content, image_url || null, image_source || null, pdf_url || null, video_embed || null, journalist_id || null, journalist_name || 'Staff Reporter', pinned_ad_id || null]
        );

        // Notify subscribers
        const [subscribers] = await pool.query('SELECT * FROM subscribers');
        subscribers.forEach(sub => {
            console.log(`[DISPATCH] Alerting subscriber ${sub.email} about new article: "${title}"`);
        });

        res.status(201).json({ success: true, message: 'Article created successfully', slug, articleId: result.insertId });
    } catch (err) {
        console.error('Error creating article:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete Article (Admin)
app.delete('/api/articles/:id', async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM articles WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Article not found' });
        res.json({ success: true, message: 'Article deleted successfully' });
    } catch (err) {
        console.error('Error deleting article:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reject Article Status (Admin)
app.post('/api/articles/:id/reject', async (req, res) => {
    try {
        await pool.query('UPDATE articles SET status = "rejected" WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Article rejected successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Post Comment on Article
app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        if (!username || !email || !comment) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await pool.query(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, username, email, whatsapp || '', comment]
        );
        res.json({ success: true, message: 'Comment posted successfully' });
    } catch (err) {
        console.error('Error posting comment:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Pin Ad to Article
app.post('/api/articles/:id/pin-ad', async (req, res) => {
    try {
        const { ad_id } = req.body;
        await pool.query('UPDATE articles SET pinned_ad_id = ? WHERE id = ?', [ad_id || null, req.params.id]);
        res.json({ success: true, message: 'Ad pinned successfully' });
    } catch (err) {
        console.error('Error pinning ad:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Staff Login
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
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Journalist Registration
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
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Active Ads
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = "active" ORDER BY created_at DESC');
        res.json(ads);
    } catch (err) {
        console.error('Error fetching ads:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Submit New Ad
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

// Track Ad Impressions & Clicks
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

// Get Referrers (Share & Earn)
app.get('/api/referrers', async (req, res) => {
    try {
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY created_at DESC');
        res.json(referrers);
    } catch (err) {
        console.error('Error fetching referrers:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Subscribe to Share & Earn
app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        const [existing] = await pool.query('SELECT * FROM referrers WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.json({ success: true, notification: 'You are already subscribed to Share & Earn!' });
        }

        await pool.query(
            'INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)',
            [name, email, whatsapp, residential_address]
        );

        res.json({ success: true, notification: 'Successfully subscribed to Share & Earn program!' });
    } catch (err) {
        console.error('Error subscribing referrer:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Subscribe to News Notifications
app.post('/api/subscribers', async (req, res) => {
    try {
        const { email, whatsapp } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        await pool.query('INSERT IGNORE INTO subscribers (email, whatsapp) VALUES (?, ?)', [email, whatsapp || '']);
        res.status(201).json({ success: true, message: 'Subscribed to notifications successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin Dashboard endpoint
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
        console.error('Error fetching admin dashboard:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Download PDF Analytics Report
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