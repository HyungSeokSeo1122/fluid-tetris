'use strict';
const crypto = require('crypto');
const https = require('https');
const REGION = '__REGION__';
const POOL = '__POOL_ID__';
const CLIENT = '__CLIENT_ID__';
const AUTH = '__AUTH_BASE__';
const ISS = 'https://cognito-idp.' + REGION + '.amazonaws.com/' + POOL;
const JWKS = ISS + '/.well-known/jwks.json';
const COOKIE = '; HttpOnly; Secure; SameSite=Lax; Path=';
let jwks;
exports.handler = async (event) => {
  try {
    return await route(event.Records[0].cf.request);
  } catch (_error) {
    return text(503, 'Unavailable');
  }
};
async function route(request) {
  const host = header(request, 'host');
  const callback = 'https://' + host + '/_auth/callback';
  const jar = parseCookies(request.headers.cookie);
  if (request.uri === '/_auth/callback') return handleCallback(request, jar, host, callback);
  if (request.uri === '/_auth/logout') {
    return redirect(AUTH + '/logout?' + params({ client_id: CLIENT, logout_uri: 'https://' + host + '/' }), [
      cookie('ft', '', 0, '/'),
      cookie('ftv', '', 0, '/_auth/callback'),
    ]);
  }
  if (await validIdToken(jar.ft)) {
    delete request.headers.cookie;
    return request;
  }
  return startLogin(callback);
}
function startLogin(callback) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return redirect(AUTH + '/oauth2/authorize?' + params({
    client_id: CLIENT,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }), [cookie('ftv', verifier + '.' + state, 600, '/_auth/callback')]);
}
async function handleCallback(request, jar, host, callback) {
  const query = new URLSearchParams(request.querystring);
  const saved = (jar.ftv || '').split('.');
  if (query.get('error')) return text(401, 'Cancelled');
  if (!query.get('code') || saved.length !== 2 || query.get('state') !== saved[1]) {
    return text(401, 'Incomplete');
  }
  const body = JSON.parse(await requestHttps('POST', AUTH + '/oauth2/token', params({
    grant_type: 'authorization_code',
    client_id: CLIENT,
    code: query.get('code'),
    redirect_uri: callback,
    code_verifier: saved[0],
  })));
  if (!body.id_token || !(await validIdToken(body.id_token))) return text(401, 'Rejected');
  return redirect('https://' + host + '/', [
    cookie('ft', body.id_token, 3600, '/'),
    cookie('ftv', '', 0, '/_auth/callback'),
  ]);
}
async function validIdToken(token) {
  try {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || payload.iss !== ISS || payload.aud !== CLIENT || payload.token_use !== 'id') return false;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000) + 30) return false;
    const key = await signingKey(header.kid);
    return !!key && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  } catch (_error) {
    return false;
  }
}
async function signingKey(kid) {
  if (!jwks) jwks = JSON.parse(await requestHttps('GET', JWKS));
  let jwk = (jwks.keys || []).find((key) => key.kid === kid);
  if (!jwk) {
    jwks = JSON.parse(await requestHttps('GET', JWKS));
    jwk = (jwks.keys || []).find((key) => key.kid === kid);
  }
  return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
}
function requestHttps(method, url, body) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: target.hostname,
      path: target.pathname + target.search,
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const textBody = Buffer.concat(chunks).toString();
        if (res.statusCode && res.statusCode >= 400) reject(new Error('http'));
        else resolve(textBody);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function params(values) {
  return new URLSearchParams(values).toString();
}
function header(request, name) {
  const value = request.headers[name];
  return value && value[0] ? value[0].value : '';
}
function parseCookies(headers) {
  const cookies = {};
  for (const item of headers || []) {
    for (const part of item.value.split(';')) {
      const splitAt = part.indexOf('=');
      if (splitAt > 0) cookies[part.slice(0, splitAt).trim()] = part.slice(splitAt + 1).trim();
    }
  }
  return cookies;
}
function cookie(name, value, maxAge, path) {
  return { key: 'Set-Cookie', value: name + '=' + value + COOKIE + path + '; Max-Age=' + maxAge };
}
function redirect(location, setCookies) {
  const headers = {
    location: [{ key: 'Location', value: location }],
    'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
  };
  if (setCookies.length > 0) headers['set-cookie'] = setCookies;
  return { status: '302', statusDescription: 'Found', headers };
}
function text(status, message) {
  return {
    status: String(status),
    statusDescription: 'Error',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/plain' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: message,
  };
}
