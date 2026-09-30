const express = require('express');
const pool = require('../db');

const router = express.Router();
const db = pool.promise();
const num = (v) => Number(v) || 0;

// Admin web: claim one payslip (saves a snapshot of the computed payroll)
router.post('/claim', async (req, res) => {
    const { employeeId, period, row, breakdown } = req.body || {};
    if (!employeeId || !period?.id || !row) {
        return res.status(400).json({ error: 'employeeId, period and row are required' });
    }
    try {
        const [emps] = await db.query('SELECT id, name, dept FROM employees WHERE id = ?', [employeeId]);
        if (emps.length === 0) return res.status(404).json({ error: 'Employee not found' });
        const emp = emps[0];

        const [result] = await db.query('INSERT INTO payslips SET ?', {
            employee_id: emp.id,
            employee_name: emp.name,
            department: emp.dept,
            period_id: period.id,
            period_label: period.label,
            period_start: period.start,
            period_end: period.end,
            salary_type: row.salaryType || 'cutoff',
            days_present: num(row.presentDays),
            basic_pay: num(row.basicPay),
            premium_pay: num(row.premiumPay),
            overtime_pay: num(row.overtimePay),
            allowance: num(row.allowance),
            gross_pay: num(row.grossPeriod),
            sss: num(row.sss?.ee),
            philhealth: num(row.philhealth?.ee),
            pagibig: num(row.pagibig?.ee),
            withholding_tax: num(row.periodTax),
            cash_advance: num(row.cashAdvance),
            total_deductions: num(row.totalDeductions),
            net_pay: num(row.netPay),
            details: JSON.stringify({ row, breakdown: breakdown || [] }),
        });

        const [saved] = await db.query('SELECT id, claimed_at FROM payslips WHERE id = ?', [result.insertId]);
        return res.status(201).json(saved[0]);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            const [existing] = await db.query(
                'SELECT id, claimed_at FROM payslips WHERE employee_id = ? AND period_id = ?',
                [employeeId, period.id]
            );
            return res.status(409).json({ error: 'Already claimed', ...existing[0] });
        }
        console.error('claim payslip failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to save payslip' });
    }
});

// Admin web: which employees are already claimed for a period
router.get('/', async (req, res) => {
    const { period_id } = req.query;
    if (!period_id) return res.status(400).json({ error: 'period_id is required' });
    try {
        const [rows] = await db.query(
            'SELECT id, employee_id, claimed_at FROM payslips WHERE period_id = ?',
            [period_id]
        );
        return res.json(rows);
    } catch (err) {
        console.error(err.code, err.message);
        return res.status(500).json({ error: 'Failed to load claims' });
    }
});

// Flutter: list of an employee's payslips (newest first, no heavy details)
router.get('/employee/:employeeId', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, employee_id, employee_name, department, period_id, period_label,
                    period_start, period_end, salary_type, days_present, basic_pay, premium_pay,
                    overtime_pay, allowance, gross_pay, sss, philhealth, pagibig, withholding_tax,
                    cash_advance, total_deductions, net_pay, claimed_at
             FROM payslips WHERE employee_id = ? ORDER BY period_start DESC, id DESC`,
            [req.params.employeeId]
        );
        return res.json(rows);
    } catch (err) {
        console.error(err.code, err.message);
        return res.status(500).json({ error: 'Failed to load payslips' });
    }
});

// Flutter: one payslip with the full breakdown ("how it's computed")
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM payslips WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json(rows[0]);
    } catch (err) {
        console.error(err.code, err.message);
        return res.status(500).json({ error: 'Failed to load payslip' });
    }
});

module.exports = router;