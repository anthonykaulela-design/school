const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Database Connection Pool (Configured with SSL for TiDB Cloud Serverless)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sol_plaatjie_news',
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// Helper function to generate URL slug
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^\w ]+/g, '')
        .replace(/ +/g, '-') + '-' + Date.now().toString().slice(-4);
}

// --- CATEGORIES ENDPOINT ---
app.get('/api/categories', (req, res) => {
    const categories = [
        'Trending',
        'Politics',
        'Local News',
        'Business',
        'Sport',
        'Entertainment',
        'Opinion',
        'Technology',
        'Education',
        'Crime & Courts',
        'Municipal Governance'
    ];
    res.json(categories);
});

// --- ARTICLES ENDPOINTS ---
app.get('/api/articles', async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = `
            SELECT a.*, 
                   ad.id as ad_id, ad.business_name as ad_business_name, ad.title as ad_title, 
                   ad.link_url as ad_link_url, ad.media_url as ad_media_url 
            FROM articles a 
            LEFT JOIN ads ad ON a.pinned_ad_id = ad.id 
            WHERE a.status = 'published'
        `;
        let params = [];

        if (search) {
            query += ` AND (a.title LIKE ? OR a.content LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        if (category && category !== 'Trending') {
            query += ` AND a.category = ?`;
            params.push(category);
        }

        query += ` ORDER BY a.created_at DESC`;
        const [rows] = await pool.query(query, params);

        const articles = rows.map(row => {
            let article = { ...row };
            if (row.ad_id) {
                article.pinned_ad = {
                    id: row.ad_id,
                    business_name: row.ad_business_name,
                    title: row.ad_title,
                    link_url: row.ad_link_url,
                    media_url: row.ad_media_url
                };
            }
            delete article.ad_id;
            delete article.ad_business_name;
            delete article.ad_title;
            delete article.ad_link_url;
            delete article.ad_media_url;
            return article;
        });

        res.json(articles);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch articles' });
    }
});

app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query(`
            SELECT a.*, 
                   ad.id as ad_id, ad.business_name as ad_business_name, ad.title as ad_title, 
                   ad.link_url as ad_link_url, ad.media_url as ad_media_url 
            FROM articles a 
            LEFT JOIN ads ad ON a.pinned_ad_id = ad.id 
            WHERE a.slug = ?
        `, [req.params.slug]);

        if (articles.length === 0) {
            return res.status(404).json({ error: 'Article not found' });
        }

        const article = articles[0];

        // Increment view count
        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

        if (article.ad_id) {
            article.pinned_ad = {
                id: article.ad_id,
                business_name: article.ad_business_name,
                title: article.ad_title,
                link_url: article.ad_link_url,
                media_url: article.ad_media_url
            };
        }
        delete article.ad_id;
        delete article.ad_business_name;
        delete article.ad_title;
        delete article.ad_link_url;
        delete article.ad_media_url;

        // Fetch comments
        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        res.json({ article, comments });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching article' });
    }
});

app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, content, image_url, image_source, journalist_id, journalist_name } = req.body;
        const slug = generateSlug(title);
        const status = journalist_id ? 'pending' : 'published';

        const [result] = await pool.query(
            `INSERT INTO articles (slug, title, category, content, image_url, image_source, journalist_id, journalist_name, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [slug, title, category, content, image_url, image_source, journalist_id || null, journalist_name || 'Staff Reporter', status]
        );

        res.json({ message: 'Article submitted successfully', article_id: result.insertId, slug });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create article' });
    }
});

app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const articleId = req.params.id;
        const { username, email, whatsapp, comment } = req.body;

        await pool.query(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [articleId, username, email, whatsapp, comment]
        );

        res.json({ message: 'Comment posted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to post comment' });
    }
});

app.post('/api/articles/:id/pin-ad', async (req, res) => {
    try {
        const articleId = req.params.id;
        const { ad_id } = req.body;

        await pool.query('UPDATE articles SET pinned_ad_id = ? WHERE id = ?', [ad_id, articleId]);
        res.json({ message: 'Ad pinned successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to pin ad' });
    }
});

// --- ADS ENDPOINTS ---
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = ? ORDER BY created_at DESC', ['active']);
        res.json(ads);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch ads' });
    }
});
app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address } = req.body;
        const [result] = await pool.query(
            `INSERT INTO ads (business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [business_name, title, type || 'banner', link_url, media_url, payment_proof_url, email, whatsapp, address]
        );
        res.json({ message: 'Ad submitted successfully', ad_id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to submit ad' });
    }
});

app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const adId = req.params.id;
        const { action } = req.body;
        if (action === 'click') {
            await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [adId]);
        } else {
            await pool.query('UPDATE ads SET views = views + 1 WHERE id = ?', [adId]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Tracking failed' });
    }
});

// --- AUTHENTICATION & USERS ENDPOINTS ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = users[0];
        if (user.role === 'journalist' && user.status !== 'approved') {
            return res.status(403).json({ error: 'Your journalist account is pending admin approval.' });
        }

        delete user.password;
        res.json({ user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login error' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;
        await pool.query(
            `INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [full_name, username, password, email, whatsapp, address, role || 'journalist']
        );
        res.json({ message: 'Journalist registration submitted successfully. Awaiting admin approval.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Username or email already exists' });
    }
});

// --- SHARE & EARN / REFERRERS ENDPOINTS ---
app.get('/api/referrers', async (req, res) => {
    try {
        const [referrers] = await pool.query('SELECT * FROM referrers');
        res.json(referrers);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch referrers' });
    }
});

app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        await pool.query(
            `INSERT INTO referrers (name, email, whatsapp, residential_address) 
             VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
            [name, email, whatsapp, residential_address]
        );
        res.json({ notification: 'Successfully subscribed to Share & Earn program!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Referrer subscription failed' });
    }
});

// --- ADMIN DASHBOARD & MANAGEMENT ENDPOINTS ---
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, full_name, email, whatsapp, address, role, status, created_at FROM users');
        const [articles] = await pool.query(`
            SELECT a.*, ad.title as ad_title FROM articles a 
            LEFT JOIN ads ad ON a.pinned_ad_id = ad.id 
            ORDER BY a.created_at DESC
        `);
        const [ads] = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY created_at DESC');

        res.json({ users, articles, ads, referrers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load dashboard data' });
    }
});

app.post('/api/admin/users/:id/status', async (req, res) => {
    try {
        const userId = req.params.id;
        const { status } = req.body;
        await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
        res.json({ message: `User status updated to ${status}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

app.post('/api/admin/articles/:id/publish', async (req, res) => {
    try {
        const articleId = req.params.id;
        await pool.query("UPDATE articles SET status = 'published' WHERE id = ?", [articleId]);
        res.json({ message: 'Article published successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to publish article' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie Backend Server running on port ${PORT}`);
});