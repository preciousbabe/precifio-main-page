
const {
  getSupabase,
  json,
  parseBody,
  verifyFlutterwave,
  sendAccessEmail
} = require("./_books");

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

    // Independently verify the transaction with Flutterwave.
    const payment = await verifyFlutterwave(transaction_id);

    const correctReference = payment.tx_ref === order.tx_ref;
    const correctStatus = payment.status === "successful";
    const correctCurrency =
      String(payment.currency).toUpperCase() === order.currency;

    const correctAmount =
      Number(payment.amount) >= Number(order.amount);

    const returnedEmail = String(
      payment.customer?.email || ""
    ).trim().toLowerCase();

    const correctEmail =
      !returnedEmail || returnedEmail === order.email.toLowerCase();

    if (
      !correctReference ||
      !correctStatus ||
      !correctCurrency ||
      !correctAmount ||
      !correctEmail
    ) {
      console.error("Payment validation mismatch:", {
        correctReference,
        correctStatus,
        correctCurrency,
        correctAmount,
        correctEmail
      });

      return json(400, {
        error: "Payment could not be confirmed. Please contact support if you were charged."
      });
    }

    // Mark the order as paid.
    if (order.status !== "paid") {
      const { error: updateError } = await supabase
        .from("book_orders")
        .update({
          status: "paid",
          flutterwave_transaction_id: String(payment.id),
          paid_at: new Date().toISOString()
        })
        .eq("id", order.id)
        .eq("status", "pending");

      if (updateError) {
        console.error("Order update error:", updateError);

        return json(500, {
          error: "Payment was verified but purchase activation failed. Contact support."
        });
      }

      // Confirm that the update succeeded or another request
      // already completed the same order.
      const { data: updatedOrder } = await supabase
        .from("book_orders")
        .select("status")
        .eq("id", order.id)
        .single();

      if (updatedOrder?.status !== "paid") {
        return json(500, {
          error: "Could not activate your purchase."
        });
      }
    } else if (
      order.flutterwave_transaction_id &&
      String(order.flutterwave_transaction_id) !== String(payment.id)
    ) {
      return json(400, {
        error: "This order is associated with a different payment."
      });
    }

    // The signed access link is deterministic for this order.
    // Therefore, the email can be sent again if the customer
    // retries this verification after an email delivery failure.
    try {
      await sendAccessEmail(order);
    } catch (emailError) {
      console.error("Book delivery email error:", emailError);

      return json(502, {
        error: "Your payment is confirmed, but we could not send the access email. Please retry verification or contact hello@precifio.app."
      });
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
