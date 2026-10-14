const express = require('express');
const pool = require('../db');

const router = express.Router();
const db = pool.promise();

const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
const TYPES = ['Leave', 'Undertime'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Parse 'YYYY-MM-DD' as UTC midnight so day math never shifts with the server timezone.
const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};

const isRealDate = (s) => {
    if (!DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// Inclusive calendar days between two dates.
const calcDays = (start, end) => Math.round((toUtc(end) - toUtc(start)) / 86400000) + 1;

const calcHours = (from, to) => {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    const mins = th * 60 + tm - (fh * 60 + fm);
    return mins <= 0 ? 0 : Math.round((mins / 60) * 100) / 100;
};

// GET /api/leave-undertime            -> all requests, newest first
// Optional filters: ?employeeId=EMP-001&status=Pending&type=Leave
router.get('/', async (req, res) => {
    try {
        const where = [];
        const params = [];

        if (req.query.employeeId) {
            where.push('employee_id = ?');
            params.push(String(req.query.employeeId));
        }
        if (req.query.status && STATUSES.includes(req.query.status)) {
            where.push('status = ?');
            params.push(req.query.status);
        }
        if (req.query.type && TYPES.includes(req.query.type)) {
            where.push('request_type = ?');
            params.push(req.query.type);
        }

        const sql =
            'SELECT * FROM leave_undertime_requests' +
            (where.length ? ' WHERE ' + where.join(' AND ') : '') +
            ' ORDER BY date_requested DESC, id DESC';

        const [rows] = await db.query(sql, params);
        return res.json(rows);
    } catch (err) {
        console.error('[LeaveUndertime] list failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to load requests' });
    }
});

// POST /api/leave-undertime           -> create a request (starts as Pending)
router.post('/', async (req, res) => {
    try {
        const {
            employeeId,
            employeeName,
            department,
            requestType,
            leaveType,
            startDate,
            endDate,
            timeFrom,
            timeTo,
            reason,
        } = req.body || {};

        if (!employeeId) return res.status(400).json({ error: 'Employee is required' });
        if (!TYPES.includes(requestType)) {
            return res.status(400).json({ error: 'Request type must be Leave or Undertime' });
        }
        if (!isRealDate(startDate)) return res.status(400).json({ error: 'A valid date is required' });

        // Trust the employees table over whatever the browser sent.
        const [empRows] = await db.query('SELECT id, name, dept FROM employees WHERE id = ?', [employeeId]);
        if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found' });
        const emp = empRows[0];
        const name = emp.name || employeeName || 'Unknown';
        const dept = emp.dept || department || null;

        let leave = null;
        let end = null;
        let days = null;
        let from = null;
        let to = null;
        let hours = null;

        if (requestType === 'Leave') {
            end = endDate || startDate;
            if (!isRealDate(end)) return res.status(400).json({ error: 'A valid end date is required' });
            if (toUtc(end) < toUtc(startDate)) {
                return res.status(400).json({ error: 'End date must be on or after the start date' });
            }
            if (!leaveType || String(leaveType).length > 50) {
                return res.status(400).json({ error: 'Leave type is required' });
            }
            leave = String(leaveType);
            days = calcDays(startDate, end);
        } else {
            if (!TIME_RE.test(timeFrom || '') || !TIME_RE.test(timeTo || '')) {
                return res.status(400).json({ error: 'Valid leaving and shift-end times are required' });
            }
            hours = calcHours(timeFrom, timeTo);
            if (hours <= 0) {
                return res.status(400).json({ error: 'Leaving time must be earlier than the end of the shift' });
            }
            end = startDate;
            from = timeFrom;
            to = timeTo;
        }

        const [result] = await db.query(
            `INSERT INTO leave_undertime_requests
               (employee_id, employee_name, department, request_type, leave_type,
                start_date, end_date, days, time_from, time_to, hours, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                emp.id,
                name,
                dept,
                requestType,
                leave,
                startDate,
                end,
                days,
                from,
                to,
                hours,
                reason ? String(reason).slice(0, 500) : null,
            ]
        );

        const [rows] = await db.query('SELECT * FROM leave_undertime_requests WHERE id = ?', [result.insertId]);
        return res.status(201).json(rows[0]);
    } catch (err) {
        console.error('[LeaveUndertime] create failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to submit request' });
    }
});

// PATCH /api/leave-undertime/:id/status   body: { status, remarks? }
// Only a Pending request can be decided, so a double click can't flip an earlier decision.
router.patch('/:id/status', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { status, remarks } = req.body || {};

        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid request id' });
        if (!STATUSES.includes(status) || status === 'Pending') {
            return res.status(400).json({ error: 'Status must be Approved, Rejected or Cancelled' });
        }

        const [result] = await db.query(
            `UPDATE leave_undertime_requests
                SET status = ?, admin_remarks = ?, reviewed_at = CURRENT_TIMESTAMP
              WHERE id = ? AND status = 'Pending'`,
            [status, remarks ? String(remarks).slice(0, 500) : null, id]
        );

        if (result.affectedRows === 0) {
            const [exists] = await db.query('SELECT id FROM leave_undertime_requests WHERE id = ?', [id]);
            if (exists.length === 0) return res.status(404).json({ error: 'Request not found' });
            return res.status(409).json({ error: 'This request has already been processed' });
        }

        const [rows] = await db.query('SELECT * FROM leave_undertime_requests WHERE id = ?', [id]);
        return res.json(rows[0]);
    } catch (err) {
        console.error('[LeaveUndertime] status update failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to update request' });
    }
});

// DELETE /api/leave-undertime/:id   -> only decided requests (Approved / Rejected / Cancelled)
router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid request id' });

        const [result] = await db.query(
            `DELETE FROM leave_undertime_requests WHERE id = ? AND status <> 'Pending'`,
            [id]
        );

        if (result.affectedRows === 0) {
            const [exists] = await db.query('SELECT id FROM leave_undertime_requests WHERE id = ?', [id]);
            if (exists.length === 0) return res.status(404).json({ error: 'Request not found' });
            return res.status(409).json({ error: 'Pending requests must be approved, rejected or cancelled first' });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('[LeaveUndertime] delete failed:', err.code, err.message);
        return res.status(500).json({ error: 'Failed to delete request' });
    }
});

module.exports = router;