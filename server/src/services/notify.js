const nodemailer = require('nodemailer');
const { pool } = require('../db');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** In-app notification for each user + optional email (only if SMTP is configured). */
async function notify(c, userIds, message, claimId) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const id of ids) {
    await c.query('INSERT INTO notifications(user_id, message, claim_id) VALUES ($1,$2,$3)', [id, message, claimId || null]);
    if (transporter) {
      try {
        const { rows } = await c.query('SELECT email FROM users WHERE id=$1', [id]);
        if (rows[0]) {
          transporter.sendMail({
            from: process.env.MAIL_FROM || 'cpda-portal@localhost',
            to: rows[0].email,
            subject: 'CPDA Portal notification',
            text: message,
          }).catch((e) => console.error('mail error', e.message));
        }
      } catch (e) { console.error('mail lookup error', e.message); }
    }
  }
}

async function audit(c, user, action, entity, entityId, details) {
  await (c || pool).query(
    'INSERT INTO audit_log(user_id, user_name, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [user ? user.id : null, user ? user.name : 'system', action, entity || null, entityId || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = { notify, audit };
