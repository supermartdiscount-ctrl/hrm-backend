const express = require('express');
const pool = require('../db').promise();
const router = express.Router();

const CATEGORIES = ['Grocery', 'Produce', 'Meat'];
const REVIEW_STATUSES = ['Approved', 'Rejected'];

const MAX_AMOUNT = 10000; // largest single credit request
const CREDIT_LIMIT = 10000; // most an employee can owe at once (pending + unpaid approved)

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Every credit + how much has been paid back so far.
const PAID_JOIN = `
  SELECT r.*, COALESCE(p.paid_count, 0) AS paid_count, COALESCE(p.paid_amount, 0) AS paid_amount
  FROM credit_requests r
  LEFT JOIN (
    SELECT credit_id, COUNT(*) AS paid_count, SUM(amount) AS paid_amount
    FROM credit_payments GROUP BY credit_id
  ) p ON p.credit_id = r.id`;

// Adds balance / is_paid. "Paid" = Approved and nothing left to pay.
const withBalance = (r) => {
    const amount = Number(r.amount);
    const paidAmount = Number(r.paid_amount);
    const balance = Math.max(0, round2(amount - paidAmount));
    const isPaid = r.status === 'Approved' && balance <= 0;
    return {
        ...r,
        amount,
        paid_count: Number(r.paid_count),
        paid_amount: paidAmount,
        balance,
        is_paid: isPaid,
    };
};

const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

// GET /api/credit                       -> all (admin)
// GET /api/credit?employeeId=EMP-001    -> one employee (mobile)
// Optional: &category=Meat
router.get('/', async (req, res) => {
    try {
        const where = [];
        const params = [];

        if (req.query.employeeId) {
            where.push('r.employee_id = ?');
            params.push(String(req.query.employeeId));
        }
        if (req.query.category && CATEGORIES.includes(req.query.category)) {
            where.push('r.category = ?');
            params.push(req.query.category);
        }

        const sql =
            PAID_JOIN +
            (where.length ? ' WHERE ' + where.join(' AND ') : '') +
            ' ORDER BY r.date_requested DESC, r.id DESC';

        const [rows] = await pool.query(sql, params);
        res.json(rows.map(withBalance));
    } catch (e) {
        console.error('[Credit] list failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to load credit requests' });
    }
});

// GET /api/credit/active?period_id=2026-08-2
// Approved credits that still have a balance. The balance ignores the payroll payment
// of the period being generated, so re-generating payroll never double counts.
// Manual payments (period_id IS NULL) always reduce the balance.
router.get('/active', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT t.id, t.employee_id, t.amount, t.category, t.balance
             FROM (
               SELECT r.id, r.employee_id, r.amount, r.category,
                      r.amount - COALESCE((SELECT SUM(p.amount) FROM credit_payments p
                                           WHERE p.credit_id = r.id
                                             AND (p.period_id IS NULL OR p.period_id <> ?)), 0) AS balance
               FROM credit_requests r
               WHERE r.status = 'Approved'
             ) t
             WHERE t.balance > 0`,
            [req.query.period_id || '']
        );
        res.json(
            rows.map((r) => ({
                id: r.id,
                employee_id: String(r.employee_id),
                amount: Number(r.amount),
                balance: Number(r.balance),
                label: `CR-${r.id} · ${r.category}`,
            }))
        );
    } catch (e) {
        console.error('[Credit] active failed:', e.code, e.message);
        res.status(500).json({
            error: 'Failed to load active credits',
            detail: `${e.code}: ${e.message}`,
        });
    }
});

// GET /api/credit/:id/payments -> payments received so far, oldest first
router.get('/:id/payments', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid credit id' });

        const [rows] = await pool.query(
            `SELECT p.id, p.period_id, p.amount, p.note, p.created_at, s.period_label
             FROM credit_payments p
             LEFT JOIN payslips s ON s.id = p.payslip_id
             WHERE p.credit_id = ?
             ORDER BY p.created_at ASC, p.id ASC`,
            [id]
        );
        res.json(rows.map((r) => ({ ...r, amount: Number(r.amount) })));
    } catch (e) {
        console.error('[Credit] payments failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to load payments' });
    }
});

// POST /api/credit   { employeeId, category, amount, description }
router.post('/', async (req, res) => {
    try {
        const { employeeId, category, amount, description } = req.body || {};
        const amt = round2(amount);

        if (!employeeId) return res.status(400).json({ error: 'Employee required' });
        if (!CATEGORIES.includes(category)) {
            return res.status(400).json({ error: 'Category must be Grocery, Produce or Meat' });
        }
        if (!(amt > 0) || amt > MAX_AMOUNT) {
            return res.status(400).json({ error: `Amount must be between 1 and ${MAX_AMOUNT}` });
        }

        const [emp] = await pool.query('SELECT name, dept FROM employees WHERE id = ?', [employeeId]);
        if (!emp.length) return res.status(404).json({ error: 'Employee not found' });

        // What this employee already owes: pending requests + unpaid part of approved ones.
        const [owed] = await pool.query(
            `SELECT COALESCE(SUM(
                CASE WHEN r.status = 'Pending'  THEN r.amount
                     WHEN r.status = 'Approved' THEN r.amount - COALESCE(p.paid, 0)
                     ELSE 0 END), 0) AS outstanding
             FROM credit_requests r
             LEFT JOIN (
               SELECT credit_id, SUM(amount) AS paid FROM credit_payments GROUP BY credit_id
             ) p ON p.credit_id = r.id
             WHERE r.employee_id = ?`,
            [employeeId]
        );
        const outstanding = Number(owed[0].outstanding);
        if (outstanding + amt > CREDIT_LIMIT) {
            const room = Math.max(0, round2(CREDIT_LIMIT - outstanding));
            return res.status(409).json({
                error: `Credit limit is ${CREDIT_LIMIT}. This employee can still take up to ${room}.`,
            });
        }

        // repayment_months is no longer used; the column default (1) is kept.
        const [result] = await pool.query(
            `INSERT INTO credit_requests
             (employee_id, employee_name, department, category, description, amount)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                employeeId,
                emp[0].name,
                emp[0].dept || null,
                category,
                (description || '').slice(0, 255),
                amt,
            ]
        );

        const [rows] = await pool.query(PAID_JOIN + ' WHERE r.id = ?', [result.insertId]);
        res.status(201).json(withBalance(rows[0]));
    } catch (e) {
        console.error('[Credit] create failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to submit request' });
    }
});

// PATCH /api/credit/:id/status   (admin)  { status: 'Approved' | 'Rejected', remarks? }
router.patch('/:id/status', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid credit id' });

        const { status, remarks } = req.body || {};
        if (!REVIEW_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const [r] = await pool.query(
            `UPDATE credit_requests
             SET status = ?, admin_remarks = ?, reviewed_at = NOW()
             WHERE id = ? AND status = 'Pending'`,
            [status, remarks ? String(remarks).slice(0, 500) : null, id]
        );

        if (!r.affectedRows) return res.status(409).json({ error: 'Request is no longer pending' });
        res.json({ ok: true });
    } catch (e) {
        console.error('[Credit] status failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to update' });
    }
});

// PATCH /api/credit/:id/cancel   (employee, pending only)
router.patch('/:id/cancel', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid credit id' });

        const [r] = await pool.query(
            "UPDATE credit_requests SET status = 'Cancelled' WHERE id = ? AND status = 'Pending'",
            [id]
        );
        if (!r.affectedRows) return res.status(400).json({ error: 'Only pending requests can be cancelled' });
        res.json({ ok: true });
    } catch (e) {
        console.error('[Credit] cancel failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to cancel' });
    }
});

// POST /api/credit/:id/payments   (admin)  { amount, note? }
// Records a manual payment (e.g. cash) against an approved credit. Cannot exceed the balance.
// Payroll deductions are saved by POST /api/payslips/claim instead.
router.post('/:id/payments', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid credit id' });

    const amt = round2((req.body || {}).amount);
    const note = (req.body || {}).note;
    if (!(amt > 0)) return res.status(400).json({ error: 'Payment amount must be greater than 0' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Lock the credit row so two payments can't both slip under the balance.
        const [rows] = await conn.query('SELECT * FROM credit_requests WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) {
            await conn.rollback();
            return res.status(404).json({ error: 'Credit not found' });
        }
        const credit = rows[0];
        if (credit.status !== 'Approved') {
            await conn.rollback();
            return res.status(409).json({ error: 'Payments can only be recorded on approved credit' });
        }

        const [paidRows] = await conn.query(
            'SELECT COALESCE(SUM(amount), 0) AS paid FROM credit_payments WHERE credit_id = ?',
            [id]
        );
        const balance = round2(Number(credit.amount) - Number(paidRows[0].paid));
        if (amt > balance) {
            await conn.rollback();
            return res.status(400).json({ error: `Payment is more than the remaining balance (${balance})` });
        }

        await conn.query('INSERT INTO credit_payments (credit_id, amount, note) VALUES (?, ?, ?)', [
            id,
            amt,
            note ? String(note).slice(0, 255) : null,
        ]);
        await conn.commit();

        const [fresh] = await pool.query(PAID_JOIN + ' WHERE r.id = ?', [id]);
        res.status(201).json(withBalance(fresh[0]));
    } catch (e) {
        await conn.rollback().catch(() => {});
        console.error('[Credit] payment failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to record payment' });
    } finally {
        conn.release();
    }
});

// DELETE /api/credit/:id   (admin)
// Allowed: Rejected, Cancelled, or Approved + fully paid.
// Blocked: Pending, and Approved credit that still has a balance.
router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid credit id' });

    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query(PAID_JOIN + ' WHERE r.id = ?', [id]);
        if (!rows.length) return res.status(404).json({ error: 'Request not found' });
        const r = withBalance(rows[0]);

        if (r.status === 'Pending') {
            return res.status(409).json({ error: 'The request is still pending' });
        }
        if (r.status === 'Approved' && !r.is_paid) {
            return res.status(409).json({ error: 'This credit still has a balance, so it cannot be deleted.' });
        }

        await conn.beginTransaction();
        await conn.query('DELETE FROM credit_payments WHERE credit_id = ?', [id]);
        await conn.query('DELETE FROM credit_requests WHERE id = ?', [id]);
        await conn.commit();
        res.json({ ok: true });
    } catch (e) {
        await conn.rollback().catch(() => {});
        console.error('[Credit] delete failed:', e.code, e.message);
        res.status(500).json({ error: 'Failed to delete' });
    } finally {
        conn.release();
    }
});

module.exports = router;