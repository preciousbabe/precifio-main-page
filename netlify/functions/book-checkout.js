const {
  BOOKS,
  getSupabase,
  json,
  parseBody
} = require("./_books");

const crypto = require("crypto");

// Asks Flutterwave what `amount` of `from` is worth in `to`.
// Returns the converted amount as a number, or null on any failure.
async function getConvertedAmount(from, to, amount) {
  try {
    const response = await fetch(
      `https://api.flutterwave.com/v3/transfers/rates?amount=${amount}&source_currency=${from}&destination_currency=${to}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const body = await response.json();

    if (!response.ok || body.status !== "success") {
      console.error("Flutterwave rate lookup failed:", body);
      return null;
    }

    const destination = Number(body.data?.destination?.amount);
    if (Number.isFinite(destination) && destination > 0) return destination;

    const rate = Number(body.data?.rate);
    if (Number.isFinite(rate) && rate > 0) return amount * rate;

    return null;
  } catch (error) {
    console.error("Flutterwave rate lookup error:", error);
    return null;
  }
}

exports.handler = async event => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const { bookId, email, currency: requestedCurrency } = parseBody(event);

    const book = BOOKS[bookId];

    if (!book) {
      return json(400, { error: "Invalid book selected." });
    }

    const customerEmail = String(email || "")
      .trim()
      .toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(customerEmail)) {
      return json(400, { error: "Enter a valid email address." });
    }

    // Price is fixed in USD. Customers may pay in USD or in NGN,
    // where the NGN amount is converted from the USD price.
    const currency = String(requestedCurrency || "USD").toUpperCase();

    if (!["USD", "NGN"].includes(currency)) {
      return json(400, { error: "Unsupported currency." });
    }

    let chargeAmount = book.price;

    if (currency === "NGN") {
      const fallbackRate = Number(process.env.USD_NGN_RATE);
      const hasFallback = Number.isFinite(fallbackRate) && fallbackRate > 0;

      // Prefer Flutterwave's live rate; fall back to USD_NGN_RATE if set.
      let converted = await getConvertedAmount("USD", "NGN", book.price);

      // Sanity check: ignore a live rate that is wildly different
      // from the fallback rate (guards against bad API data).
      if (converted && hasFallback) {
        const expected = book.price * fallbackRate;
        if (converted < expected * 0.7 || converted > expected * 1.3) {
          console.error("Live NGN rate looks off:", { converted, expected });
          converted = null;
        }
      }

      if (!converted && hasFallback) {
        converted = book.price * fallbackRate;
      }

      if (!converted) {
        console.error("No usable USD->NGN rate available.");
        return json(500, {
          error: "Naira payment is temporarily unavailable. Please pay in USD."
        });
      }

      // Round up to the nearest N50 for a clean amount.
      chargeAmount = Math.ceil(converted / 50) * 50;
    }

    const supabase = getSupabase();

    const txRef = `PRECIFIO-BOOK-${crypto.randomUUID()}`;

    const { data: order, error: orderError } = await supabase
      .from("book_orders")
      .insert({
        book_id: bookId,
        book_title: book.title,
        email: customerEmail,
        amount: chargeAmount,
        currency,
        tx_ref: txRef,
        status: "pending"
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      return json(500, { error: "Could not create your order." });
    }

    const siteUrl = (
      process.env.SITE_URL || "https://precifio.app"
    ).replace(/\/$/, "");

    const paymentResponse = await fetch(
      "https://api.flutterwave.com/v3/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tx_ref: txRef,
          amount: chargeAmount,
          currency,
          payment_options:
            currency === "NGN"
              ? "card,banktransfer,ussd"
              : "card",
          redirect_url: `${siteUrl}/books.html`,
          customer: {
            email: customerEmail
          },
          customizations: {
            title: "Precifio Books",
            description: `${book.title} - ${book.volume}`,
            logo: `${siteUrl}/assets/logo.png`
          },
          meta: {
            order_id: order.id,
            book_id: bookId
          }
        })
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok ||
        payment.status !== "success" ||
        !payment.data?.link) {

      await supabase
        .from("book_orders")
        .update({ status: "failed" })
        .eq("id", order.id);

      console.error("Flutterwave checkout error:", payment);

      return json(502, {
        error: "Could not start payment. Please try again."
      });
    }

    return json(200, {
      ok: true,
      checkout_url: payment.data.link
    });

  } catch (error) {
    console.error("Book checkout error:", error);

    return json(500, {
      error: "Something went wrong while preparing checkout."
    });
  }
};