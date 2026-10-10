'use strict';
// HTTPS server the phone talks to. Serves the camera page and relays WebRTC
// signalling over plain fetch (long-poll), because iOS Safari will not open a
// WebSocket to a self-signed host even after the page warning is accepted.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

const VIRTUAL = /vethernet|wsl|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier|docker/i;

function lanIPs() {
  const real = [];
  const virtual = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      (VIRTUAL.test(name) ? virtual : real).push(a.address);
    }
  }
  return [...real, ...virtual];
}

function loadCert(dir, ips) {
  const file = path.join(dir, 'cert.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ips.every((ip) => c.ips.includes(ip)) && c.expires > Date.now() + 864e5) return c;
  } catch {}
  const days = 800; // iOS rejects server certs valid for longer than 825 days
  const pems = selfsigned.generate([{ name: 'commonName', value: 'FreeCast' }], {
    days,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))],
      },
    ],
  });
  const c = { key: pems.private, cert: pems.cert, ips, expires: Date.now() + days * 864e5 };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c));
  return c;
}

function startServer({ port, token, certDir, phoneDir, onSignal }) {
  const cert = loadCert(certDir, lanIPs());
  const clients = new Map(); // phone id -> { msgs, waiter }

  const client = (id) => {
    if (!clients.has(id)) clients.set(id, { msgs: [], waiter: null });
    return clients.get(id);
  };

  const flush = (c) => {
    if (!c.waiter || !c.msgs.length) return;
    const { res, timer } = c.waiter;
    c.waiter = null;
    clearTimeout(timer);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(c.msgs.splice(0)));
  };

  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    const url = new URL(req.url, 'https://x');
    if (url.searchParams.get('t') !== token) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/cam') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(phoneDir, 'phone.html')));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      let body = '';
      req.on('data', (d) => {
        body += d;
        if (body.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          const { id, msg } = JSON.parse(body);
          client(String(id));
          onSignal(String(id), msg);
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/poll') {
      const c = client(String(url.searchParams.get('id')));
      if (c.waiter) {
        clearTimeout(c.waiter.timer);
        c.waiter.res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
      }
      const timer = setTimeout(() => {
        if (c.waiter && c.waiter.res === res) c.waiter = null;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('[]');
      }, 20000);
      c.waiter = { res, timer };
      req.on('close', () => {
        if (c.waiter && c.waiter.res === res) {
          clearTimeout(timer);
          c.waiter = null;
        }
      });
      flush(c);
      return;
    }
    res.writeHead(404).end();
  });

  const api = {
    port,
    error: null,
    send(id, msg) {
      const c = client(id);
      c.msgs.push(msg);
      flush(c);
    },
    close() {
      server.close();
    },
  };

  let tries = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries++ < 10) {
      api.port += 1;
      server.listen(api.port, '0.0.0.0');
    } else {
      api.error = err.message;
    }
  });
  server.listen(api.port, '0.0.0.0');
  return api;
}

module.exports = { startServer, lanIPs };
