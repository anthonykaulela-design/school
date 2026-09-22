/**
 * Dikgang tsa Sol Plaatjie - Production Server
 * Framework: Express.js & MySQL/TiDB
 */

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// --- MIDDLEWARE CONFIGURATION ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Simple request logger for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE CONNECTION POOL ---
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

// --- AUTOMATIC DATABASE SCHEMA INITIALIZATION ---
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Users table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                address TEXT NOT NULL,
                role VARCHAR(50) DEFAULT 'journalist',
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Articles table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                content LONGTEXT NOT NULL,
                image_url LONGTEXT,
                image_source VARCHAR(255),
                video_embed LONGTEXT,
                journalist_id INT,
                journalist_name VARCHAR(255),
                status VARCHAR(50) DEFAULT 'published',
                views INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Comments table
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

        // Ad Placements table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ad_placements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ad_id VARCHAR(100) UNIQUE NOT NULL,
                title VARCHAR(255) NOT NULL,
                type VARCHAR(50) DEFAULT 'banner',
                link_url TEXT,
                media_url LONGTEXT,
                creator_id INT,
                business_name VARCHAR(255),
                email VARCHAR(255),
                whatsapp VARCHAR(50),
                address TEXT,
                payment_proof_url LONGTEXT,
                status VARCHAR(50) DEFAULT 'pending',
                article_id INT,
                views INT DEFAULT 0,
                clicks INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Referrers table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS referrers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                residential_address TEXT NOT NULL,
                earnings DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed default admin user if not exists
        const [adminRows] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (adminRows.length === 0) {
            await connection.query(
                'INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['System Administrator', 'admin', 'admin', 'admin@solplaatjie.news', '0820000000', 'Kimberley Civic Centre', 'admin', 'approved']
            );
            console.log('Default admin user seeded (admin / admin).');
        }

        connection.release();
        console.log('Database tables verified and initialized successfully.');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}

// Verify and initialize on startup
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('Successfully connected to TiDB/MySQL database pool.');
        connection.release();
        await initializeDatabase();
    } catch (err) {
        console.error('Database connection failed on startup:', err.message);
    }
})();

// --- HELPER FUNCTIONS ---
function stripHtml(html) {
    return (html || '').replace(/<[^>]*>?/gm, '').substring(0, 160);
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- HEALTH CHECK ENDPOINT ---
app.get('/api/health', async (req, res) => {
    try {
        const [result] = await pool.query('SELECT 1 AS status');
        res.json({ status: 'healthy', database: result[0].status === 1 ? 'connected' : 'error', timestamp: new Date() });
    } catch (err) {
        res.status(500).json({ status: 'unhealthy', error: err.message });
    }
});

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

        const safeTitle = escapeHtml(title);
        const safeDesc = escapeHtml(description);
        const safeImage = escapeHtml(imageUrl);
        const safeUrl = escapeHtml(`${baseUrl}${req.originalUrl}`);
        const safeSlug = escapeHtml(req.params.slug);

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    
    <!-- Open Graph Meta Tags -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDesc}">
    <meta property="og:image" content="${safeImage}">
    <meta property="og:url" content="${safeUrl}">
    
    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDesc}">
    <meta name="twitter:image" content="${safeImage}">

    <script>
        window.location.href = '/#article/${safeSlug}';
    </script>
</head>
<body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f8fafc; color: #1e3a8a;">
    <h2>Loading Dikgang tsa Sol Plaatjie Article...</h2>
    <p><a href="/#article/${safeSlug}">Click here if you are not redirected automatically.</a></p>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        console.error("Error serving article OG route:", err);
        const indexPath = path.join(__dirname, 'public', 'index.html');
        res.sendFile(indexPath, (sendErr) => {
            if (sendErr) {
                res.status(500).send("Critical error loading application frontend.");
            }
        });
    }
});

// --- BASE64 IMAGE CONVERSION ENDPOINT ---
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
        console.error("Image streaming error:", e);
        res.status(500).send('Error serving image');
    }
});

// --- API ENDPOINTS: ARTICLES ---

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
        console.error("Error fetching articles:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).json({ error: 'Article not found' });
        const article = articles[0];

        // Increment view count asynchronously
        pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]).catch(e => console.error("View increment error:", e));

        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);
        const [ads] = await pool.query('SELECT * FROM ad_placements WHERE article_id = ? AND status = "active"', [article.id]);

        res.json({ article, comments, ads });
    } catch (err) {
        console.error("Error fetching single article:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, content, image_url, image_source, video_embed, journalist_id, journalist_name } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required fields.' });
        }
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        const status = (req.body.status || 'published'); 

        const query = `INSERT INTO articles (title, slug, category, content, image_url, image_source, video_embed, journalist_id, journalist_name, status, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
        await pool.query(query, [title, slug, category, content, image_url, image_source, video_embed, journalist_id, journalist_name, status]);
        res.json({ message: 'Article submitted successfully!', slug });
    } catch (err) {
        console.error("Error creating article:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- API ENDPOINTS: CATEGORIES & AUTH ---

app.get('/api/categories', (req, res) => {
    res.json(['Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Lifestyle', 'Technology', 'Education', 'Crime & Courts', 'Municipal Governance']);
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'admin') {
            return res.json({ user: { id: 0, username: 'admin', role: 'admin', full_name: 'System Administrator' } });
        }
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        res.json({ user: users[0] });
    } catch (err) {
        console.error("Login error:", err);
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
        console.error("Registration error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- API ENDPOINTS: ADMIN DASHBOARD & MANAGEMENT ---

app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users');
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
        const [ads] = await pool.query('SELECT * FROM ad_placements ORDER BY created_at DESC');
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY earnings DESC');
        res.json({ users, articles, ads, referrers });
    } catch (err) {
        console.error("Admin dashboard fetch error:", err);
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
        await pool.query('UPDATE ad_placements SET status = "active" WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ads/:id/allocate', async (req, res) => {
    try {
        const { article_id } = req.body;
        await pool.query('UPDATE ad_placements SET article_id = ? WHERE id = ?', [article_id || null, req.params.id]);
        res.json({ success: true, message: 'Ad placement allocation updated successfully' });
    } catch (err) {
        console.error("Ad allocation error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/referrers/:id/earnings', async (req, res) => {
    try {
        const { earnings } = req.body;
        await pool.query('UPDATE referrers SET earnings = ? WHERE id = ?', [earnings, req.params.id]);
        res.json({ success: true, message: 'Referrer earnings updated successfully' });
    } catch (err) {
        console.error("Referrer earnings update error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- API ENDPOINTS: ADS, REFERRERS, COMMENTS, TRACKING ---

app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ad_placements WHERE status = "active"');
        res.json(ads);
    } catch (err) {
        console.error("Error fetching ads:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { 
            title, ad_type, type, link_url, media_url, 
            creator_id, business_name, email, whatsapp, 
            address, payment_proof_url, article_id 
        } = req.body;

        const adTypeVal = ad_type || type || 'banner';
        const adId = 'AD_' + Date.now();

        const query = `
            INSERT INTO ad_placements 
            (ad_id, title, type, link_url, media_url, creator_id, business_name, email, whatsapp, address, payment_proof_url, status, article_id, views, clicks) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, 0)
        `;

        const values = [
            adId, title, adTypeVal, link_url || null, media_url || null,
            creator_id || null, business_name || null, email || null, 
            whatsapp || null, address || null, payment_proof_url || null, article_id || null
        ];

        await pool.query(query, values);
        res.status(201).json({ success: true, message: 'Ad created successfully', ad_id: adId });
    } catch (err) {
        console.error("Database insert error for ad:", err);
        res.status(500).json({ error: err.message });
    }
});

// Ad view and click tracking endpoint
app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const { action } = req.body; // 'view' or 'click'
        const adId = req.params.id;
        if (action === 'click') {
            await pool.query('UPDATE ad_placements SET clicks = clicks + 1 WHERE id = ? OR ad_id = ?', [adId, adId]);
        } else {
            await pool.query('UPDATE ad_placements SET views = views + 1 WHERE id = ? OR ad_id = ?', [adId, adId]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Ad tracking error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        await pool.query('INSERT INTO referrers (name, email, whatsapp, residential_address, earnings) VALUES (?, ?, ?, ?, 0.00)', [name, email, whatsapp, residential_address]);
        res.json({ notification: 'Successfully joined Share & Earn!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        if (!username || !comment) {
            return res.status(400).json({ error: 'Username and comment are required.' });
        }
        await pool.query('INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)', [req.params.id, username, email, whatsapp, comment]);
        res.json({ success: true });
    } catch (err) {
        console.error("Comment insertion error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- SPA FALLBACK ROUTE ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            res.status(500).send("Application frontend index.html could not be loaded.");
        }
    });
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});