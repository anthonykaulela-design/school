const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();

// Increase JSON and urlencoded payload limits to 50mb to handle base64 image/video uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Pool (Update with your TiDB/MySQL credentials)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'your_tidb_host',
    user: process.env.DB_USER || 'your_tidb_user',
    password: process.env.DB_PASSWORD || 'your_tidb_password',
    database: process.env.DB_NAME || 'your_tidb_database',
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Helper: Strip HTML for meta descriptions
function stripHtml(html) {
    return (html || '').replace(/<[^>]*>?/gm, '').substring(0, 160);
}

// --- SERVER-SIDE ARTICLE ROUTE WITH OPEN GRAPH META TAGS ---
app.get('/article/:slug', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        
        let title = "Dikgang tsa Sol Plaatjie | Local News Agency";
        let description = "Verified news agency covering Kimberley and the Northern Cape.";
        let imageUrl = `${baseUrl}/favicon.ico`;

        if (rows.length > 0) {
            const art = rows[0];
            title = `${art.title} - Dikgang tsa Sol Plaatjie`;
            description = stripHtml(art.content);
            if (art.image_url) {
                if (art.image_url.startsWith('data:image')) {
                    imageUrl = `${baseUrl}/api/articles/id/${art.id}/image`;
                } else {
                    imageUrl = art.image_url;
                }
            }
        }

        // Return HTML with injected Open Graph tags for social media scrapers (WhatsApp, Facebook, Twitter)
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    
    <!-- Open Graph / Social Media Meta Tags for Large Image Preview -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:url" content="${baseUrl}${req.originalUrl}">
    
    <!-- Twitter / X Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">

    <!-- Redirect normal browser users to main app hash router -->
    <script>
        window.location.href = '/#article/${req.params.slug}';
    </script>
</head>
<body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f8fafc; color: #1e3a8a;">
    <h2>Loading Dikgang tsa Sol Plaatjie Article...</h2>
    <p><a href="/#article/${req.params.slug}">Click here if you are not redirected automatically.</a></p>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        res.status(500).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// --- BASE64 IMAGE CONVERSION ENDPOINT (Crucial for WhatsApp/Facebook OG scraping) ---
app.get('/api/articles/id/:id/image', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT image_url FROM articles WHERE id = ?', [req.params.id]);
        if (rows.length === 0 || !rows[0].image_url) {
            return res.status(404).send('Image not found');
        }
        const dataUri = rows[0].image_url;
        if (dataUri.startsWith('data:')) {
            const matches = dataUri.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const mimeType = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                res.setHeader('Content-Type', mimeType);
                return res.send(buffer);
            }
        }
        res.redirect(dataUri);
    } catch (e) {
        res.status(500).send('Error serving image');
    }
});

// --- API ENDPOINTS ---

// Get all articles (with search, category filters, and fallback for NULL/empty status)
app.get('/api/articles', async (req, res) => {
    try {
        let query = 'SELECT * FROM articles WHERE (status = "published" OR status IS NULL OR status = "")';
        let params = [];
        if (req.query.search) {
            query += ' AND (title LIKE ? OR content LIKE ?)';
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }
        if (req.query.category) {
            query += ' AND category = ?';
            params.push(req.query.category);
        }
        query += ' ORDER BY created_at DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single article by slug
app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).json({ error: 'Article not found' });
        const article = articles[0];

        // Increment view count
        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);

        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);
        res.json({ article, comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Post new article
app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, content, image_url, image_source, video_embed, journalist_id, journalist_name } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        const status = (req.body.status || 'published'); 

        const query = `INSERT INTO articles (title, slug, category, content, image_url, image_source, video_embed, journalist_id, journalist_name, status, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
        await pool.query(query, [title, slug, category, content, image_url, image_source, video_embed, journalist_id, journalist_name, status]);
        res.json({ message: 'Article submitted successfully!', slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Categories list
app.get('/api/categories', (req, res) => {
    res.json(['Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Lifestyle', 'Technology', 'Education', 'Crime & Courts']);
});

// Authentication
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Hardcoded admin fallback
        if (username === 'admin' && password === 'admin') {
            return res.json({ user: { id: 0, username: 'admin', role: 'admin', full_name: 'System Administrator' } });
        }
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        res.json({ user: users[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;
        const query = `INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`;
        await pool.query(query, [full_name, username, password, email, whatsapp, address, role || 'journalist']);
        res.json({ message: 'Registration submitted successfully! Awaiting admin approval.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Dashboard Data
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users');
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
        const [ads] = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
        const [referrers] = await pool.query('SELECT * FROM referrers');
        res.json({ users, articles, ads, referrers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/status', async (req, res) => {
    try {
        await pool.query('UPDATE users SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/articles/:id/publish', async (req, res) => {
    try {
        await pool.query('UPDATE articles SET status = "published" WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ads/:id/activate', async (req, res) => {
    try {
        await pool.query('UPDATE ads SET status = "active" WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ads
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = "active"');
        res.json(ads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, creator_id } = req.body;
        const ad_id = 'AD-' + Math.floor(100000 + Math.random() * 900000);
        const query = `INSERT INTO ads (ad_id, business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, creator_id, status, views, clicks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0)`;
        await pool.query(query, [ad_id, business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, creator_id]);
        res.json({ message: 'Ad submitted successfully', ad_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const { action } = req.body;
        if (action === 'view') {
            await pool.query('UPDATE ads SET views = views + 1 WHERE id = ?', [req.params.id]);
        } else if (action === 'click') {
            await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Referrers / Share & Earn
app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        await pool.query('INSERT INTO referrers (name, email, whatsapp, residential_address, earnings) VALUES (?, ?, ?, ?, 0.00)', [name, email, whatsapp, residential_address]);
        res.json({ notification: 'Successfully joined Share & Earn!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Comments
app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        await pool.query('INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)', [req.params.id, username, email, whatsapp, comment]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});