const express = require('express');
const db = require('../db').promise();   // same as routes/cashAdvance.js
const router = express.Router();

const num = (v) => Number(v) || 0;

// Admin web: claim one payslip (saves a snapshot of the computed payroll)
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

// KEEP your other existing routes here (e.g. GET '/' for ?period_id=..., and the ones the mobile app uses).

module.exports = router;