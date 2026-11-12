
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
  const url =
    process.env.BOOKS_SUPABASE_URL || process.env.SUPABASE_URL;

  const key =
    process.env.BOOKS_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are missing.");
  }

  return createClient(
    url,
    key,
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
    process.env.BOOKS_SITE_URL || "https://precifio.app"
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

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Checks that Flutterwave's record matches our order exactly.
function isPaymentValid(order, payment) {
  const returnedEmail = String(payment.customer?.email || "")
    .trim()
    .toLowerCase();

  return (
    payment.tx_ref === order.tx_ref &&
    payment.status === "successful" &&
    String(payment.currency).toUpperCase() === order.currency &&
    Number(payment.amount) >= Number(order.amount) &&
    (!returnedEmail || returnedEmail === order.email.toLowerCase())
  );
}

// Shared by the return page (book-verify) and the webhook (book-webhook).
// Safe to call many times and from both at once: the order is marked paid
// once, and the access email is sent once.
async function confirmPaymentAndDeliver(supabase, order, payment) {
  if (!isPaymentValid(order, payment)) {
    throw codedError("PAYMENT_MISMATCH", "Payment does not match order.");
  }

  const sameTx = row =>
    !row.flutterwave_transaction_id ||
    String(row.flutterwave_transaction_id) === String(payment.id);

  if (!sameTx(order)) {
    throw codedError("DIFFERENT_PAYMENT", "Order has a different payment.");
  }

  if (order.status === "pending") {
    const { error } = await supabase
      .from("book_orders")
      .update({
        status: "paid",
        flutterwave_transaction_id: String(payment.id),
        paid_at: new Date().toISOString()
      })
      .eq("id", order.id)
      .eq("status", "pending");

    if (error) {
      console.error("Order update error:", error);
      throw codedError("ACTIVATION_FAILED", "Could not activate order.");
    }
  }

  const { data: fresh } = await supabase
    .from("book_orders")
    .select("*")
    .eq("id", order.id)
    .single();

  if (!fresh || fresh.status !== "paid") {
    throw codedError("ACTIVATION_FAILED", "Could not activate order.");
  }

  if (!sameTx(fresh)) {
    throw codedError("DIFFERENT_PAYMENT", "Order has a different payment.");
  }

  if (fresh.access_email_sent_at) {
    return { alreadySent: true };
  }

  // Claim the email so only one request sends it.
  const { data: claimed, error: claimError } = await supabase
    .from("book_orders")
    .update({ access_email_sent_at: new Date().toISOString() })
    .eq("id", fresh.id)
    .is("access_email_sent_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw codedError("EMAIL_FAILED", "Could not prepare email.");
  }

  if (!claimed) {
    return { alreadySent: true };
  }

  try {
    await sendAccessEmail(fresh);
  } catch (emailError) {
    console.error("Book delivery email error:", emailError);

    // Release the claim so a retry can send it again.
    await supabase
      .from("book_orders")
      .update({ access_email_sent_at: null })
      .eq("id", fresh.id);

    throw codedError("EMAIL_FAILED", "Could not send access email.");
  }

  return { alreadySent: false };
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
  verifyFlutterwave,
  confirmPaymentAndDeliver
};