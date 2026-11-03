
const {
  BOOKS,
  getSupabase,
  json,
  parseBody
} = require("./_books");

const crypto = require("crypto");

exports.handler = async event => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const { bookId, email } = parseBody(event);

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

    const supabase = getSupabase();

    const txRef = `PRECIFIO-BOOK-${crypto.randomUUID()}`;

    const { data: order, error: orderError } = await supabase
      .from("book_orders")
      .insert({
        book_id: bookId,
        book_title: book.title,
        email: customerEmail,
        amount: book.price,
        currency: book.currency,
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
          amount: book.price,
          currency: book.currency,
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
