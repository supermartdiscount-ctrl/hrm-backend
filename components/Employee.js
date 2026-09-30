// routes/employees.js
// npm install bcryptjs
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

// Columns safe to send to clients (never includes password_hash).
const PUBLIC_COLUMNS = `id, name, dept, position, hired, status, rate, salaryType, payday,
    birth, civil, contact, address, sss, philhealth, pagibig, tin, created_at`;

const MIN_PASSWORD = 6;

// ---------------------------------------------------------------------------
// One-time migration: add employees.password_hash if it doesn't exist yet.
// Safe to run on every start: if the column exists, MySQL says ER_DUP_FIELDNAME.
// ---------------------------------------------------------------------------
db.query("ALTER TABLE employees ADD COLUMN password_hash VARCHAR(255) NULL", (err) => {
    if (!err) {
        console.log('Added employees.password_hash column.');
    } else if (err.code !== 'ER_DUP_FIELDNAME') {
        console.error('password_hash migration failed:', err);
    }
});

// Remove secrets before echoing a request body back to the client.
function stripSecrets(body) {
    const { password, password_hash, ...safe } = body || {};
    return safe;
}

// ---------------------------------------------------------------------------
// EMPLOYEE APP LOGIN (used by the Flutter employee portal)
// POST /employee-login  { id, password }  ->  { employee: {...} }
// ---------------------------------------------------------------------------
router.post('/employee-login', (req, res) => {
    const id = String((req.body && req.body.id) || '').trim();
    const password = String((req.body && req.body.password) || '');

    if (!id || !password) {
        return res.status(400).json({ error: "Employee ID and password are required." });
    }

    // Profile fields shown on the app's Account page (password_hash is stripped below).
    const sql = `SELECT id, name, dept, position, status, hired, birth, civil, contact,
                        address, sss, philhealth, pagibig, tin, salaryType, password_hash
                 FROM employees WHERE id = ? LIMIT 1`;

    db.query(sql, [id], async (err, rows) => {
        if (err) {
            console.error('employee-login DB error:', err);
            return res.status(500).json({ error: "Server error. Please try again." });
        }

        // Same message for "no such ID" and "wrong password" so IDs can't be guessed.
        const invalid = () => res.status(401).json({ error: "Invalid employee ID or password." });

        if (rows.length === 0) return invalid();

        const emp = rows[0];
        if (!emp.password_hash) {
            return res.status(403).json({ error: "No password set for this account. Please contact HR." });
        }

        const ok = await bcrypt.compare(password, emp.password_hash);
        if (!ok) return invalid();

        const { password_hash, ...employee } = emp;
        return res.json({ employee });
    });
});

// Admin sets or resets an employee's password.
// PUT /employees/:id/password  { password }
router.put('/employees/:id/password', async (req, res) => {
    const password = String((req.body && req.body.password) || '');
    if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    const hash = await bcrypt.hash(password, 10);
    db.query("UPDATE employees SET password_hash = ? WHERE id = ?", [hash, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        return res.json({ message: "Password updated." });
    });
});

// ---------------------------------------------------------------------------
// ADMIN WEBSITE: employee CRUD
// ---------------------------------------------------------------------------

// GET all employees
router.get('/employees', (req, res) => {
    const sql = `SELECT ${PUBLIC_COLUMNS} FROM employees ORDER BY created_at DESC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(data);
    });
});

// CREATE a new employee (the form's password is hashed and stored as password_hash)
router.post('/employees', async (req, res) => {
    const {
        id, name, dept, position, hired, status, rate, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin, password
    } = req.body;

    if (!id || !name) {
        return res.status(400).json({ error: "Employee ID and name are required." });
    }

    let passwordHash = null;
    if (password) {
        if (String(password).length < MIN_PASSWORD) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
        }
        passwordHash = await bcrypt.hash(String(password), 10);
    }

    const sql = `INSERT INTO employees
        (id, name, dept, position, hired, status, rate, salaryType, payday, birth, civil, contact, address, sss, philhealth, pagibig, tin, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // payday only matters when salaryType is 'monthly'; default to '2'
    // (2nd half of the month) so existing/blank rows behave predictably.
    const values = [
        id, name, dept || null, position || null, hired || null, status || null,
        rate || 0, salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null, passwordHash
    ];

    db.query(sql, values, (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: "An employee with that ID already exists." });
            }
            return res.status(500).json({ error: err.message });
        }
        return res.status(201).json(stripSecrets(req.body));
    });
});

// UPDATE an existing employee (a blank password keeps the current one)
router.put('/employees/:id', async (req, res) => {
    const {
        name, dept, position, hired, status, rate, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin, password
    } = req.body;

    let passwordHash = null;
    if (password) {
        if (String(password).length < MIN_PASSWORD) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
        }
        passwordHash = await bcrypt.hash(String(password), 10);
    }

    // COALESCE(?, password_hash): only overwrite when a new password was provided.
    const sql = `UPDATE employees SET
        name = ?, dept = ?, position = ?, hired = ?, status = ?, rate = ?, salaryType = ?, payday = ?,
        birth = ?, civil = ?, contact = ?, address = ?, sss = ?, philhealth = ?, pagibig = ?, tin = ?,
        password_hash = COALESCE(?, password_hash)
        WHERE id = ?`;

    const values = [
        name, dept || null, position || null, hired || null, status || null,
        rate || 0, salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null, passwordHash, req.params.id
    ];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        return res.json({ id: req.params.id, ...stripSecrets(req.body) });
    });
});

// DELETE an employee
router.delete('/employees/:id', (req, res) => {
    const sql = "DELETE FROM employees WHERE id = ?";
    db.query(sql, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ message: "Employee deleted." });
    });
});

module.exports = router;