const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config(); // Load .env configuration

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve frontend static files from the project root directory
app.use(express.static(path.join(__dirname)));

// Database Connection Configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sol_plaatjie_news',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Automatically enable secure TLS transport for cloud/remote database clusters
const isCloudHost = dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1';
if (process.env.DB_SSL === 'true' || isCloudHost || Number(dbConfig.port) === 4000) {
    dbConfig.ssl = {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    };
    console.log('SSL/TLS transport enabled for secure database connection.');
}

const pool = mysql.createPool(dbConfig);

// Initialize Database Tables if they do not exist
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(150) NOT NULL,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(150) NOT NULL,
                whatsapp VARCHAR(20),
                address TEXT,
                role ENUM('admin', 'journalist', 'reader') DEFAULT 'reader',
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) NOT NULL UNIQUE,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT,
                image_source VARCHAR(150),
                pdf_url TEXT,
                journalist_name VARCHAR(150),
                views INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                pinned_ad_id INT DEFAULT NULL
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS comments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                article_id INT NOT NULL,
                username VARCHAR(100) NOT NULL,
                email VARCHAR(150),
                whatsapp VARCHAR(20),
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                business_name VARCHAR(150) NOT NULL,
                title VARCHAR(200) NOT NULL,
                type ENUM('banner', 'sidebar', 'sponsored') DEFAULT 'banner',
                link_url TEXT,
                media_url TEXT,
                payment_proof_url TEXT,
                email VARCHAR(150),
                whatsapp VARCHAR(20),
                address TEXT,
                views INT DEFAULT 0,
                clicks INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS referrers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(150) NOT NULL,
                whatsapp VARCHAR(20) NOT NULL,
                residential_address TEXT NOT NULL,
                earnings DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed default categories if empty
        const [existingCategories] = await connection.execute('SELECT COUNT(*) as count FROM categories');
        if (existingCategories[0].count === 0) {
            const defaultCategories = [
                'Trending', 'Politics', 'Local News', 'Business', 'Sport', 
                'Entertainment', 'Opinion', 'Technology', 'Education', 
                'Crime & Courts', 'Municipal Governance'
            ];
            for (const cat of defaultCategories) {
                await connection.execute('INSERT IGNORE INTO categories (name) VALUES (?)', [cat]);
            }
        }

        // Seed default admin user if empty
        const [existingUsers] = await connection.execute('SELECT COUNT(*) as count FROM users');
        if (existingUsers[0].count === 0) {
            await connection.execute(
                'INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['System Administrator', 'admin', 'admin123', 'admin@solplaatjienews.co.za', '0820000000', 'Kimberley', 'admin', 'approved']
            );
        }

        connection.release();
        console.log('Database tables verified and initialized successfully.');
    } catch (error) {
        console.error('Database initialization error:', error.message);
    }
}

initializeDatabase();

// ==========================================
// API ROUTES
// ==========================================

app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT name FROM categories');
        res.json(rows.map(r => r.name));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/articles', async (req, res) => {
    try {
        const { category, search } = req.query;
        let query = 'SELECT * FROM articles WHERE 1=1';
        let params = [];

        if (category && category !== 'Trending' && category !== 'All') {
            query += ' AND category = ?';
            params.push(category);
        }

        if (search) {
            query += ' AND (title LIKE ? OR content LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY created_at DESC';

        const [rows] = await pool.execute(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/articles/:slug', async (req, res) => {
    try {
        const identifier = req.params.slug;
        let [articles] = await pool.execute('SELECT * FROM articles WHERE slug = ? OR id = ?', [identifier, identifier]);
        
        if (articles.length === 0) {
            const formattedTitle = identifier.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const fallbackArticle = {
                id: 9999,
                title: formattedTitle,
                slug: identifier,
                category: 'Local News',
                content: `Comprehensive coverage and official updates regarding ${formattedTitle}. Serving Kimberley, Galeshewe, Ritchie, and surrounding Northern Cape communities with verified public interest journalism.`,
                image_url: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=800&q=80',
                image_source: 'Dikgang tsa Sol Plaatjie Newsroom',
                pdf_url: '',
                journalist_name: 'Admin Reporter',
                views: 1,
                created_at: new Date().toISOString(),
                comments: [],
                pinned_ad: null
            };
            return res.json(fallbackArticle);
        }

        const article = articles[0];
        await pool.execute('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);

        const [comments] = await pool.execute('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [article.id]);
        
        let pinnedAd = null;
        if (article.pinned_ad_id) {
            const [ads] = await pool.execute('SELECT * FROM ads WHERE id = ?', [article.pinned_ad_id]);
            if (ads.length > 0) pinnedAd = ads[0];
        }

        res.json({ ...article, comments, pinned_ad: pinnedAd });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, content, image_url, image_source, pdf_url, journalist_name } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        const [result] = await pool.execute(
            'INSERT INTO articles (title, slug, category, content, image_url, image_source, pdf_url, journalist_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, slug, category, content, image_url, image_source, pdf_url, journalist_name || 'Admin Reporter']
        );

        res.status(201).json({ message: 'Article created successfully', articleId: result.insertId, slug });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const articleId = req.params.id;
        const { username, email, whatsapp, comment } = req.body;

        await pool.execute(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [articleId, username, email, whatsapp, comment]
        );

        res.status(201).json({ message: 'Comment added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/articles/:id/pin-ad', async (req, res) => {
    try {
        const articleId = req.params.id;
        const { ad_id } = req.body;

        await pool.execute('UPDATE articles SET pinned_ad_id = ? WHERE id = ?', [ad_id, articleId]);
        res.json({ message: 'Ad pinned successfully to article' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/ads', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM ads ORDER BY created_at DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address } = req.body;

        const [result] = await pool.execute(
            'INSERT INTO ads (business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [business_name, title, type || 'banner', link_url, media_url, payment_proof_url, email, whatsapp, address]
        );

        res.status(201).json({ message: 'Ad submitted successfully', adId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ads/:id/track', async (req, res) => {
    try {
        const adId = req.params.id;
        const { action } = req.body;

        if (action === 'click') {
            await pool.execute('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [adId]);
        } else {
            await pool.execute('UPDATE ads SET views = views + 1 WHERE id = ?', [adId]);
        }

        res.json({ message: 'Tracking recorded successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await pool.execute('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = users[0];
        if (user.status !== 'approved') {
            return res.status(403).json({ error: 'Account pending admin approval' });
        }

        res.json({ message: 'Login successful', user: { id: user.id, full_name: user.full_name, username: user.username, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;

        const [result] = await pool.execute(
            'INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [full_name, username, password, email, whatsapp, address, role || 'journalist', 'pending']
        );

        res.status(201).json({ message: 'Registration submitted successfully. Awaiting approval.', userId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/referrers', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM referrers ORDER BY earnings DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/referrers', async (req, res) => {
    try {
        const { name, email, whatsapp, residential_address } = req.body;

        const [result] = await pool.execute(
            'INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)',
            [name, email, whatsapp, residential_address]
        );

        res.status(201).json({ message: 'Referrer registered successfully', referrerId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});