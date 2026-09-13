// File Name: server.js
// Description: Comprehensive School Management System Backend for Render deployment using Node.js, Express, CORS, and MySQL/TiDB.

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware Configuration to eliminate CORS issues
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database Connection Pool (Compatible with TiDB Cloud and standard MySQL)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'school_db',
    port: process.env.DB_PORT || 4000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Database Initialization Table Schemas (Excluding Fee Collection and Finance)
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // 1. Students (SIS)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS students (
                id INT AUTO_INCREMENT PRIMARY KEY,
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                phone VARCHAR(50),
                date_of_birth DATE,
                gender VARCHAR(20),
                address TEXT,
                medical_history TEXT,
                grade_level VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Attendance
        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                date DATE NOT NULL,
                status ENUM('Present', 'Absent', 'Late', 'Excused') NOT NULL,
                period VARCHAR(50),
                remarks TEXT,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);

        // 3. Examinations & Gradebooks
        await connection.query(`
            CREATE TABLE IF NOT EXISTS exams (
                id INT AUTO_INCREMENT PRIMARY KEY,
                exam_name VARCHAR(150) NOT NULL,
                subject VARCHAR(100) NOT NULL,
                exam_date DATE,
                max_marks INT NOT NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS grades (
                id INT AUTO_INCREMENT PRIMARY KEY,
                exam_id INT NOT NULL,
                student_id INT NOT NULL,
                marks_obtained INT NOT NULL,
                letter_grade VARCHAR(10),
                comments TEXT,
                FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);

        // 4. Timetable & Scheduling
        await connection.query(`
            CREATE TABLE IF NOT EXISTS timetables (
                id INT AUTO_INCREMENT PRIMARY KEY,
                class_name VARCHAR(50) NOT NULL,
                day_of_week VARCHAR(20) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                subject VARCHAR(100) NOT NULL,
                teacher_name VARCHAR(150) NOT NULL,
                room_number VARCHAR(50) NOT NULL
            )
        `);

        // 5. Admissions & Enrollment
        await connection.query(`
            CREATE TABLE IF NOT EXISTS admissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                applicant_name VARCHAR(150) NOT NULL,
                email VARCHAR(150) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                applied_grade VARCHAR(50) NOT NULL,
                status ENUM('Pending', 'Accepted', 'Rejected') DEFAULT 'Pending',
                documents_url TEXT,
                submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 6. Staff & HR Administration
        await connection.query(`
            CREATE TABLE IF NOT EXISTS staff (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(150) NOT NULL,
                role VARCHAR(100) NOT NULL,
                department VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                phone VARCHAR(50),
                employment_status VARCHAR(50) DEFAULT 'Active'
            )
        `);

        // 7. Library Management (Extended Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS library_books (
                id INT AUTO_INCREMENT PRIMARY KEY,
                book_title VARCHAR(200) NOT NULL,
                author VARCHAR(150) NOT NULL,
                isbn VARCHAR(50) UNIQUE NOT NULL,
                category VARCHAR(100),
                copies_available INT DEFAULT 1
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS library_issues (
                id INT AUTO_INCREMENT PRIMARY KEY,
                book_id INT NOT NULL,
                student_id INT NOT NULL,
                issue_date DATE NOT NULL,
                due_date DATE NOT NULL,
                return_status ENUM('Issued', 'Returned', 'Overdue') DEFAULT 'Issued',
                FOREIGN KEY (book_id) REFERENCES library_books(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);

        // 8. Transport Management (Extended Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS transport_routes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                route_name VARCHAR(100) NOT NULL,
                driver_name VARCHAR(150) NOT NULL,
                bus_number VARCHAR(50) NOT NULL,
                pickup_points TEXT
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS transport_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                route_id INT NOT NULL,
                student_id INT NOT NULL,
                FOREIGN KEY (route_id) REFERENCES transport_routes(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        `);

        // 9. Hostel & Inventory Management (Extended Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS hostel_rooms (
                id INT AUTO_INCREMENT PRIMARY KEY,
                room_number VARCHAR(50) NOT NULL,
                building_name VARCHAR(100) NOT NULL,
                capacity INT NOT NULL,
                current_occupants INT DEFAULT 0
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS inventory_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_name VARCHAR(150) NOT NULL,
                category VARCHAR(100) NOT NULL,
                quantity INT NOT NULL,
                condition_status VARCHAR(50) DEFAULT 'Good'
            )
        `);

        connection.release();
        console.log("Database tables verified/initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}

initializeDatabase();

// ==========================================
// 1. STUDENT INFORMATION SYSTEM (SIS) ROUTES
// ==========================================

app.get('/api/students', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM students');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/students/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/students', async (req, res) => {
    const { first_name, last_name, email, phone, date_of_birth, gender, address, medical_history, grade_level } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, gender, address, medical_history, grade_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, email, phone, date_of_birth, gender, address, medical_history, grade_level]
        );
        res.status(201).json({ id: result.insertId, message: 'Student created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/students/:id', async (req, res) => {
    const { first_name, last_name, email, phone, date_of_birth, gender, address, medical_history, grade_level } = req.body;
    try {
        await pool.query(
            `UPDATE students SET first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, gender=?, address=?, medical_history=?, grade_level=? WHERE id=?`,
            [first_name, last_name, email, phone, date_of_birth, gender, address, medical_history, grade_level, req.params.id]
        );
        res.json({ message: 'Student updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/students/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM students WHERE id = ?', [req.params.id]);
        res.json({ message: 'Student deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. ATTENDANCE MANAGEMENT ROUTES
// ==========================================

app.get('/api/attendance', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT a.*, s.first_name, s.last_name FROM attendance a JOIN students s ON a.student_id = s.id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/attendance', async (req, res) => {
    const { student_id, date, status, period, remarks } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO attendance (student_id, date, status, period, remarks) VALUES (?, ?, ?, ?, ?)`,
            [student_id, date, status, period, remarks]
        );
        res.status(201).json({ id: result.insertId, message: 'Attendance recorded' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/attendance/:id', async (req, res) => {
    const { status, period, remarks } = req.body;
    try {
        await pool.query('UPDATE attendance SET status=?, period=?, remarks=? WHERE id=?', [status, period, remarks, req.params.id]);
        res.json({ message: 'Attendance updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. EXAMINATIONS & GRADEBOOK ROUTES
// ==========================================

app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/exams', async (req, res) => {
    const { exam_name, subject, exam_date, max_marks } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO exams (exam_name, subject, exam_date, max_marks) VALUES (?, ?, ?, ?)', [exam_name, subject, exam_date, max_marks]);
        res.status(201).json({ id: result.insertId, message: 'Exam created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/grades', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT g.*, s.first_name, s.last_name, e.exam_name, e.subject, e.max_marks 
            FROM grades g 
            JOIN students s ON g.student_id = s.id 
            JOIN exams e ON g.exam_id = e.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grades', async (req, res) => {
    const { exam_id, student_id, marks_obtained, letter_grade, comments } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO grades (exam_id, student_id, marks_obtained, letter_grade, comments) VALUES (?, ?, ?, ?, ?)`,
            [exam_id, student_id, marks_obtained, letter_grade, comments]
        );
        res.status(201).json({ id: result.insertId, message: 'Grade saved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. TIMETABLE & SCHEDULING ROUTES
// ==========================================

app.get('/api/timetables', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM timetables');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/timetables', async (req, res) => {
    const { class_name, day_of_week, start_time, end_time, subject, teacher_name, room_number } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO timetables (class_name, day_of_week, start_time, end_time, subject, teacher_name, room_number) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [class_name, day_of_week, start_time, end_time, subject, teacher_name, room_number]
        );
        res.status(201).json({ id: result.insertId, message: 'Timetable entry added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. ADMISSIONS & ENROLLMENT ROUTES
// ==========================================

app.get('/api/admissions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM admissions');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admissions', async (req, res) => {
    const { applicant_name, email, phone, applied_grade, documents_url } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO admissions (applicant_name, email, phone, applied_grade, documents_url) VALUES (?, ?, ?, ?, ?)`,
            [applicant_name, email, phone, applied_grade, documents_url]
        );
        res.status(201).json({ id: result.insertId, message: 'Application submitted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admissions/:id/status', async (req, res) => {
    const { status } = req.body; // Pending, Accepted, Rejected
    try {
        await pool.query('UPDATE admissions SET status=? WHERE id=?', [status, req.params.id]);
        res.json({ message: 'Admission status updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. PORTALS (STUDENT, TEACHER, PARENT) ROUTES
// ==========================================

app.get('/api/portals/student/:id', async (req, res) => {
    const studentId = req.params.id;
    try {
        const [student] = await pool.query('SELECT * FROM students WHERE id = ?', [studentId]);
        if (student.length === 0) return res.status(404).json({ error: 'Student profile not found' });
        
        const [attendance] = await pool.query('SELECT * FROM attendance WHERE student_id = ?', [studentId]);
        const [grades] = await pool.query(`SELECT g.*, e.exam_name, e.subject, e.max_marks FROM grades g JOIN exams e ON g.exam_id = e.id WHERE g.student_id = ?`, [studentId]);
        const [transport] = await pool.query(`SELECT tr.* FROM transport_assignments ta JOIN transport_routes tr ON ta.route_id = tr.id WHERE ta.student_id = ?`, [studentId]);

        res.json({
            profile: student[0],
            attendance,
            grades,
            transport: transport[0] || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 7. STAFF & HR ADMINISTRATION ROUTES
// ==========================================

app.get('/api/staff', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM staff');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/staff', async (req, res) => {
    const { full_name, role, department, email, phone, employment_status } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO staff (full_name, role, department, email, phone, employment_status) VALUES (?, ?, ?, ?, ?, ?)`,
            [full_name, role, department, email, phone, employment_status]
        );
        res.status(201).json({ id: result.insertId, message: 'Staff member added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 8. REPORTING & ANALYTICS ROUTES
// ==========================================

app.get('/api/reports/summary', async (req, res) => {
    try {
        const [[{ totalStudents }]] = await pool.query('SELECT COUNT(*) as totalStudents FROM students');
        const [[{ totalStaff }]] = await pool.query('SELECT COUNT(*) as totalStaff FROM staff');
        const [[{ totalBooks }]] = await pool.query('SELECT COUNT(*) as totalBooks FROM library_books');
        const [[{ pendingAdmissions }]] = await pool.query("SELECT COUNT(*) as pendingAdmissions FROM admissions WHERE status = 'Pending'");

        res.json({
            totalStudents,
            totalStaff,
            totalBooks,
            pendingAdmissions,
            generatedAt: new Date()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9. EXTENDED MODULES: LIBRARY MANAGEMENT
// ==========================================

app.get('/api/library/books', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM library_books');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/library/books', async (req, res) => {
    const { book_title, author, isbn, category, copies_available } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO library_books (book_title, author, isbn, category, copies_available) VALUES (?, ?, ?, ?, ?)', [book_title, author, isbn, category, copies_available]);
        res.status(201).json({ id: result.insertId, message: 'Book added to catalog' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/library/issue', async (req, res) => {
    const { book_id, student_id, issue_date, due_date } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO library_issues (book_id, student_id, issue_date, due_date) VALUES (?, ?, ?, ?)', [book_id, student_id, issue_date, due_date]);
        res.status(201).json({ id: result.insertId, message: 'Book issued successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 10. EXTENDED MODULES: TRANSPORT MANAGEMENT
// ==========================================

app.get('/api/transport/routes', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM transport_routes');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transport/routes', async (req, res) => {
    const { route_name, driver_name, bus_number, pickup_points } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO transport_routes (route_name, driver_name, bus_number, pickup_points) VALUES (?, ?, ?, ?)', [route_name, driver_name, bus_number, pickup_points]);
        res.status(201).json({ id: result.insertId, message: 'Transport route created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 11. EXTENDED MODULES: HOSTEL & INVENTORY
// ==========================================

app.get('/api/hostel/rooms', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM hostel_rooms');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/hostel/rooms', async (req, res) => {
    const { room_number, building_name, capacity } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO hostel_rooms (room_number, building_name, capacity) VALUES (?, ?, ?)', [room_number, building_name, capacity]);
        res.status(201).json({ id: result.insertId, message: 'Hostel room added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM inventory_items');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/inventory', async (req, res) => {
    const { item_name, category, quantity, condition_status } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO inventory_items (item_name, category, quantity, condition_status) VALUES (?, ?, ?, ?)', [item_name, category, quantity, condition_status]);
        res.status(201).json({ id: result.insertId, message: 'Inventory item recorded' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} and ready for Render deployment.`);
});