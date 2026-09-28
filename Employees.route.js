// npm i bcrypt   (Node 18+ para sa built-in fetch)
//
// Run muna sa MySQL:
//   ALTER TABLE employees
//     ADD COLUMN email VARCHAR(255) NULL,
//     ADD COLUMN rateType VARCHAR(10) NOT NULL DEFAULT 'Monthly',
//     ADD COLUMN password_hash VARCHAR(255) NULL;
//
// Backend env vars: BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();

const escapeHtml = (s = '') =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Nagbabalik ng { ok, error? } para makita ang eksaktong dahilan kung pumalpak
async function sendCredentials({ email, name, id, password }) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || 'Chivalry Real Estate Development';

    if (!apiKey || !senderEmail) {
        const error = 'Missing BREVO_API_KEY or BREVO_SENDER_EMAIL env var on the backend.';
        console.error(error);
        return { ok: false, error };
    }

    try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({
                sender: { name: senderName, email: senderEmail }, // dapat verified sa Brevo
                to: [{ email, name }],
                subject: 'Your employee account',
                htmlContent: `
                    <p>Hi ${escapeHtml(name)},</p>
                    <p>Your employee account has been created.</p>
                    <p><b>Employee number:</b> ${escapeHtml(id)}<br/>
                       <b>Password:</b> ${escapeHtml(password)}</p>
                    <p>Please change your password after your first login.</p>`,
            }),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error('Brevo error:', res.status, body);
            return { ok: false, error: `Brevo ${res.status}: ${body}` };
        }
        return { ok: true };
    } catch (err) {
        console.error('Brevo fetch failed:', err);
        return { ok: false, error: String(err) };
    }
}

// GET all employees (hindi kasama ang password_hash)
router.get('/employees', (req, res) => {
    const sql = "SELECT * FROM employees ORDER BY created_at DESC";
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        const safe = data.map(({ password_hash, ...rest }) => rest);
        return res.json(safe);
    });
});

// CREATE a new employee
router.post('/employees', async (req, res) => {
    const {
        id, name, email, password, dept, position, hired, status, rate, rateType, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin
    } = req.body;

    if (!id || !name) {
        return res.status(400).json({ error: "Employee ID and name are required." });
    }
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    let passwordHash;
    try {
        passwordHash = await bcrypt.hash(password, 10);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Server error while saving employee." });
    }

    const sql = `INSERT INTO employees
        (id, name, email, password_hash, dept, position, hired, status, rate, rateType, salaryType, payday,
         birth, civil, contact, address, sss, philhealth, pagibig, tin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // payday only matters when salaryType is 'monthly'; default to '2'
    const values = [
        id, name, email, passwordHash, dept || null, position || null, hired || null, status || null,
        rate || 0, rateType || 'Monthly', salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null
    ];

    db.query(sql, values, async (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: "An employee with that ID already exists." });
            }
            return res.status(500).json({ error: err.message });
        }

        // Naka-save na sa DB. Hindi mag-fail ang request kahit pumalpak ang email.
        const result = await sendCredentials({ email, name, id, password });

        // Huwag ibalik ang password
        const { password: _pw, ...safe } = req.body;
        return res.status(201).json({
            ...safe,
            emailSent: result.ok,
            emailError: result.ok ? undefined : result.error,
        });
    });
});

// UPDATE an existing employee (hindi ginagalaw ang password)
router.put('/employees/:id', (req, res) => {
    const {
        name, email, dept, position, hired, status, rate, rateType, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin
    } = req.body;

    const sql = `UPDATE employees SET
        name = ?, email = ?, dept = ?, position = ?, hired = ?, status = ?, rate = ?, rateType = ?,
        salaryType = ?, payday = ?, birth = ?, civil = ?, contact = ?, address = ?,
        sss = ?, philhealth = ?, pagibig = ?, tin = ?
        WHERE id = ?`;

    const values = [
        name, email || null, dept || null, position || null, hired || null, status || null,
        rate || 0, rateType || 'Monthly', salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null, req.params.id
    ];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        const { password, passwordHash, ...safe } = req.body;
        return res.json({ id: req.params.id, ...safe });
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