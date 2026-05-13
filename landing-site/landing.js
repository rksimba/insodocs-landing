const waitlistForms = document.querySelectorAll("[data-waitlist-form]");

waitlistForms.forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const existing = JSON.parse(localStorage.getItem("insodocsWaitlist") || "[]");
    existing.push({ ...data, createdAt: new Date().toISOString() });
    localStorage.setItem("insodocsWaitlist", JSON.stringify(existing));

    const success = form.querySelector(".form-success");
    if (success) {
      success.textContent = "You are on the waitlist. We will be in touch with pilot access details.";
      success.classList.add("visible");
    }
    form.reset();
  });
});
