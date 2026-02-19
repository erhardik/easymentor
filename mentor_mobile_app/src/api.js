import { DEFAULT_API_BASE_URL } from "./constants";

let apiBaseUrl = DEFAULT_API_BASE_URL;

export function setApiBaseUrl(url) {
  apiBaseUrl = (url || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

async function request(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.msg || "Request failed");
  }
  return data;
}

export function login(mentor, password) {
  return request("/api/mobile/login/", {
    method: "POST",
    body: JSON.stringify({ mentor, password }),
  });
}

export function logout(token) {
  return request("/api/mobile/logout/", { method: "POST", body: "{}" }, token);
}

export function getWeeks(token) {
  return request("/api/mobile/weeks/", { method: "GET" }, token);
}

export function getCalls(token, week) {
  return request(`/api/mobile/calls/?week=${week}`, { method: "GET" }, token);
}

export function saveCall(token, payload) {
  return request(
    "/api/mobile/save-call/",
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export function getRetryList(token, week) {
  return request(`/api/mobile/retry-list/?week=${week}`, { method: "GET" }, token);
}

export function markMessage(token, id) {
  return request(
    "/api/mobile/mark-message/",
    { method: "POST", body: JSON.stringify({ id }) },
    token
  );
}
