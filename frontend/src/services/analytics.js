const CONSENT_KEY = "planify:analytics-consent";
const measurementId = process.env.REACT_APP_GA_MEASUREMENT_ID;
let loadPromise = null;

export const isAnalyticsConfigured = () => Boolean(measurementId);
export const hasAnalyticsConsent = () => localStorage.getItem(CONSENT_KEY) === "granted";

function sendPageView() {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", {
    page_title: document.title,
    page_location: window.location.href,
  });
}

export function startAnalytics() {
  if (!isAnalyticsConfigured() || !hasAnalyticsConsent()) return Promise.resolve(false);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.onload = () => {
      window.gtag("js", new Date());
      window.gtag("config", measurementId, { send_page_view: false });
      sendPageView();
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function setAnalyticsConsent(granted) {
  localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  return granted ? startAnalytics() : Promise.resolve(false);
}

export function trackEvent(name, parameters = {}) {
  if (!isAnalyticsConfigured() || !hasAnalyticsConsent() || typeof window.gtag !== "function") return;
  window.gtag("event", name, parameters);
}
