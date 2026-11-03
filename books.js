
document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("bookCheckout");
    const form = document.getElementById("bookCheckoutForm");
    const emailInput = document.getElementById("bookCustomerEmail");
    const bookIdInput = document.getElementById("selectedBookId");
    const bookTitle = document.getElementById("selectedBookTitle");
    const submitButton = document.getElementById("bookCheckoutSubmit");
    const errorBox = document.getElementById("bookCheckoutError");
    const statusBox = document.getElementById("bookPaymentStatus");

    if (!modal || !form) return;

    function showModal(bookId, title) {
        bookIdInput.value = bookId;
        bookTitle.textContent = title;
        errorBox.textContent = "";

        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");

        emailInput.focus();
    }

    function closeModal() {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
    }

    document.querySelectorAll(".book-buy-button").forEach(button => {
        button.addEventListener("click", () => {
            showModal(
                button.dataset.bookId,
                button.dataset.bookTitle
            );
        });
    });

    document.getElementById("closeBookCheckout")
        ?.addEventListener("click", closeModal);

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeModal();
    });

    // Start Flutterwave checkout.
    form.addEventListener("submit", async event => {
        event.preventDefault();

        errorBox.textContent = "";

        const bookId = bookIdInput.value;
        const email = emailInput.value.trim();

        if (!bookId || !email) {
            errorBox.textContent =
                "Please select a book and enter your email.";
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Preparing secure checkout...";

        try {
            const response = await fetch(
                "/.netlify/functions/book-checkout",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        bookId,
                        email
                    })
                }
            );

            const result = await response.json();

            if (!response.ok || !result.checkout_url) {
                throw new Error(
                    result.error || "Could not start checkout."
                );
            }

            window.location.href = result.checkout_url;

        } catch (error) {
            errorBox.textContent =
                error.message || "Something went wrong.";

            submitButton.disabled = false;
            submitButton.textContent =
                "Continue to Secure Payment";
        }
    });

    // Handle the Flutterwave redirect.
    async function verifyReturnedPayment() {
        const params = new URLSearchParams(window.location.search);

        const txRef = params.get("tx_ref");
        const transactionId = params.get("transaction_id");
        const paymentStatus = params.get("status");

        if (!txRef) return;

        closeModal();

        statusBox.hidden = false;
        statusBox.classList.remove("error");

        if (paymentStatus !== "successful" || !transactionId) {
            statusBox.classList.add("error");
            statusBox.textContent =
                "Payment was not completed. You can return to the books page and try again.";
            history.replaceState({}, "", window.location.pathname);
            return;
        }

        statusBox.textContent =
            "Payment received. Verifying your transaction with Flutterwave...";

        try {
            const response = await fetch(
                "/.netlify/functions/book-verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        tx_ref: txRef,
                        transaction_id: transactionId
                    })
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error || "Payment verification failed."
                );
            }

            statusBox.textContent =
                "Your payment has been confirmed! " +
                "Your ebook access link has been sent to your email. " +
                "Please check your inbox and spam folder.";

            history.replaceState({}, "", window.location.pathname);

        } catch (error) {
            statusBox.classList.add("error");

            statusBox.textContent =
                error.message +
                " If you were charged, do not pay again. " +
                "Refresh this page to retry verification, or contact hello@precifio.app.";

            // Keep the callback parameters so refreshing the page
            // can retry verification and email delivery.
        }
    }

    verifyReturnedPayment();
});
