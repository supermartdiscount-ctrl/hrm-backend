const express = require('express');
const db = require('../db').promise();   // same as routes/cashAdvance.js
const router = express.Router();

const num = (v) => Number(v) || 0;

// Columns for list views (no heavy `details` JSON). Dates are returned as plain YYYY-MM-DD.
const LIST_COLS = `
  id, employee_id, employee_name, department, period_id, period_label,
  DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start,
  DATE_FORMAT(period_end,   '%Y-%m-%d') AS period_end,
  salary_type, days_present, basic_pay, premium_pay, overtime_pay, allowance,
  gross_pay, sss, philhealth, pagibig, withholding_tax, cash_advance,
  total_deductions, net_pay, claimed_at`;

// GET /api/payslips/periods -> saved pay periods (newest first) for the Payslips page dropdown
router.get('/periods', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT period_id, period_label,
                    DATE_FORMAT(MIN(period_start), '%Y-%m-%d') AS period_start,
                    DATE_FORMAT(MAX(period_end),   '%Y-%m-%d') AS period_end,
                    COUNT(*) AS employees,
                    SUM(net_pay) AS total_net
             FROM payslips
             GROUP BY period_id, period_label
             ORDER BY MIN(period_start) DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error('list periods failed:', err.message);
        res.status(500).json({ error: 'Failed to load pay periods' });
    }
});

// GET /api/payslips/period/:periodId -> every claimed payslip in one period
router.get('/period/:periodId', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ${LIST_COLS} FROM payslips WHERE period_id = ? ORDER BY employee_name ASC`,
            [req.params.periodId]
        );
        res.json(rows);
    } catch (err) {
        console.error('list period payslips failed:', err.message);
        res.status(500).json({ error: 'Failed to load payslips' });
    }
});

// GET /api/payslips?period_id=...   -> used by Payroll for the "Claimed" badges
// GET /api/payslips?employeeId=...  -> one employee's payslips (mobile app)
// GET /api/payslips                 -> everything, newest first
router.get('/', async (req, res) => {
    try {
        const { period_id, employeeId } = req.query;
        const where = [];
        const params = [];
        if (period_id) { where.push('period_id = ?'); params.push(period_id); }
        if (employeeId) { where.push('employee_id = ?'); params.push(employeeId); }

        const [rows] = await db.query(
            `SELECT ${LIST_COLS} FROM payslips
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY period_start DESC, employee_name ASC`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error('list payslips failed:', err.message);
        res.status(500).json({ error: 'Failed to load payslips' });
    }
});

// Admin web: claim one payslip (saves a snapshot of the computed payroll)
// and records each automatic cash advance installment taken in it.
router.post('/claim', async (req, res) => {
    const { employeeId, period, row, breakdown, cashAdvances } = req.body || {};
    if (!employeeId || !period?.id || !row) {
        return res.status(400).json({ error: 'employeeId, period and row are required' });
    }

    const conn = await db.getConnection();
    try {
        const [emps] = await conn.query('SELECT id, name, dept FROM employees WHERE id = ?', [employeeId]);
        if (emps.length === 0) return res.status(404).json({ error: 'Employee not found' });
        const emp = emps[0];

        await conn.beginTransaction();

        const [result] = await conn.query('INSERT INTO payslips SET ?', {
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

        for (const c of Array.isArray(cashAdvances) ? cashAdvances : []) {
            if (!c || !c.id || !(num(c.amount) > 0)) continue;

            const [adv] = await conn.query(
                "SELECT id FROM cash_advance_requests WHERE id = ? AND employee_id = ? AND status = 'Approved'",
                [c.id, emp.id]
            );
            if (!adv.length) continue;

            await conn.query(
                `INSERT IGNORE INTO cash_advance_payments (advance_id, period_id, payslip_id, amount)
                 VALUES (?, ?, ?, ?)`,
                [c.id, period.id, result.insertId, num(c.amount)]
            );
        }

        await conn.commit();

        const [saved] = await conn.query('SELECT id, claimed_at FROM payslips WHERE id = ?', [result.insertId]);
        return res.status(201).json(saved[0]);
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err.code === 'ER_DUP_ENTRY') {
            const [existing] = await db.query(
                'SELECT id, claimed_at FROM payslips WHERE employee_id = ? AND period_id = ?',
                [employeeId, period.id]
            );
            return res.status(409).json({ error: 'Already claimed', ...existing[0] });
        }
        console.error('claim payslip failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to save payslip' });
    } finally {
        conn.release();
    }
});

// GET /api/payslips/:id -> one payslip with its saved breakdown (must stay LAST among GETs)
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ${LIST_COLS}, details FROM payslips WHERE id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Payslip not found' });
        const p = rows[0];
        if (typeof p.details === 'string') {
            try { p.details = JSON.parse(p.details); } catch { /* leave as text */ }
        }
        res.json(p);
    } catch (err) {
        console.error('get payslip failed:', err.message);
        res.status(500).json({ error: 'Failed to load payslip' });
    }
});

// GET /api/payslips/employee/:employeeId -> all claimed payslips of one employee, newest first (mobile app)
router.get('/employee/:employeeId', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ${LIST_COLS} FROM payslips
             WHERE employee_id = ?
             ORDER BY period_start DESC, claimed_at DESC`,
            [req.params.employeeId]
        );
        res.json(rows);
    } catch (err) {
        console.error('list employee payslips failed:', err.message);
        res.status(500).json({ error: 'Failed to load payslips' });
    }
});

module.exports = router;