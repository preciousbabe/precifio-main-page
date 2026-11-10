const crypto = require("crypto");

const {
  getSupabase,
  json,
  parseBody,
  verifyFlutterwave,
  confirmPaymentAndDeliver
} = require("./_books");

// Flutterwave calls this by itself after a payment, even if the buyer
// closes the browser before returning to the site.
// Dashboard URL: https://precifio.app/.netlify/functions/book-webhook
exports.handler = async event => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    // 1. Confirm the call really comes from Flutterwave.
    const expected = process.env.FLW_WEBHOOK_HASH || "";
    const received =
      event.headers["verif-hash"] ||
      event.headers["Verif-Hash"] ||
      "";

    const a = Buffer.from(received);
    const b = Buffer.from(expected);

    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json(401, { error: "Invalid signature." });
    }

    // 2. Only handle successful book payments.
    const payload = parseBody(event);
    const data = payload.data || {};

    if (payload.event !== "charge.completed" || data.status !== "successful") {
      return json(200, { ok: true, ignored: "not a successful charge" });
    }

    // The same Flutterwave account may receive other payments
    // (your other products). Ignore anything that is not a book order.
    if (!String(data.tx_ref || "").startsWith("PRECIFIO-BOOK-")) {
      return json(200, { ok: true, ignored: "not a book order" });
    }

    const supabase = getSupabase();

    const { data: order } = await supabase
      .from("book_orders")
      .select("*")
      .eq("tx_ref", data.tx_ref)
      .maybeSingle();

    if (!order || order.status === "failed") {
      return json(200, { ok: true, ignored: "order not found" });
    }

    // 3. Do not trust the webhook body. Ask Flutterwave directly.
    const payment = await verifyFlutterwave(data.id);

    try {
      await confirmPaymentAndDeliver(supabase, order, payment);
    } catch (err) {
      if (err.code === "PAYMENT_MISMATCH" || err.code === "DIFFERENT_PAYMENT") {
        console.error("Webhook ignored:", err.code, data.tx_ref);
        return json(200, { ok: true, ignored: err.code });
      }

      // Activation or email problem: non-200 makes Flutterwave retry.
      console.error("Webhook delivery problem:", err.code || err);
      return json(500, { error: "Delivery failed, please retry." });
    }

    return json(200, { ok: true });

  } catch (error) {
    console.error("Book webhook error:", error);
    return json(500, { error: "Webhook failed." });
  }
};
