
const {
  BOOKS,
  getSupabase,
  json,
  parseBody,
  hash,
  verifyAccessToken
} = require("./_books");

exports.handler = async event => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const { token, deviceId } = parseBody(event);

    if (
      !token ||
      typeof deviceId !== "string" ||
      deviceId.length < 16 ||
      deviceId.length > 200
    ) {
      return json(400, {
        error: "Invalid access information."
      });
    }

    const orderId = token.split(".")[0];

    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return json(400, { error: "Invalid access link." });
    }

    const supabase = getSupabase();

    const { data: order, error } = await supabase
      .from("book_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) {
      return json(404, { error: "Purchase not found." });
    }

    if (order.status !== "paid") {
      return json(403, {
        error: "This purchase has not been confirmed."
      });
    }

    if (!verifyAccessToken(token, order)) {
      return json(403, {
        error: "Invalid or unauthorized access link."
      });
    }

    const book = BOOKS[order.book_id];

    if (!book) {
      return json(404, { error: "Book not found." });
    }

    const deviceHash = hash(deviceId);

    // First successful device claims the purchase.
    if (!order.device_token_hash) {
      const { data: claimed, error: claimError } = await supabase
        .from("book_orders")
        .update({
          device_token_hash: deviceHash,
          device_registered_at: new Date().toISOString()
        })
        .eq("id", order.id)
        .is("device_token_hash", null)
        .select("id")
        .maybeSingle();

      if (claimError) {
        console.error("Device registration error:", claimError);

        return json(500, {
          error: "Could not register this device."
        });
      }

      // Another request may have claimed the device first.
      if (!claimed) {
        const { data: refreshed } = await supabase
          .from("book_orders")
          .select("device_token_hash")
          .eq("id", order.id)
          .single();

        if (!refreshed ||
            refreshed.device_token_hash !== deviceHash) {
          return json(403, {
            error: "This purchase is already registered to another device. Contact Precifio support if you need to change devices."
          });
        }
      }
    } else if (order.device_token_hash !== deviceHash) {
      return json(403, {
        error: "This ebook is registered to another device. Contact hello@precifio.app if you need assistance."
      });
    }

    // Generate a short-lived private download link.
    const { data: signed, error: storageError } = await supabase
      .storage
      .from("precifio-books")
      .createSignedUrl(
        book.file,
        60,
        { download: book.file }
      );

    if (storageError || !signed?.signedUrl) {
      console.error("Storage error:", storageError);

      return json(500, {
        error: "Could not prepare your ebook download."
      });
    }

    await supabase
      .from("book_orders")
      .update({
        download_count: order.download_count + 1
      })
      .eq("id", order.id);

    return json(200, {
      ok: true,
      download_url: signed.signedUrl,
      book_title: book.title
    });

  } catch (error) {
    console.error("Book download error:", error);

    return json(500, {
      error: "Could not authorize your ebook download."
    });
  }
};
