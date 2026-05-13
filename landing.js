const waitlistForms = document.querySelectorAll("[data-waitlist-form]");
const waitlistEndpoint =
  document.querySelector('meta[name="waitlist-endpoint"]')?.content || "/api/waitlist";

waitlistForms.forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const success = form.querySelector(".form-success");
    const data = Object.fromEntries(new FormData(form).entries());
    data.pageUrl = window.location.href;

    if (button) {
      button.disabled = true;
      button.textContent = "Joining...";
    }

    try {
      const response = await fetch(waitlistEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to submit waitlist form.");

      if (success) {
        success.textContent =
          "You are on the waitlist. We will be in touch with pilot access details.";
        success.classList.add("visible");
      }
      form.reset();
    } catch (error) {
      const existing = JSON.parse(localStorage.getItem("insodocsWaitlistBackup") || "[]");
      existing.push({ ...data, createdAt: new Date().toISOString(), error: error.message });
      localStorage.setItem("insodocsWaitlistBackup", JSON.stringify(existing));
      if (success) {
        success.textContent =
          "We could not reach the waitlist service just now. Your details are saved in this browser and we will retry shortly.";
        success.classList.add("visible");
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Join the waitlist";
      }
    }
  });
});
