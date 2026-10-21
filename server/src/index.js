require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', require('./routes/auth'));
const { router: claimsRouter, attRouter } = require('./routes/claims');
app.use('/api/claims', claimsRouter);
app.use('/api/attachments', attRouter);
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/misc'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app (npm run build in /client) from the same server
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5 MB)' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error', details: err.details });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`CPDA portal API running on http://localhost:${port}`));
