const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();

// Middleware configuration
app.use(cors({
  origin: true, // Allows all frontend origins (or specify your worker/domain URL)
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'dikgang_sol_plaatjie_secure_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if running exclusively over HTTPS in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day session validity
  }
}));

// TiDB Cloud MySQL Database Connection Pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'your_tidb_host_here',
  user: process.env.DB_USER || 'your_tidb_user_here',
  password: process.env.DB_PASSWORD || 'your_tidb_password_here',
  database: process.env.DB_NAME || 'bongi_trade',
  port: process.env.DB_PORT || 4000,
  ssl: {
    rejectUnauthorized: true
  }
});

// ==================== AUTHENTICATION ROUTES ====================

// Register Route with Automatic Root Admin Bootstrap
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, full_name, email, whatsapp, address, role: requestedRole } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Check if username or email already exists
    const [existing] = await db.query(
      'SELECT id FROM `users` WHERE `username` = ? OR `email` = ?', 
      [username, email || '']
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username or email is already registered.' });
    }

    // Check if the database table is empty to bootstrap the initial administrator
    const [rows] = await db.query('SELECT COUNT(*) as count FROM `users`');
    const isFirstUser = rows[0].count === 0;

    const role = isFirstUser ? 'admin' : (requestedRole || 'reader');
    const status = isFirstUser ? 'approved' : 'pending';

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO `users` (`username`, `password`, `role`, `status`, `full_name`, `email`, `whatsapp`, `address`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, role, status, full_name || null, email || null, whatsapp || null, address || null]
    );

    res.json({ 
      success: true, 
      message: isFirstUser 
        ? 'Root administrator account created and approved automatically.' 
        : 'Registration successful. Awaiting administrator approval.' 
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [users] = await db.query('SELECT * FROM `users` WHERE `username` = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = users[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Enforce strict admin approval requirement
    if (user.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is pending administrator approval.' });
    }

    // Establish session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({ 
      success: true, 
      message: 'Logged in successfully.', 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role, 
        full_name: user.full_name 
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Session Status Check
app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ 
      loggedIn: true, 
      user: { 
        id: req.session.userId, 
        username: req.session.username, 
        role: req.session.role 
      } 
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// Logout Route
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out.' });
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out successfully.' });
  });
});

// ==================== ADMIN USER MANAGEMENT ====================

app.get('/api/admin/users', async (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access.' });
    }
    const [users] = await db.query(
      'SELECT id, username, role, status, full_name, email, whatsapp, created_at FROM `users`'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/status', async (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access.' });
    }
    const { status } = req.body; // 'approved', 'rejected', 'pending'
    const userId = req.params.id;

    await db.query('UPDATE `users` SET `status` = ? WHERE `id` = ?', [status, userId]);
    res.json({ success: true, message: `User status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ARTICLES ROUTES ====================

app.get('/api/articles', async (req, res) => {
  try {
    const [articles] = await db.query('SELECT * FROM `articles` ORDER BY `created_at` DESC');
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required to post articles.' });
    }
    const { title, slug, category, content, image_url, image_source, video_embed } = req.body;
    
    await db.query(
      'INSERT INTO `articles` (`title`, `slug`, `category`, `content`, `journalist_id`, `journalist_name`, `image_url`, `image_source`, `video_embed`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, slug, category, content, req.session.userId, req.session.username, image_url || null, image_source || null, video_embed || null]
    );

    res.json({ success: true, message: 'Article published successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can delete articles.' });
    }
    await db.query('DELETE FROM `articles` WHERE `id` = ?', [req.params.id]);
    res.json({ success: true, message: 'Article deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== COMMENTS ROUTES ====================

app.get('/api/articles/:id/comments', async (req, res) => {
  try {
    const [comments] = await db.query(
      'SELECT * FROM `comments` WHERE `article_id` = ? ORDER BY `created_at` DESC', 
      [req.params.id]
    );
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles/:id/comments', async (req, res) => {
  try {
    const { username, email, whatsapp, comment } = req.body;
    await db.query(
      'INSERT INTO `comments` (`article_id`, `username`, `email`, `whatsapp`, `comment`) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, username, email, whatsapp, comment]
    );
    res.json({ success: true, message: 'Comment posted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADS ROUTES ====================

app.get('/api/ads', async (req, res) => {
  try {
    const [ads] = await db.query('SELECT * FROM `ads` WHERE `status` = "active"');
    res.json(ads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ads', async (req, res) => {
  try {
    const { ad_type, title, image_url, target_url, client_name, client_email, client_whatsapp, business_address, proof_of_payment } = req.body;
    await db.query(
      'INSERT INTO `ads` (`ad_type`, `title`, `image_url`, `target_url`, `client_name`, `client_email`, `client_whatsapp`, `business_address`, `proof_of_payment`, `status`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "active")',
      [ad_type, title, image_url, target_url, client_name, client_email, client_whatsapp, business_address, proof_of_payment]
    );
    res.json({ success: true, message: 'Ad campaign submitted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dikgang tsa Sol Plaatjie server running smoothly on port ${PORT}`);
});