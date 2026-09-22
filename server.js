const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// TiDB Database Configuration
const dbConfig = {
  host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '46EdNwRpTQ544FS.root',
  password: 'yyp96nFLBPM9exvt',
  database: 'bongi_trade',
  ssl: { rejectUnauthorized: false }
};

let pool;
async function initializeDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('Connected to TiDB successfully.');

    // Create Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'journalist', 'client', 'reader') DEFAULT 'reader',
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        full_name VARCHAR(150),
        email VARCHAR(150),
        whatsapp VARCHAR(50),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        category VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        journalist_id INT,
        journalist_name VARCHAR(150),
        image_url TEXT,
        image_source VARCHAR(255),
        video_embed TEXT,
        views INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (journalist_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ad_type ENUM('banner', 'interstitial', 'video') NOT NULL,
        title VARCHAR(200),
        image_url TEXT,
        target_url TEXT,
        client_name VARCHAR(150),
        client_email VARCHAR(150),
        client_whatsapp VARCHAR(50),
        business_address TEXT,
        proof_of_payment TEXT,
        views INT DEFAULT 0,
        clicks INT DEFAULT 0,
        status ENUM('pending', 'active', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        article_id INT,
        username VARCHAR(100),
        email VARCHAR(150),
        whatsapp VARCHAR(50),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150),
        email VARCHAR(150),
        whatsapp VARCHAR(50),
        address TEXT,
        views INT DEFAULT 0,
        earnings DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed Default Admin Account if not exists
    const [adminCheck] = await pool.query('SELECT * FROM users WHERE username = ?', ['admin']);
    if (adminCheck.length === 0) {
      const hashedPass = await bcrypt.hash('admin', 10);
      await pool.query(
        'INSERT INTO users (username, password, role, status, full_name, email) VALUES (?, ?, ?, ?, ?, ?)',
        ['admin', hashedPass, 'admin', 'approved', 'System Administrator', 'admin@dikgang.co.za']
      );
      console.log('Default admin account created: admin / admin');
    }

  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initializeDatabase();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'dikgang_sol_plaatjie_secret_key',
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// Auth Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password' });

    const user = rows.get ? rows.get(0) : rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    if (user.role === 'journalist' && user.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    }

    req.session.user = user;
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth Register (Journalists & Clients)
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role, full_name, email, whatsapp, address } = req.body;
  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const status = (role === 'journalist') ? 'pending' : 'approved';
    const [result] = await pool.query(
      'INSERT INTO users (username, password, role, status, full_name, email, whatsapp, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPass, role, status, full_name, email, whatsapp, address]
    );
    res.json({ success: true, message: 'Registration successful. ' + (status === 'pending' ? 'Pending admin approval.' : '') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get Current Session
app.get('/api/auth/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

// Articles API
app.get('/api/articles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
    if (rows.length === 0) return res.status(404).json({ error: 'Article not found' });
    await pool.query('UPDATE articles SET views = views + 1 WHERE slug = ?', [req.params.slug]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', async (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'journalist')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { title, category, content, image_url, image_source, video_embed } = req.body;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  try {
    await pool.query(
      'INSERT INTO articles (title, slug, category, content, journalist_id, journalist_name, image_url, image_source, video_embed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, slug, category, content, req.session.user.id, req.session.user.full_name, image_url, image_source, video_embed]
    );
    res.json({ success: true, slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ads API & Analytics
app.get('/api/ads', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ads WHERE status = "active"');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ads', async (req, res) => {
  const { ad_type, title, image_url, target_url, client_name, client_email, client_whatsapp, business_address, proof_of_payment } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO ads (ad_type, title, image_url, target_url, client_name, client_email, client_whatsapp, business_address, proof_of_payment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "active")',
      [ad_type, title, image_url, target_url, client_name, client_email, client_whatsapp, business_address, proof_of_payment]
    );
    res.json({ 
      success: true, 
      ad_id: result.insertId, 
      message: 'Ad submitted successfully. You will be charged R3 per 100 views. 50% revenue share applies.' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track Ad Click
app.post('/api/ads/:id/click', async (req, res) => {
  try {
    await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comments API
app.get('/api/comments/:article_id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC', [req.params.article_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  const { article_id, username, email, whatsapp, comment } = req.body;
  try {
    await pool.query(
      'INSERT INTO comments (article_id, username, email, whatsapp, comment) VALUES (?, ?, ?, ?, ?)',
      [article_id, username, email, whatsapp, comment]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Referrals API
app.post('/api/referrals', async (req, res) => {
  const { name, email, whatsapp, address } = req.body;
  try {
    await pool.query(
      'INSERT INTO referrals (name, email, whatsapp, address) VALUES (?, ?, ?, ?)',
      [name, email, whatsapp, address]
    );
    res.json({ 
      success: true, 
      message: 'Successfully subscribed to the referral program. You will earn R0.2 per 100 views on shared articles!' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Dashboard Data
app.get('/api/admin/data', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const [users] = await pool.query('SELECT id, username, role, status, full_name, email, whatsapp, address, created_at FROM users');
    const [ads] = await pool.query('SELECT * FROM ads');
    const [referrals] = await pool.query('SELECT * FROM referrals');
    const [journalists] = await pool.query('SELECT * FROM users WHERE role = "journalist"');
    res.json({ users, ads, referrals, journalists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/approve-journalist', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { journalist_id, status } = req.body;
  try {
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, journalist_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dikgang tsa Sol Plaatjie server running on port ${PORT}`);
});