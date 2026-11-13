import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Attach the authenticated user's bearer token to all same-origin API calls.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  let user = null;
  try {
    user = JSON.parse(window.localStorage.getItem("user") || "null");
  } catch (_error) {
    // Recover from manually edited/corrupted browser storage instead of crashing every request.
    window.localStorage.removeItem("user");
  }
  const token = user && user.token;
  const url = typeof input === "string" ? input : input.url;
  const isSameOrigin = url && !/^https?:\/\//i.test(url);
  if (!token || !isSameOrigin) return nativeFetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${token}`);
  return nativeFetch(input, { ...init, headers }).then((response) => {
    if (response.status === 401 && window.localStorage.getItem("user")) {
      window.localStorage.removeItem("user");
      window.dispatchEvent(new Event("planify:unauthorized"));
    }
    return response;
  });
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
