const express = require('express');
const pool = require('../db').promise();
const router = express.Router();

const MAX_AMOUNT = 20000;
const STATUSES = ['Pending', 'Approved', 'Rejected'];

// GET /api/cash-advance                 -> all (admin)
// GET /api/cash-advance?employeeId=123  -> one employee (mobile)
router.get('/', async (req, res) => {
  try {
    const { employeeId } = req.query;
    const [rows] = employeeId
      ? await pool.query(
          'SELECT * FROM cash_advance_requests WHERE employee_id = ? ORDER BY date_requested DESC',
          [employeeId])
      : await pool.query('SELECT * FROM cash_advance_requests ORDER BY date_requested DESC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// POST /api/cash-advance
router.post('/', async (req, res) => {
  try {
    const { employeeId, amount, reason, repaymentMonths } = req.body;
    const amt = Number(amount);

    if (!employeeId) return res.status(400).json({ error: 'Employee required' });
    if (!(amt > 0) || amt > MAX_AMOUNT)
      return res.status(400).json({ error: `Amount must be between 1 and ${MAX_AMOUNT}` });

    // Name and department come from the database, not the client
    const [emp] = await pool.query('SELECT name, dept FROM employees WHERE id = ?', [employeeId]);
    if (!emp.length) return res.status(404).json({ error: 'Employee not found' });

    const months = Math.min(Math.max(Number(repaymentMonths) || 1, 1), 12);

    const [pending] = await pool.query(
      "SELECT COUNT(*) AS c FROM cash_advance_requests WHERE employee_id = ? AND status = 'Pending'",
      [employeeId]);
    if (pending[0].c >= 1)
      return res.status(409).json({ error: 'You already have a pending request' });

    const [result] = await pool.query(
      `INSERT INTO cash_advance_requests
       (employee_id, employee_name, department, amount, reason, repayment_months)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [employeeId, emp[0].name, emp[0].dept || null, amt, (reason || '').slice(0, 500), months]);

    const [rows] = await pool.query(
      'SELECT * FROM cash_advance_requests WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// PATCH /api/cash-advance/:id/status   (admin)  { status, remarks }
// Only Pending requests can be approved or rejected.
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const [r] = await pool.query(
      `UPDATE cash_advance_requests
       SET status = ?, admin_remarks = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'Pending'`,
      [status, remarks || null, req.params.id]);

    if (!r.affectedRows)
      return res.status(409).json({ error: 'Request is no longer pending' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// PATCH /api/cash-advance/:id/cancel   (employee, pending only)
router.patch('/:id/cancel', async (req, res) => {
  try {
    const [r] = await pool.query(
      "UPDATE cash_advance_requests SET status = 'Cancelled' WHERE id = ? AND status = 'Pending'",
      [req.params.id]);
    if (!r.affectedRows)
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// DELETE /api/cash-advance/:id   (admin) - only Approved / Rejected / Cancelled
router.delete('/:id', async (req, res) => {
  try {
    const [r] = await pool.query(
      "DELETE FROM cash_advance_requests WHERE id = ? AND status <> 'Pending'",
      [req.params.id]);
    if (!r.affectedRows)
      return res.status(409).json({ error: 'Not found, or the request is still pending' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;