const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

// GET all accounts (never send password back to the frontend)
router.get('/accounts', (req, res) => {
    const sql = "SELECT id, name, email, created_at FROM accounts ORDER BY created_at DESC";
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(data);
    });
});

// CREATE a new account
router.post('/accounts', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO accounts (name, email, password) VALUES (?, ?, ?)";
        db.query(sql, [name, email, hashedPassword], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: "An account with that email already exists." });
                }
                return res.status(500).json({ error: err.message });
            }
            return res.status(201).json({
                id: result.insertId,
                name,
                email
            });
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE an account
router.delete('/accounts/:id', (req, res) => {
    const sql = "DELETE FROM accounts WHERE id = ?";
    db.query(sql, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ message: "Account deleted." });
    });
});

// LOGIN - verify email + password against the hashed password in the database
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const sql = "SELECT * FROM accounts WHERE email = ?";
    db.query(sql, [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const account = results[0];
        const match = await bcrypt.compare(password, account.password);

        if (!match) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        return res.json({
            message: "Login successful",
            user: { id: account.id, name: account.name, email: account.email }
        });
    });
});

module.exports = router;