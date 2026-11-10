const {
  getSupabase,
  json,
  parseBody,
  verifyFlutterwave,
  confirmPaymentAndDeliver
} = require("./_books");

// Called by books.html when the buyer returns from Flutterwave.
exports.handler = async event => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const { tx_ref, transaction_id } = parseBody(event);

    if (!tx_ref || !transaction_id) {
      return json(400, {
        error: "Missing payment reference or transaction ID."
      });
    }

    const supabase = getSupabase();

    const { data: order, error } = await supabase
      .from("book_orders")
      .select("*")
      .eq("tx_ref", tx_ref)
      .maybeSingle();

    if (error || !order) {
      return json(404, { error: "Purchase not found." });
    }

    if (order.status === "failed") {
      return json(400, { error: "This order is no longer valid." });
    }

    // Ask Flutterwave directly. Never trust the browser.
    const payment = await verifyFlutterwave(transaction_id);

    try {
      await confirmPaymentAndDeliver(supabase, order, payment);
    } catch (err) {
      if (err.code === "PAYMENT_MISMATCH") {
        return json(400, {
          error: "Payment could not be confirmed. Please contact support if you were charged."
        });
      }

      if (err.code === "DIFFERENT_PAYMENT") {
        return json(400, {
          error: "This order is associated with a different payment."
        });
      }

      if (err.code === "EMAIL_FAILED") {
        return json(502, {
          error: "Your payment is confirmed, but we could not send the access email. Please refresh to retry or contact hello@precifio.app."
        });
      }

      if (err.code === "ACTIVATION_FAILED") {
        return json(500, {
          error: "Payment was verified but purchase activation failed. Contact support."
        });
      }

      throw err;
    }

    return json(200, {
      ok: true,
      message: "Payment confirmed. Check your email for your ebook access link."
    });

  } catch (error) {
    console.error("Book verification error:", error);

    return json(500, {
      error: "Could not verify your payment. Please contact support if you were charged."
    });
  }
};
