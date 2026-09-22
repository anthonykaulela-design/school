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

// Database Connection Pool (Configured for TiDB / MySQL)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sol_plaatje_news',
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Initialize Database Tables & Seed Sample Articles
async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Create Articles Table
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
                status VARCHAR(50) DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        // Create Ads Table
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create Referrers Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS referrers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(150) NOT NULL,
                whatsapp VARCHAR(50) NOT NULL,
                residential_address TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                    image_source: 'Sol Plaatje Communications'
                },
                {
                    title: 'Northern Cape High Court Hands Down Landmark Judgment on Municipal Public Participation',
                    slug: 'nc-high-court-municipal-judgment',
                    category: 'Crime & Courts',
                    journalist_name: 'Legal Desk Reporter',
                    content: 'In a significant ruling for local administrative law, the Northern Cape Division of the High Court reviewed municipal public consultation obligations under the Promotion of Administrative Justice Act (PAJA), reinforcing community rights regarding electricity tariff structuring.',
                    image_url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800',
                    image_source: 'High Court Records'
                },
                {
                    title: 'Galeshewe Community Sports Tournament Finals Scheduled at Mittah Seperepere Centre',
                    slug: 'galeshewe-sports-tournament-finals',
                    category: 'Sport',
                    journalist_name: 'Sport Editor',
                    content: 'Local football and netball clubs converge this weekend at the Mittah Seperepere Convention Centre grounds for the finals of the annual Sol Plaatje Community Unity Cup, bringing together teams from Ratanang, Greenpoint, and surrounding wards.',
                    image_url: 'https://images.unsplash.com/photo-1517649763962-0c623266cf10?w=800',
                    image_source: 'Tournament Organisers'
                }
            ];

            for (const art of sampleArticles) {
                await connection.execute(
                    'INSERT INTO articles (title, slug, category, journalist_name, content, image_url, image_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [art.title, art.slug, art.category, art.journalist_name, art.content, art.image_url, art.image_source]
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

// Get Articles (with category & search filtering)
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

        query += ' ORDER BY created_at DESC';
        const [articles] = await pool.execute(query, params);
        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Single Article by Slug
app.get('/api/articles/:slug', async (req, res) => {
    try {
        const [articles] = await pool.execute('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
        if (articles.length === 0) return res.status(404).json({ error: 'Article not found' });

        const article = articles[0];
        
        // Increment view count
        await pool.execute('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
        article.views += 1;

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

// Create New Article
app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, journalist_name, content, image_url, image_source, status } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        
        await pool.execute(
            'INSERT INTO articles (title, slug, category, journalist_name, content, image_url, image_source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, slug, category, journalist_name, content, image_url, image_source, status || 'published']
        );
        res.json({ success: true, slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Active Ads
app.get('/api/ads', async (req, res) => {
    try {
        const [ads] = await pool.execute('SELECT * FROM ads WHERE status = ? ORDER BY created_at DESC', [Reflect.has(req.query, 'all') ? req.query.all : 'active']);
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

// Submit Referrer (Share & Earn)
app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;
        await pool.execute(
            'INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)',
            [name, email, whatsapp, residential_address]
        );
        res.json({ success: true });
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
        const [ads] = await pool.execute('SELECT * FROM ads ORDER BY created_at DESC');
        res.json({ articles, ads });
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

// Start Server
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie server running on http://localhost:${PORT}`);
});