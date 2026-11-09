
const crypto = require('crypto');

const COOKIE_NAME = 'precifio_admin';
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  return left.length === right.length &&
    crypto.timingSafeEqual(left, right);
}

function getCookie(event, name) {
  const cookieHeader =
    event.headers?.cookie ||
    event.headers?.Cookie ||
    '';

  const entry = cookieHeader.split(';').map(v => v.trim())
    .find(v => v.startsWith(`${name}=`));

  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function isAdmin(event) {
  const secret = process.env.PRECIFIO_ADMIN_TOKEN;
  if (!secret) return false;

  // Keep direct PowerShell authentication working.
  const supplied =
    event.headers?.['x-admin-token'] ||
    event.headers?.['X-Admin-Token'];

  if (supplied && safeEqual(secret, supplied)) return true;

  // Browser session authentication.
  const session = getCookie(event, COOKIE_NAME);
  const [expiry, signature] = session.split('.');

  if (!expiry || !signature || !/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < Math.floor(Date.now() / 1000)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(expiry)
    .digest('hex');

  return safeEqual(expected, signature);
}

function createSessionCookie() {
  const secret = process.env.PRECIFIO_ADMIN_TOKEN;
  const expiry = String(
    Math.floor(Date.now() / 1000) + SESSION_SECONDS
  );

  const signature = crypto
    .createHmac('sha256', secret)
    .update(expiry)
    .digest('hex');

  const secure = process.env.NODE_ENV === 'production'
    ? '; Secure'
    : '';

  return `${COOKIE_NAME}=${expiry}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production'
    ? '; Secure'
    : '';

  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function json(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers
    },
    body: JSON.stringify(data)
  };
}

module.exports = {
  isAdmin,
  json,
  safeEqual,
  createSessionCookie,
  clearSessionCookie
};
