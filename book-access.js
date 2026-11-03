
document.addEventListener("DOMContentLoaded", () => {
    const message = document.getElementById("accessMessage");
    const loader = document.getElementById("accessLoader");
    const retryButton = document.getElementById("retryAccess");

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    let deviceId = null;

    function showError(text) {
        loader.hidden = true;
        message.textContent = text;
        retryButton.hidden = false;
    }

    function getDeviceId(orderId) {
        const storageKey = `precifio-book-device-${orderId}`;

        let id = localStorage.getItem(storageKey);

        if (!id) {
            id = crypto.randomUUID();

            localStorage.setItem(storageKey, id);
        }

        return id;
    }

    async function downloadBook() {
        retryButton.hidden = true;
        loader.hidden = false;

        message.textContent =
            "Verifying your purchase and device...";

        if (!token) {
            showError(
                "Your access link is missing or incomplete. Please use the link sent to your purchase email."
            );
            return;
        }

        const orderId = token.split(".")[0];

        try {
            deviceId = getDeviceId(orderId);
        } catch (error) {
            showError(
                "Your browser could not save the device registration. Please enable local storage and try again."
            );
            return;
        }

        try {
            const response = await fetch(
                "/.netlify/functions/book-download",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        token,
                        deviceId
                    })
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error || "Access could not be authorized."
                );
            }

            message.textContent =
                "Your purchase is verified. Your ebook download is starting...";

            loader.hidden = true;

            // Remove the access token from the visible address bar.
            history.replaceState(
                {},
                "",
                window.location.pathname
            );

            // Redirect to the temporary private EPUB download URL.
            window.location.assign(result.download_url);

        } catch (error) {
            showError(
                error.message ||
                "Something went wrong. Please try again."
            );
        }
    }

    retryButton.addEventListener("click", downloadBook);

    downloadBook();
});
