// Express route para sa employees + Brevo email.
// .env ng BACKEND (hindi frontend, walang VITE_):
//   BREVO_API_KEY=<bagong key>
//   BREVO_SENDER_EMAIL=<verified sender sa Brevo>
//   BREVO_SENDER_NAME=HRM System
//
// npm i bcrypt   (Node 18+ para sa built-in fetch)

const express = require('express');
const bcrypt = require('bcrypt');

const router = express.Router();

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendCredentials({ email, name, id, password }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Chivalry Real Estate Development',
        email: process.env.BREVO_SENDER_EMAIL, // dapat verified sa Brevo
      },
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
  if (!res.ok) console.error('Brevo error:', res.status, await res.text().catch(() => ''));
  return res.ok;
}

// CREATE
router.post('/employees', async (req, res) => {
  try {
    const { password, ...emp } = req.body;

    if (!emp.id || !emp.name) return res.status(400).json({ error: 'Employee number and name are required.' });
    if (!emp.email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const passwordHash = await bcrypt.hash(password, 10);

    // TODO: i-save sa DB mo: { ...emp, passwordHash }
    // await db.employees.insert({ ...emp, passwordHash });

    // Hindi mag-fail ang pag-save kahit pumalpak ang email
    const emailSent = await sendCredentials({
      email: emp.email,
      name: emp.name,
      id: emp.id,
      password,
    }).catch((err) => {
      console.error('Email send failed:', err);
      return false;
    });

    res.status(201).json({ ok: true, emailSent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while saving employee.' });
  }
});

// UPDATE: huwag hayaang ma-overwrite ang password dito
router.put('/employees/:id', async (req, res) => {
  const { password, passwordHash, ...emp } = req.body;
  // TODO: await db.employees.update(req.params.id, emp);
  res.json({ ok: true });
});

module.exports = router;