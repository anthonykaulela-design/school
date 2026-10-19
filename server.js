const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// TiDB Cloud Database Connection Pool
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

const JWT_SECRET = 'dikgang_sol_plaatjie_secret_key_2026';

// Initialize Database Tables and Default Admin on Startup
async function initDB() {
    try {
        const connection = await pool.getConnection();
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                email VARCHAR(255),
                whatsapp VARCHAR(50),
                address TEXT,
                role ENUM('admin', 'journalist', 'advertiser') DEFAULT 'journalist',
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL
            );
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS articles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                content TEXT NOT NULL,
                category VARCHAR(100) NOT NULL,
                image_url TEXT,
                image_source VARCHAR(255),
                pdf_url TEXT,
                journalist_id INT,
                journalist_name VARCHAR(255),
                views INT DEFAULT 0,
                status ENUM('published', 'rejected') DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
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
            );
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                business_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                type ENUM('banner', 'interstitial', 'video') DEFAULT 'banner',
                link_url TEXT NOT NULL,
                media_url TEXT NOT NULL,
                payment_proof_url TEXT,
                email VARCHAR(255),
                whatsapp VARCHAR(50),
                address TEXT,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
                views INT DEFAULT 0,
                clicks INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
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
            );
        `);

        // Seed Categories
        const defaultCategories = ['Trending', 'Local News', 'Municipal Governance', 'Politics', 'Business', 'Sport', 'Entertainment', 'Opinion', 'Technology', 'Education', 'Crime & Courts'];
        for (const cat of defaultCategories) {
            await connection.query(`INSERT IGNORE INTO categories (name) VALUES (?)`, [cat]);
        }

        // Seed Default Admin (Username: admin, Password: admin)
        const [existingAdmin] = await connection.query(`SELECT * FROM users WHERE username = 'admin'`);
        if (existingAdmin.length === 0) {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await connection.query(
                `INSERT INTO users (username, password, full_name, email, whatsapp, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['admin', hashedPassword, 'System Administrator', 'admin@dikgang.co.za', '0000000000', 'admin', 'approved']
            );
            console.log('Default admin account created: admin / admin');
        }

        connection.release();
        console.log('TiDB Database initialized and verified successfully.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDB();

// --- API ENDPOINTS ---

// 1. Auth: Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password' });

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid username or password' });

        if (user.status !== 'approved' && user.role !== 'admin') {
            return res.status(401).json({ error: 'Account pending admin approval.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Auth: Register Journalist
app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, email, whatsapp, address, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (full_name, username, password, email, whatsapp, address, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [full_name, username, hashedPassword, email, whatsapp, address, role || 'journalist']
        );
        res.json({ message: 'Journalist registration submitted successfully. Awaiting admin approval.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Categories
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM categories');
        res.json(rows.map(r => r.name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Articles: Get All & Search/Filter
app.get('/api/articles', async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = 'SELECT * FROM articles WHERE status = "published"';
        let params = [];

        if (search) {
            query += ' AND (title LIKE ? OR content LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (category && category !== 'Trending') {
            query += ' AND category = ?';
            params.push(category);
        }

        query += ' ORDER BY created_at DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Articles: Create
app.post('/api/articles', async (req, res) => {
    try {
        const { title, category, content, image_source, image_url, pdf_url, journalist_id, journalist_name } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Date.now();

        await pool.query(
            `INSERT INTO articles (title, slug, content, category, image_source, image_url, pdf_url, journalist_id, journalist_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, slug, content, category, image_source, image_url, pdf_url, journalist_id || null, journalist_name || 'Staff Reporter']
        );
        res.json({ message: 'Article published successfully', slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Comments
app.get('/api/articles/:id/comments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/articles/:id/comments', async (req, res) => {
    try {
        const { username, email, whatsapp, comment } = req.body;
        await pool.query(
            'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, username, email, whatsapp, comment]
        );
        res.json({ message: 'Comment posted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Ads
app.get('/api/ads', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM ads WHERE status = "approved" ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address } = req.body;
        const [result] = await pool.query(
            `INSERT INTO ads (business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
            [business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address]
        );
        res.json({ message: 'Ad submitted successfully', ad_id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Admin Dashboard Data
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, full_name, email, whatsapp, role, status FROM users');
        const [ads] = await pool.query('SELECT * FROM ads');
        res.json({ users, ads });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Admin Ad Analytics PDF Export
app.get('/api/admin/ads/:id/pdf', async (req, res) => {
    try {
        const [ads] = await pool.query('SELECT * FROM ads WHERE id = ?', [req.params.id]);
        if (ads.length === 0) return res.status(404).json({ error: 'Ad not found' });
        const ad = ads[0];

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=ad-analytics-${ad.id}.pdf`);

        const doc = new PDFDocument();
        doc.pipe(res);
        doc.fontSize(20).text('Dikgang tsa Sol Plaatjie - Ad Analytics Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Ad ID: ${ad.id}`);
        doc.text(`Business Name: ${ad.business_name}`);
        doc.text(`Ad Title: ${ad.title}`);
        doc.text(`Total Views: ${ad.views}`);
        doc.text(`Total Clicks: ${ad.clicks}`);
        doc.text(`Status: ${ad.status}`);
        doc.text(`Generated on: ${new Date().toLocaleString()}`);
        doc.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie Server running on port ${PORT}`);
});