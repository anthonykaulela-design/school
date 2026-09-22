const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// TiDB / MySQL Database Configuration
const dbConfig = {
  host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '46EdNwRpTQ544FS.root',
  password: 'yyp96nFLBPM9exvt',
  database: 'bongi_trade',
  ssl: { rejectUnauthorized: false }
};

let pool;

async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('Connected to TiDB / MySQL database successfully.');

    // Create Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'journalist', 'advertiser', 'referrer', 'reader') DEFAULT 'reader',
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        full_name VARCHAR(255),
        email VARCHAR(255),
        whatsapp VARCHAR(50),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        journalist_id INT,
        journalist_name VARCHAR(255),
        image_url TEXT,
        image_source VARCHAR(255),
        video_embed TEXT,
        status ENUM('pending', 'published') DEFAULT 'pending',
        views INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (journalist_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        article_id INT,
        username VARCHAR(255) NOT NULL,
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
        ad_id VARCHAR(50) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        type ENUM('banner', 'interstitial', 'video') NOT NULL,
        link_url TEXT NOT NULL,
        media_url TEXT NOT NULL,
        creator_id INT,
        business_name VARCHAR(255),
        email VARCHAR(255),
        whatsapp VARCHAR(50),
        address TEXT,
        payment_proof_url TEXT,
        status ENUM('pending', 'active') DEFAULT 'pending',
        views INT DEFAULT 0,
        clicks INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS referrers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        whatsapp VARCHAR(50) NOT NULL,
        residential_address TEXT NOT NULL,
        views_generated INT DEFAULT 0,
        earnings DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure default admin exists
    const [adminCheck] = await connection.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.length === 0) {
      await connection.query(
        "INSERT INTO users (username, password, role, status, full_name, email) VALUES (?, ?, 'admin', 'approved', 'System Administrator', 'admin@dikgangsolplaatjie.co.za')",
        ['admin', 'admin']
      );
      console.log('Default admin created: username: admin, password: admin');
    }

    connection.release();
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDB();

// News Categories
const CATEGORIES = [
  'Politics', 'Local News', 'Business', 'Sport', 'Entertainment', 
  'Opinion', 'Lifestyle', 'Technology', 'Education', 'Crime & Courts'
];

// --- API ENDPOINTS ---

// Auth: Login / Register
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = rows[0];
    if (user.role === 'journalist' && user.status !== 'approved') {
      return res.status(403).json({ error: 'Your journalist account is pending admin approval.' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role, full_name, email, whatsapp, address } = req.body;
    const status = (role === 'journalist') ? 'pending' : 'approved';
    const [result] = await pool.query(
      "INSERT INTO users (username, password, role, status, full_name, email, whatsapp, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [username, password, role, status, full_name, email, whatsapp, address]
    );
    res.json({ success: true, message: 'Registration successful. ' + (status === 'pending' ? 'Pending admin approval.' : '') });
  } catch (err) {
    res.status(500).json({ error: 'Username already exists or invalid data.' });
  }
});

// Admin Dashboard Data
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const [users] = await pool.query("SELECT id, username, role, status, full_name, email, whatsapp, created_at FROM users");
    const [articles] = await pool.query("SELECT a.*, u.username as journalist_username FROM articles a LEFT JOIN users u ON a.journalist_id = u.id ORDER BY a.created_at DESC");
    const [ads] = await pool.query("SELECT * FROM ads ORDER BY created_at DESC");
    const [referrers] = await pool.query("SELECT * FROM referrers ORDER BY created_at DESC");
    
    // Explicit filtered lists for convenience
    const pendingJournalists = users.filter(u => u.role === 'journalist' && u.status === 'pending');
    const approvedJournalists = users.filter(u => u.role === 'journalist' && u.status === 'approved');

    res.json({ users, pendingJournalists, approvedJournalists, articles, ads, referrers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Journalist Endpoints
app.get('/api/admin/journalists/pending', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, username, full_name, email, whatsapp, address, created_at FROM users WHERE role = 'journalist' AND status = 'pending'");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/journalists/approved', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, username, full_name, email, whatsapp, address, created_at FROM users WHERE role = 'journalist' AND status = 'approved'");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Approve / Reject Journalist
app.post('/api/admin/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    await pool.query("UPDATE users SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ success: true, message: `Journalist status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Articles Management
app.get('/api/articles', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = "SELECT * FROM articles WHERE status = 'published'";
    let params = [];
    if (category) {
      query += " AND category = ?";
      params.push(category);
    }
    if (search) {
      query += " AND (title LIKE ? OR content LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY created_at DESC";
    const [articles] = await pool.query(query, params);
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM articles WHERE slug = ?", [req.params.slug]);
    if (rows.length === 0) return res.status(404).json({ error: 'Article not found' });
    const article = rows[0];
    
    // Increment views
    await pool.query("UPDATE articles SET views = views + 1 WHERE id = ?", [article.id]);
    
    // Get comments
    const [comments] = await pool.query("SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC", [article.id]);
    
    res.json({ article, comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', async (req, res) => {
  try {
    const { title, content, category, journalist_id, journalist_name, image_url, image_source, video_embed } = req.body;
    const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;
    
    await pool.query(
      "INSERT INTO articles (title, slug, content, category, journalist_id, journalist_name, image_url, image_source, video_embed, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      [title, slug, content, category, journalist_id, journalist_name, image_url, image_source, video_embed]
    );
    res.json({ success: true, message: 'Article submitted successfully and pending admin publication.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/articles/:id/publish', async (req, res) => {
  try {
    await pool.query("UPDATE articles SET status = 'published' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comments
app.post('/api/articles/:id/comments', async (req, res) => {
  try {
    const { username, email, whatsapp, comment } = req.body;
    await pool.query(
      "INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, username, email, whatsapp, comment]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ads Management & Monetization
app.get('/api/ads', async (req, res) => {
  try {
    const [ads] = await pool.query("SELECT * FROM ads WHERE status = 'active'");
    res.json(ads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ads', async (req, res) => {
  try {
    const { title, type, link_url, media_url, creator_id, business_name, email, whatsapp, address, payment_proof_url } = req.body;
    const ad_id = 'AD-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    
    await pool.query(
      "INSERT INTO ads (ad_id, title, type, link_url, media_url, creator_id, business_name, email, whatsapp, address, payment_proof_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      [ad_id, title, type, link_url, media_url, creator_id, business_name, email, whatsapp, address, payment_proof_url]
    );
    res.json({ 
      success: true, 
      ad_id,
      notification: 'Notice: Clients are charged R3 per 100 views. 50% of ad revenue is retained by Dikgang tsa Sol Plaatjie.' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/ads/:id/activate', async (req, res) => {
  try {
    await pool.query("UPDATE ads SET status = 'active' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ads/:id/track', async (req, res) => {
  try {
    const { action } = req.body; 
    if (action === 'view') {
      await pool.query("UPDATE ads SET views = views + 1 WHERE id = ?", [req.params.id]);
    } else if (action === 'click') {
      await pool.query("UPDATE ads SET clicks = clicks + 1 WHERE id = ?", [req.params.id]);
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
    await pool.query(
      "INSERT INTO referrers (name, email, whatsapp, residential_address) VALUES (?, ?, ?, ?)",
      [name, email, whatsapp, residential_address]
    );
    res.json({ 
      success: true, 
      notification: 'Successfully subscribed to Share & Earn! You will earn R0.2 per 100 views generated by your shared links.' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

// Serve Frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dikgang tsa Sol Plaatjie server running on port ${PORT}`);
});