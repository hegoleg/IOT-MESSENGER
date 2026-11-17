import { initFlasher } from "./flasher.js";

const navToggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("site-nav");

function setNav(open) {
  navToggle?.setAttribute("aria-expanded", String(open));
  navToggle?.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
  document.body.classList.toggle("nav-open", open);
}

navToggle?.addEventListener("click", () => {
  const open = navToggle.getAttribute("aria-expanded") === "true";
  setNav(!open);
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setNav(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setNav(false);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 820) setNav(false);
});

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const targetId = button.getAttribute("data-copy");
    const code = targetId ? document.getElementById(targetId) : null;
    if (!code) return;

    const ok = await copyText(code.innerText);
    const original = button.textContent;
    button.textContent = ok ? "Скопировано" : "Не удалось";
    button.classList.toggle("is-ok", ok);

    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("is-ok");
    }, 1600);
  });
});

const revealElements = document.querySelectorAll(".reveal");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if ("IntersectionObserver" in window && !reducedMotion) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  revealElements.forEach((element) => observer.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

initFlasher();

// The PWA is published next to the landing (e.g. /app/). Resolve the link
// relative to the current deployment so subfolder hosting keeps working.
document.querySelectorAll("[data-app-link]").forEach((link) => {
  try {
    const configured = (link.getAttribute("data-app-url") || "").trim();
    const target = configured || new URL("app/", window.location.href).toString();
    link.setAttribute("href", target);
  } catch {
    // Keep the static href.
  }
});
