const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const USERNAME = process.env.VOIP_USERNAME;
const API_PASSWORD = process.env.VOIP_API_PASSWORD;
const ZADARMA_KEY = process.env.ZADARMA_KEY;
const ZADARMA_SECRET = process.env.ZADARMA_SECRET;

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

function fetchZadarmaStats(params) {
  return new Promise((resolve, reject) => {
    const method = '/v1/statistics/';
   
    const sorted = Object.keys(params).sort().reduce((acc, k) => {
      acc[k] = params[k];
      return acc;
    }, {});
  const queryString = Object.entries(sorted)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
  .join('&');
    const md5 = crypto.createHash('md5').update(queryString).digest('hex');
    const strToSign = method + queryString + md5;
  const signature = Buffer.from(
  crypto.createHmac('sha1', ZADARMA_SECRET).update(strToSign).digest('hex')
).toString('base64');
    console.log('queryString:', queryString);
    console.log('strToSign:', strToSign);
    console.log('signature:', signature);
    const options = {
      hostname: 'api.zadarma.com',
      path: `${method}?${queryString}`,
      method: 'GET',
      headers: { 'Authorization': `${ZADARMA_KEY}:${signature}` }
    };
    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Zadarma response:', data);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Zadarma')); }
      });
    }).on('error', reject).end();
  });
}

function formatDateTime(date) {
  const israelTime = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return israelTime.toISOString().replace('T', ' ').substring(0, 19);
}

function classifyCall(stat) {
  const seconds = parseInt(stat.billseconds) || 0;
  const fromStr = String(stat.from || '');
  const isOutgoing = fromStr.length <= 6;
  const direction = isOutgoing ? 'outgoing' : 'incoming';
  let callType;
  if (seconds < 10) {
    const d = (stat.disposition || '').toLowerCase();
    if (d === 'busy') callType = 'נדחתה';
    else callType = 'בוטלה';
  } else {
    callType = 'answered';
  }
  return { direction, callType, seconds };
}

const server = http.createServer(async (req, res) => {

  if (req.url && req.url.startsWith('/zadarma/last-call')) {
    const urlObj = new URL(req.url, `http://localhost`);
    const lastId = urlObj.searchParams.get('last_id') || '';
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 60 * 1000);
     const stats = await fetchZadarmaStats({
  start: formatDateTime(from),
  end: formatDateTime(now),
  limit: '20'
});
      if (stats.status !== 'success' || !stats.stats || stats.stats.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'no_new_call' }));
        return;
      }
      const sorted = stats.stats.sort((a, b) => new Date(b.callstart) - new Date(a.callstart));
      const newCall = sorted.find(s => String(s.id) !== String(lastId));
      if (!newCall) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'no_new_call' }));
        return;
      }
      const { direction, callType, seconds } = classifyCall(newCall);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'new_call',
        id: String(newCall.id),
        callstart: newCall.callstart,
        from: String(newCall.from),
        to: String(newCall.to),
        direction,
        call_type: callType,
        seconds,
        disposition: newCall.disposition
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: e.message }));
    }
    return;
  }

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
      const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
      res.end('$' + usd + '\n' + ils + '\n' + now);
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
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 2px; width: 100%; max-width: 420px; }
    .card-header { padding: 28px 32px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
    .header-text h1 { font-family: var(--mono); font-size: 15px; font-weight: 600; color: #fff; }
    .header-text p { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .card-body { padding: 32px; text-align: center; }
    .balance-main { font-family: var(--mono); font-size: 48px; font-weight: 600; color: var(--accent2); }
    .balance-ils { font-family: var(--mono); font-size: 20px; color: var(--muted); margin-top: 8px; }
    .error { color: var(--danger); font-family: var(--mono); font-size: 13px; }
    .refresh-btn { margin-top: 20px; padding: 10px 24px; background: transparent; border: 1px solid var(--accent); color: var(--accent); font-family: var(--mono); font-size: 12px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="header-text"><h1>VOIP.MS BALANCE</h1><p>יתרת חשבון</p></div>
    </div>
    <div class="card-body" id="body">טוען...</div>
  </div>
  <script>
    async function load() {
      const body = document.getElementById('body');
      try {
        const res = await fetch('/api/balance');
        const d = await res.json();
        if (d.status === 'success') {
          body.innerHTML = '<div class="balance-main">$' + d.usd + '</div><div class="balance-ils">₪' + d.ils + '</div><button class="refresh-btn" onclick="load()">↻ רענן</button>';
        } else {
          body.innerHTML = '<div class="error">⚠ שגיאה</div>';
        }
      } catch(e) {
        body.innerHTML = '<div class="error">⚠ שגיאת חיבור</div>';
      }
    }
    load();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
