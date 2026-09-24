const express = require('express');
const db = require('../db');

const router = express.Router();

// GET all employees
router.get('/employees', (req, res) => {
    const sql = "SELECT * FROM employees ORDER BY created_at DESC";
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(data);
    });
});

// CREATE a new employee
router.post('/employees', (req, res) => {
    const {
        id, name, dept, position, hired, status, rate, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin
    } = req.body;

    if (!id || !name) {
        return res.status(400).json({ error: "Employee ID and name are required." });
    }

    const sql = `INSERT INTO employees
        (id, name, dept, position, hired, status, rate, salaryType, payday, birth, civil, contact, address, sss, philhealth, pagibig, tin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // payday only matters when salaryType is 'monthly'; default to '2'
    // (2nd half of the month) so existing/blank rows behave predictably.
    const values = [
        id, name, dept || null, position || null, hired || null, status || null,
        rate || 0, salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null
    ];

    db.query(sql, values, (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: "An employee with that ID already exists." });
            }
            return res.status(500).json({ error: err.message });
        }
        return res.status(201).json(req.body);
    });
});

// UPDATE an existing employee
router.put('/employees/:id', (req, res) => {
    const {
        name, dept, position, hired, status, rate, salaryType, payday,
        birth, civil, contact, address, sss, philhealth, pagibig, tin
    } = req.body;

    const sql = `UPDATE employees SET
        name = ?, dept = ?, position = ?, hired = ?, status = ?, rate = ?, salaryType = ?, payday = ?,
        birth = ?, civil = ?, contact = ?, address = ?, sss = ?, philhealth = ?, pagibig = ?, tin = ?
        WHERE id = ?`;

    const values = [
        name, dept || null, position || null, hired || null, status || null,
        rate || 0, salaryType || 'cutoff', payday || '2', birth || null, civil || null,
        contact || null, address || null, sss || null, philhealth || null,
        pagibig || null, tin || null, req.params.id
    ];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        return res.json({ id: req.params.id, ...req.body });
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