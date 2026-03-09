const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const USERNAME = process.env.VOIP_USERNAME;
const API_PASSWORD = process.env.VOIP_API_PASSWORD;

function fetchVoipBalance() {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://voip.ms/api/v1/rest.php?api_username=${encodeURIComponent(USERNAME)}&api_password=${encodeURIComponent(API_PASSWORD)}&method=getBalance`;
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from voip.ms')); }
      });
    }).on('error', reject);
  });
}

function fetchRates() {
  return new Promise((resolve, reject) => {
    https.get('https://api.frankfurter.app/latest?from=EUR&to=USD,ILS', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid rates JSON')); }
      });
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/balance') {
    try {
      const [voip, rates] = await Promise.all([fetchVoipBalance(), fetchRates()]);
      const raw = typeof voip.balance === 'object' ? voip.balance?.current_balance : voip.balance;
      const eur = parseFloat(raw);
      const usd = eur * rates.rates.USD;
      const ils = eur * rates.rates.ILS;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: voip.status,
        eur: eur.toFixed(2),
        usd: usd.toFixed(2),
        ils: ils.toFixed(2),
        eurUsd: rates.rates.USD.toFixed(4),
        eurIls: rates.rates.ILS.toFixed(4)
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url === '/balance.txt') {
    try {
      const [voip, rates] = await Promise.all([fetchVoipBalance(), fetchRates()]);
      const raw = typeof voip.balance === 'object' ? voip.balance?.current_balance : voip.balance;
      const eur = parseFloat(raw);
      const usd = (eur * rates.rates.USD).toFixed(2);
      const ils = (eur * rates.rates.ILS).toFixed(2);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('$' + usd + '\n' + ils);
    } catch (e) {
      res.writeHead(500);
      res.end('שגיאה');
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>voip.ms יתרה</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Heebo:wght@300;400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg: #0a0e14; --surface: #111620; --border: #1e2a3a; --accent: #00d4ff; --accent2: #00ff9d; --text: #c8d8e8; --muted: #4a6080; --danger: #ff4d6d; --mono: 'IBM Plex Mono', monospace; --sans: 'Heebo', sans-serif; }
    body { background: var(--bg); color: var(--text); font-family: var(--sans); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    body::before { content: ''; position: fixed; inset: 0; background-image: linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px); background-size: 40px 40px; pointer-events: none; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 2px; width: 100%; max-width: 420px; position: relative; z-index: 1; animation: fadeIn 0.4s ease; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
    .card-header { padding: 28px 32px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
    .logo-icon { width: 38px; height: 38px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border-radius: 2px; display: flex; align-items: center; justify-content: center; }
    .logo-icon svg { width: 20px; height: 20px; fill: #0a0e14; }
    .header-text h1 { font-family: var(--mono); font-size: 15px; font-weight: 600; color: #fff; letter-spacing: 0.05em; }
    .header-text p { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); margin-right: auto; margin-left: 0; transition: background 0.3s; }
    .status-dot.online { background: var(--accent2); box-shadow: 0 0 8px var(--accent2); }
    .status-dot.error { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .card-body { padding: 32px; text-align: center; }
    .loading { font-family: var(--mono); font-size: 13px; color: var(--muted); }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(0,212,255,0.3); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-left: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .balance-label { font-family: var(--mono); font-size: 10px; color: var(--muted); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px; }
    .balance-main { font-family: var(--mono); font-size: 48px; font-weight: 600; color: var(--accent2); letter-spacing: -0.02em; line-height: 1; }
    .balance-main .currency { font-size: 20px; color: var(--muted); margin-right: 4px; }
    .balance-ils { font-family: var(--mono); font-size: 20px; color: var(--muted); margin-top: 8px; }
    .rate-note { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
    .timestamp { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-top: 10px; }
    .error { color: var(--danger); font-family: var(--mono); font-size: 13px; }
    .refresh-btn { margin-top: 20px; padding: 10px 24px; background: transparent; border: 1px solid var(--accent); border-radius: 2px; color: var(--accent); font-family: var(--mono); font-size: 12px; cursor: pointer; transition: all 0.2s; letter-spacing: 0.1em; }
    .refresh-btn:hover { background: var(--accent); color: #0a0e14; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg></div>
      <div class="header-text"><h1>VOIP.MS BALANCE</h1><p>יתרת חשבון</p></div>
      <div class="status-dot" id="statusDot"></div>
    </div>
    <div class="card-body" id="body">
      <div class="loading">טוען... <span class="spinner"></span></div>
    </div>
  </div>
  <script>
    async function load() {
      const body = document.getElementById('body');
      const dot = document.getElementById('statusDot');
      try {
        const res = await fetch('/api/balance');
        const d = await res.json();
        if (d.status === 'success') {
          dot.className = 'status-dot online';
          body.innerHTML = '<div class="balance-label">יתרה נוכחית</div><div class="balance-main"><span class="currency">$</span>' + d.usd + '</div><div class="balance-ils">₪' + d.ils + '</div><div class="rate-note">1 EUR = $' + d.eurUsd + ' / ₪' + d.eurIls + '</div><div class="timestamp">עדכון: ' + new Date().toLocaleString('he-IL') + '</div><button class="refresh-btn" onclick="load()">↻ רענן</button>';
        } else {
          dot.className = 'status-dot error';
          body.innerHTML = '<div class="error">⚠ ' + (d.status || 'שגיאה') + '</div>';
        }
      } catch(e) {
        dot.className = 'status-dot error';
        body.innerHTML = '<div class="error">⚠ שגיאת חיבור</div>';
      }
    }
    load();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
