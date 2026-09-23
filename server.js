const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Database Connection Pool configuration (supports MySQL & TiDB)
// Database Connection Pool configuration updated for TiDB Cloud Security
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sol_plaatjie_news',
    port: process.env.DB_PORT || 4000, // TiDB standard port is often 4000
    ssl: {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Initialize Database Tables (Without Dummy News)
async function initDB() {
    try {
        const connection = await pool.getConnection();
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                address TEXT NOT NULL,
                role VARCHAR(50) DEFAULT 'journalist',
                status VARCHAR(50) DEFAULT 'approved',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                image_url LONGTEXT,
                image_source VARCHAR(255),
                pdf_url LONGTEXT,
                journalist_name VARCHAR(255) DEFAULT 'Staff Reporter',
                views INT DEFAULT 0,
                pinned_ad_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                business_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                type VARCHAR(50) DEFAULT 'banner',
                link_url TEXT NOT NULL,
                media_url LONGTEXT NOT NULL,
                payment_proof_url LONGTEXT,
                email VARCHAR(255) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                address TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'approved',
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

        // Ensure default admin user exists (admin / admin)
        const [adminCheck] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (adminCheck.length === 0) {
            await connection.query(
                'INSERT INTO users (username, password, full_name, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['admin', 'admin', 'System Administrator', 'admin@solplaatjie.gov.za', '0820000000', 'Kimberley Municipal Offices', 'admin', 'approved']
            );
        }

        connection.release();
        console.log('Database initialized successfully. Clean state (no dummy articles).');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDB();

// --- API ROUTES ---

// 1. Get all articles (supports search & category filters)
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

// DELETE endpoint for articles
app.delete('/api/articles/:id', async (req, res) => {
    const articleId = req.params.id;

    try {
        // Execute the delete query using your database connection pool
        const query = 'DELETE FROM articles WHERE id = ?';
        const [result] = await db.execute(query, [articleId]);

        // Check if any row was actually deleted
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Article not found.' 
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Article deleted successfully.' 
        });

    } catch (error) {
        console.error('Database error during article deletion:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error while deleting the article.' 
        });
    }
});

// 2. Get dynamic categories list
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT DISTINCT category FROM articles');
        const categories = rows.map(r => r.category);
        const defaultCats = ['Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Technology', 'Education', 'Crime & Courts', 'Municipal Governance'];
        
        const combined = Array.from(new Set(['Trending', ...categories, ...defaultCats]));
        res.json(combined);
    } catch (err) {
        res.json(['Trending', 'Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Technology', 'Education', 'Crime & Courts', 'Municipal Governance']);
    }
});

// 3. Get single article by slug & increment view count
app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) {
            return res.status(404).json({ error: 'Article not found' });
        }
        const article = articles[0];

        // Increment views
        await pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

        // Fetch pinned ad
        if (article.pinned_ad_id) {
            const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [article.pinned_ad_id]);
            if (ads.length > 0) {
                article.pinned_ad = ads[0];
            }
        }

        // Fetch comments
        const [comments] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);

        res.json({ article, comments });
    } catch (err) {
        console.error('Error fetching article:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. Post comment on article
app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        const articleId = req.params.id;

        if (!username || !email || !comment) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await pool.query(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [articleId, username, email, whatsapp || '', comment]
        );

        res.json({ message: 'Comment posted successfully' });
    } catch (err) {
        console.error('Error posting comment:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Pin ad to article (Admin/Journalist)
app.post('/api/articles/:id/pin-ad', async (req, res) => {
    try {
        const { ad_id } = req.body;
        const articleId = req.params.id;

        await pool.query('UPDATE articles SET pinned_ad_id = ? WHERE id = ?', [ad_id, articleId]);
        res.json({ message: 'Ad pinned successfully' });
    } catch (err) {
        console.error('Error pinning ad:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. Staff Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        res.json({ message: 'Login successful', user: users[0] });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Journalist Registration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;
        
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        await pool.query(
            'INSERT INTO users (username, password, full_name, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [username, password, full_name, email, whatsapp, address, role || 'journalist', 'approved']
        );

        res.json({ message: 'Journalist registration successful!' });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 8. Get active ads
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE status = ? ORDER BY created_at DESC', ['approved']);
        res.json(ads);
    } catch (err) {
        console.error('Error fetching ads:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 9. Submit new ad
app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address } = req.body;

        const [result] = await pool.query(
            'INSERT INTO ads (business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [business_name, title, type || 'banner', link_url, media_url, payment_proof_url, email, whatsapp, address, 'approved']
        );

        res.json({ message: 'Ad submitted successfully', ad_id: result.insertId });
    } catch (err) {
        console.error('Error submitting ad:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 10. Track ad view/click
app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const { action } = req.body;
        const adId = req.params.id;

        if (action === 'view') {
            await pool.query('UPDATE ads SET views_count = views_count + 1 WHERE id = ?', [adId]);
        } else if (action === 'click') {
            await pool.query('UPDATE ads SET clicks_count = clicks_count + 1 WHERE id = ?', [adId]);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 11. Get Share & Earn referrers
app.get('/api/referrers', async (req, res) => {
    try {
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY created_at DESC');
        res.json(referrers);
    } catch (err) {
        console.error('Error fetching referrers:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 12. Subscribe to Share & Earn
app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;

        const [existing] = await pool.query('SELECT * FROM referrers WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.json({ notification: 'You are already subscribed to the Share & Earn program!' });
        }

        await pool.query(
            'INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)',
            [name, email, whatsapp, residential_address]
        );

        res.json({ notification: 'Successfully subscribed to Share & Earn program!' });
    } catch (err) {
        console.error('Error subscribing referrer:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 13. Admin Dashboard endpoint
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, full_name, email, whatsapp, role, status FROM users');
        const [articles] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
        const [ads] = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
        const [referrers] = await pool.query('SELECT * FROM referrers ORDER BY created_at DESC');

        res.json({ users, articles, ads, referrers });
    } catch (err) {
        console.error('Error fetching admin dashboard:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie Backend Server running on port ${PORT}`);
});