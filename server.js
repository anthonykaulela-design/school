const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- In-Memory Database / Seed Data ---
let categories = [
    'Politics',
    'Local News',
    'Business',
    'Sport',
    'Entertainment',
    'Opinion',
    'Technology',
    'Education',
    'Crime & Courts',
    'Municipal Governance'
];

let users = [
    {
        id: 1,
        username: 'admin',
        password: 'admin',
        full_name: 'System Administrator',
        email: 'admin@solplaatjie.news',
        whatsapp: '+27821234567',
        address: 'Municipal Building, Kimberley',
        role: 'admin',
        status: 'approved'
    },
    {
        id: 2,
        username: 'journalist1',
        password: 'password123',
        full_name: 'Tebogo Mokoena',
        email: 'tebogo@solplaatjie.news',
        whatsapp: '+27839876543',
        address: 'Galeshewe, Kimberley',
        role: 'journalist',
        status: 'approved'
    }
];

let articles = [
    {
        id: 1,
        slug: 'sol-plaatjie-water-pipeline-maintenance-2026',
        title: 'Sol Plaatjie Municipality Announces Major Water Pipeline Maintenance Across Kimberley CBD and Galeshewe',
        category: 'Municipal Governance',
        content: `Sol Plaatjie Local Municipality has announced scheduled emergency water supply interruptions affecting zones 1 through 4 due to main valve replacements near Beaconsfield and the Kimberley CBD.\n\nTechnical services teams will be deployed starting 08:00 to upgrade ageing asbestos-cement pipelines that have contributed to intermittent pressure drops over recent months.\n\nResidents and local businesses are advised to store sufficient water for domestic and commercial use. Water tanker stations will be stationed at Memorial Road Clinic, Galeshewe Circle, and the Civic Centre parking area.`,
        image_url: 'https://images.unsplash.com/photo-1541888946425-d0fbb18f8f3c?auto=format&fit=crop&w=1200&q=80',
        image_source: 'Sol Plaatjie Communications Unit',
        pdf_url: '',
        views: 1420,
        journalist_name: 'Tebogo Mokoena',
        pinned_ad: null,
        created_at: new Date(Date.now() - 86400000 * 1).toISOString()
    },
    {
        id: 2,
        slug: 'electricity-capacity-charges-public-hearings',
        title: 'High Court Rules on Municipal Electricity Tariffs and Public Participation Obligations',
        category: 'Politics',
        content: `In a landmark judgment handed down in the Northern Cape Division of the High Court, the court reinforced municipal statutory obligations under the Promotion of Administrative Justice Act (PAJA) regarding public consultation on electricity capacity charges.\n\nCivic associations and public defenders welcomed the ruling, which mandates that the Sol Plaatjie Local Municipality must provide transparent cost-of-supply studies prior to implementing revised tariff structures.\n\nWritten representations and public comments remain open until 15 October 2026.`,
        image_url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80',
        image_source: 'Northern Cape High Court Archives',
        pdf_url: '',
        views: 980,
        journalist_name: 'System Administrator',
        pinned_ad: null,
        created_at: new Date(Date.now() - 86400000 * 2).toISOString()
    },
    {
        id: 3,
        slug: 'kimberley-diamond-league-youth-development',
        title: 'Kimberley Regional Football Association Launches Youth Sports Development Programme',
        category: 'Sport',
        content: `The Kimberley Regional Football Association, in partnership with local civic stakeholders, has officially launched an ambitious youth sports development initiative aimed at nurturing soccer talent across Galeshewe, Ritchies, and surrounding Northern Cape townships.\n\nThe program provides training equipment, certified coaching clinics, and academic support mentorship for aspiring young athletes.\n\nLocal businesses have pledged financial backing to refurbish community pitches ahead of the provincial summer tournament.`,
        image_url: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80',
        image_source: 'Sports Desk Media',
        pdf_url: '',
        views: 650,
        journalist_name: 'Tebogo Mokoena',
        pinned_ad: null,
        created_at: new Date(Date.now() - 86400000 * 3).toISOString()
    }
];

let comments = [
    {
        id: 1,
        article_id: 1,
        username: 'Sipho Dlamini',
        email: 'sipho@example.com',
        whatsapp: '+27825551234',
        comment: 'Thank you for the update. Will the water tankers be available in Beaconsfield as well?',
        created_at: new Date().toISOString()
    }
];

let ads = [
    {
        id: 1,
        business_name: 'Kimberley Solar & Electrical',
        title: 'Reliable Solar Inverter Installations & Backup Power Solutions',
        type: 'banner',
        link_url: 'https://example.com',
        media_url: 'https://images.unsplash.com/photo-1509391365360-86929bf547a5?auto=format&fit=crop&w=600&q=80',
        payment_proof_url: '',
        email: 'info@kimberleysolar.co.za',
        whatsapp: '+27829998888',
        address: 'Du Toitspan Road, Kimberley',
        status: 'active',
        views: 310,
        clicks: 45
    }
];

let referrers = [
    {
        id: 1,
        name: 'Lerato Kgosana',
        email: 'lerato@example.com',
        whatsapp: '+27834445555',
        residential_address: 'Galeshewe, Kimberley',
        earnings: '12.40'
    }
];

// --- API Routes ---

// 1. Get Categories
app.get('/api/categories', (req, res) => {
    res.json(categories);
});

// 2. Get Articles (with optional search and category filters)
app.get('/api/articles', (req, res) => {
    let results = [...articles];
    const { search, category } = req.query;

    if (search) {
        const query = search.toLowerCase();
        results = results.filter(a => 
            a.title.toLowerCase().includes(query) || 
            a.content.toLowerCase().includes(query)
        );
    }

    if (category && category !== 'Trending') {
        results = results.filter(a => a.category.toLowerCase() === category.toLowerCase());
    }

    // Sort by newest first
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(results);
});

// 3. Get Single Article by Slug (and increment views)
app.get('/api/articles/:slug', (req, res) => {
    const art = articles.find(a => a.slug === req.params.slug);
    if (!art) {
        return res.status(404).json({ error: 'Article not found' });
    }
    art.views = (art.views || 0) + 1;
    const artComments = comments.filter(c => c.article_id === art.id);
    res.json({ article: art, comments: artComments });
});

// 4. Create Article (Admin / Journalist)
app.post('/api/articles', (req, res) => {
    const { title, category, content, image_source, image_url, pdf_url, journalist_name } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const newArt = {
        id: articles.length + 1,
        slug: `${slug}-${Date.now()}`,
        title,
        category: category || 'Local News',
        content,
        image_url: image_url || '',
        image_source: image_source || '',
        pdf_url: pdf_url || '',
        views: 0,
        journalist_name: journalist_name || 'Staff Reporter',
        pinned_ad: null,
        created_at: new Date().toISOString()
    };
    articles.unshift(newArt);
    res.status(201).json({ message: 'Article published successfully', article: newArt });
});

// 5. Pin Ad to Article
app.post('/api/articles/:articleId/pin-ad', (req, res) => {
    const articleId = parseInt(req.params.articleId);
    const { ad_id } = req.body;
    const art = articles.find(a => a.id === articleId);
    const ad = ads.find(ad => ad.id === parseInt(ad_id));

    if (!art) return res.status(404).json({ error: 'Article not found' });
    if (!ad) return res.status(404).json({ error: 'Advertisement not found' });

    art.pinned_ad = ad;
    res.json({ message: 'Ad successfully pinned to article', article: art });
});

// 6. Post Comment on Article
app.post('/api/articles/:articleId/comments', (req, res) => {
    const articleId = parseInt(req.params.articleId);
    const { username, email, whatsapp, comment } = req.body;
    if (!username || !comment) {
        return res.status(400).json({ error: 'Username and comment are required' });
    }
    const newComment = {
        id: comments.length + 1,
        article_id: articleId,
        username,
        email: email || '',
        whatsapp: whatsapp || '',
        comment,
        created_at: new Date().toISOString()
    };
    comments.push(newComment);
    res.status(201).json({ message: 'Comment posted successfully', comment: newComment });
});

// 7. Get Active Ads
app.get('/api/ads', (req, res) => {
    const activeAds = ads.filter(ad => ad.status === 'active');
    res.json(activeAds);
});

// 8. Submit New Ad
app.post('/api/ads', (req, res) => {
    const { business_name, title, type, link_url, media_url, payment_proof_url, email, whatsapp, address } = req.body;
    if (!business_name || !title || !link_url) {
        return res.status(400).json({ error: 'Required fields missing' });
    }
    const newAd = {
        id: ads.length + 1,
        business_name,
        title,
        type: type || 'banner',
        link_url,
        media_url: media_url || '',
        payment_proof_url: payment_proof_url || '',
        email,
        whatsapp,
        address,
        status: 'active', // Auto-approved for testing convenience
        views: 0,
        clicks: 0
    };
    ads.push(newAd);
    res.status(201).json({ message: 'Ad submitted successfully', ad_id: newAd.id });
});

// 9. Track Ad View/Click
app.post('/api/ads/:id/track', (req, res) => {
    const adId = parseInt(req.params.id);
    const { action } = req.body; // 'view' or 'click'
    const ad = ads.find(a => a.id === adId);
    if (ad) {
        if (action === 'click') ad.clicks++;
        else ad.views++;
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Ad not found' });
});

// 10. Referrers / Share & Earn Subscriptions
app.get('/api/referrers', (req, res) => {
    res.json(referrers);
});

app.post('/api/referrers', (req, res) => {
    const { name, email, whatsapp, residential_address } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
    }
    const existing = referrers.find(r => r.email.toLowerCase() === email.toLowerCase());
    if (existing) {
        return res.json({ message: 'Welcome back! You are already subscribed to Share & Earn.', referrer: existing });
    }
    const newRef = {
        id: referrers.length + 1,
        name,
        email,
        whatsapp: whatsapp || '',
        residential_address: residential_address || '',
        earnings: '0.00'
    };
    referrers.push(newRef);
    res.status(201).json({ notification: 'Successfully subscribed to Share & Earn!', referrer: newRef });
});

// 11. Authentication: Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({ message: 'Login successful', user });
});

// 12. Authentication: Register
app.post('/api/auth/register', (req, res) => {
    const { full_name, username, password, email, whatsapp, address, role } = req.body;
    if (!username || !password || !email) {
        return res.status(400).json({ error: 'Mandatory fields missing' });
    }
    const existing = users.find(u => u.username === username || u.email === email);
    if (existing) {
        return res.status(400).json({ error: 'Username or email already registered' });
    }
    const newUser = {
        id: users.length + 1,
        username,
        password,
        full_name: full_name || username,
        email,
        whatsapp: whatsapp || '',
        address: address || '',
        role: role || 'journalist',
        status: 'approved' // Auto-approved for seamless testing
    };
    users.push(newUser);
    res.status(201).json({ message: 'Registration successful! You can now log in.', user: newUser });
});

// 13. Admin Dashboard Data
app.get('/api/admin/dashboard', (req, res) => {
    res.json({
        users,
        articles,
        ads,
        referrers
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Dikgang tsa Sol Plaatjie News Agency API server running on port ${PORT}`);
});