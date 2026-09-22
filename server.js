require('dotenv').config();
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
  host: process.env.DB_HOST || 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER || '46EdNwRpTQ544FS.root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bongi_trade',
  ssl: { rejectUnauthorized: false }
};

let pool;
async function initializeDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('Connected to TiDB successfully.');

    // Secure Admin Initialization (Ensures a strong hashed password if none exists)
    const [adminCheck] = await pool.query('SELECT * FROM users WHERE role = ?', ['admin']);
    if (adminCheck.length === 0) {
      // Generates a secure salt and hash. Change this default password immediately upon deployment.
      const defaultHash = await bcrypt.hash('SolPlaatjieAdmin#2026!', 10);
      await pool.query(
        'INSERT INTO users (username, password, role, status, full_name, email) VALUES (?, ?, ?, ?, ?, ?)',
        ['admin', defaultHash, 'admin', 'approved', 'System Administrator', 'admin@dikgang.co.za']
      );
      console.log('Secure admin account initialized.');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initializeDatabase();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dikgang_sol_plaatjie_secure_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// Auth Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.role === 'journalist' && user.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    }

    req.session.user = user;
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role, full_name, email, whatsapp, address } = req.body;
  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const status = (role === 'journalist') ? 'pending' : 'approved';
    await pool.query(
      'INSERT INTO users (username, password, role, status, full_name, email, whatsapp, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPass, role, status, full_name, email, whatsapp, address]
    );
    res.json({ success: true, message: 'Registration successful. ' + (status === 'pending' ? 'Pending admin approval.' : '') });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed or username/email already exists.' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get Session
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

// Admin Delete Article Route
app.delete('/api/articles/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized. Admin access required.' });
  }
  try {
    await pool.query('DELETE FROM articles WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Article deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ads API
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
    res.json({ success: true, ad_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Data API
app.get('/api/admin/data', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const [users] = await pool.query('SELECT id, username, role, status, full_name, email, whatsapp, address, created_at FROM users');
    const [ads] = await pool.query('SELECT * FROM ads');
    const [referrals] = await pool.query('SELECT * FROM referrals');
    const [journalists] = await pool.query('SELECT * FROM users WHERE role = "journalist"');
    const [articles] = await pool.query('SELECT id, title, slug, category, views, created_at FROM articles ORDER BY created_at DESC');
    res.json({ users, ads, referrals, journalists, articles });
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
  console.log(`Server running on port ${PORT}`);
});