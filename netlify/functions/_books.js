
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const BOOKS = {
  "volume-1": {
    title: "From Zero To Builder",
    volume: "Volume I",
    file: "volume-1.epub",
    price: 4.99,
    currency: "USD"
  },
  "volume-2": {
    title: "From Builder To Creator",
    volume: "Volume II",
    file: "volume-2.epub",
    price: 4.99,
    currency: "USD"
  },
  "volume-3": {
    title: "From Creator To Founder",
    volume: "Volume III",
    file: "volume-3.epub",
    price: 4.99,
    currency: "USD"
  }
};

function getSupabase() {
  if (!process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "{}";

  return JSON.parse(raw);
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

// The access token is signed, not stored in plaintext.
// It is tied to the order ID and customer's email.
function createAccessToken(order) {
  const secret = process.env.BOOK_ACCESS_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("BOOK_ACCESS_SECRET is missing or too short.");
  }

  const payload = `${order.id}:${order.email.toLowerCase()}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${order.id}.${signature}`;
}

function verifyAccessToken(token, order) {
  if (typeof token !== "string") return false;

  const parts = token.split(".");

  if (parts.length !== 2) return false;

  const [orderId, signature] = parts;

  if (orderId !== order.id) return false;

  const expectedToken = createAccessToken(order);
  const expectedSignature = expectedToken.split(".")[1];

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function sendAccessEmail(order) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing.");
  }

  const book = BOOKS[order.book_id];

  if (!book) {
    throw new Error("Book not found.");
  }

  const siteUrl = (
    process.env.SITE_URL || "https://precifio.app"
  ).replace(/\/$/, "");

  const token = createAccessToken(order);

  const accessUrl =
    `${siteUrl}/book-access.html?token=${encodeURIComponent(token)}`;

  const from =
    process.env.BOOK_FROM_EMAIL ||
    "Precifio Books <hello@precifio.app>";

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [order.email],
        subject: `Your Precifio Books purchase: ${book.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033">
            <h2>Your book is ready!</h2>

            <p>Thank you for purchasing from Precifio Books.</p>

            <h3>${escapeHtml(book.title)} — ${escapeHtml(book.volume)}</h3>

            <p>Your purchase has been verified.</p>

            <p>
              <a href="${accessUrl}"
                 style="display:inline-block;background:#2463eb;color:white;padding:14px 22px;text-decoration:none;border-radius:8px;font-weight:bold">
                Access My Ebook
              </a>
            </p>

            <p><strong>Important:</strong> Open this link on the device you intend to use for your book. Your first successful access registers that device.</p>

            <p>Keep this email and access link private.</p>

            <p>Purchase reference: ${escapeHtml(order.tx_ref)}</p>

            <p>Thank you for supporting Precifio.</p>
          </div>
        `
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Resend error:", error);
    throw new Error("Could not send the book access email.");
  }

  return true;
}

async function verifyFlutterwave(transactionId) {
  const secret = process.env.FLW_SECRET_KEY;

  if (!secret) {
    throw new Error("FLW_SECRET_KEY is missing.");
  }

  const response = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      }
    }
  );

  const result = await response.json();

  if (!response.ok || result.status !== "success") {
    console.error("Flutterwave verification failed:", result);
    throw new Error("Flutterwave could not verify the transaction.");
  }

  return result.data;
}

module.exports = {
  BOOKS,
  getSupabase,
  json,
  parseBody,
  hash,
  createAccessToken,
  verifyAccessToken,
  sendAccessEmail,
  verifyFlutterwave
};
