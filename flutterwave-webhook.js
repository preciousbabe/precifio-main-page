// netlify/functions/flutterwave-webhook.js
// One webhook for BOTH products on the same Flutterwave account.
// Routes by tx_ref prefix:
//   PRECIFIO-BOOK-...  -> book order (verify + mark paid + send access email)
//   buy50_ / buy200_ / buy500_ / buy1200_ -> credit purchase

import { createRequire } from "module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const {
  getSupabase,
  verifyFlutterwave,
  confirmPaymentAndDeliver
} = require("./_books");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    // ── Verify Flutterwave signature ──
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature =
      event.headers["verif-hash"] || event.headers["Verif-Hash"];

    if (!signature || signature !== secretHash) {
      return { statusCode: 401, body: "Invalid signature" };
    }

    // ── Parse payload ──
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: "Invalid payload" };
    }

    if (
      payload.event !== "charge.completed" ||
      payload.data.status !== "successful"
    ) {
      return { statusCode: 200, body: "Ignored" };
    }

    const tx_ref = String(payload.data.tx_ref || "");

    // ── Route: book orders first ──
    if (tx_ref.startsWith("PRECIFIO-BOOK-")) {
      return handleBookOrder(payload.data);
    }

    // ── Route: credit purchases ──
    return handleCreditPurchase(payload);

  } catch (err) {
    console.error("Flutterwave webhook error:", err);
    return { statusCode: 500, body: "Server error" };
  }
}

// ─────────────────────────────────────────────
// BOOK ORDERS
// ─────────────────────────────────────────────
async function handleBookOrder(data) {
  const supabase = getSupabase();

  const { data: order } = await supabase
    .from("book_orders")
    .select("*")
    .eq("tx_ref", data.tx_ref)
    .maybeSingle();

  if (!order || order.status === "failed") {
    return { statusCode: 200, body: "Order not found" };
  }

  // Do not trust the webhook body. Ask Flutterwave directly.
  const payment = await verifyFlutterwave(data.id);

  try {
    await confirmPaymentAndDeliver(supabase, order, payment);
  } catch (err) {
    if (err.code === "PAYMENT_MISMATCH" || err.code === "DIFFERENT_PAYMENT") {
      console.error("Webhook ignored:", err.code, data.tx_ref);
      return { statusCode: 200, body: err.code };
    }

    // Activation or email problem: non-200 makes Flutterwave retry.
    console.error("Webhook delivery problem:", err.code || err);
    return { statusCode: 500, body: "Delivery failed, please retry." };
  }

  return { statusCode: 200, body: "OK" };
}

// ─────────────────────────────────────────────
// CREDIT PURCHASES (notes app)
// ─────────────────────────────────────────────
async function handleCreditPurchase(payload) {
  const tx_ref = payload.data.tx_ref;
  const parts = tx_ref.split("_");

  if (parts.length < 3) {
    console.error("Unknown tx_ref format:", tx_ref);
    return { statusCode: 200, body: "Unknown transaction type" };
  }

  const bundle = parts[0];
  const user_id = parts[1];

  let credits = 0;
  if (bundle === "buy50") credits = 50;
  else if (bundle === "buy200") credits = 200;
  else if (bundle === "buy500") credits = 500;
  else if (bundle === "buy1200") credits = 1200;

  if (credits === 0) {
    console.warn("No credit mapping found:", tx_ref);
    return { statusCode: 200, body: "No credits granted" };
  }

  const amount = Number(payload.data.amount);
  const currency = payload.data.currency;

  const priceMap = {
    buy50: 1.99,
    buy200: 4.99,
    buy500: 9.99,
    buy1200: 19.99
  };

  if (amount !== priceMap[bundle] || currency !== "USD") {
    console.error("Price mismatch:", bundle, amount, currency);
    return { statusCode: 400, body: "Invalid payment amount" };
  }

  const { data: user, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("id, ai_credits_remaining, ai_credits_total")
    .eq("id", user_id)
    .single();

  if (fetchError || !user) {
    console.error("User not found:", fetchError);
    return { statusCode: 404, body: "User not found" };
  }

  const { data: existing } = await supabaseAdmin
    .from("credit_transactions")
    .select("id")
    .eq("external_ref", tx_ref)
    .maybeSingle();

  if (existing) {
    console.warn("Transaction already processed:", tx_ref);
    return { statusCode: 200, body: "Already processed" };
  }

  const newRemaining = user.ai_credits_remaining + credits;
  const newTotal = user.ai_credits_total + credits;

  await supabaseAdmin
    .from("users")
    .update({
      ai_credits_remaining: newRemaining,
      ai_credits_total: newTotal,
      ai_credits_last_grant: new Date().toISOString()
    })
    .eq("id", user.id);

  await supabaseAdmin.from("credit_transactions").insert({
    user_id: user.id,
    change: credits,
    reason: "purchase",
    external_ref: tx_ref
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ granted: true, credits })
  };
}