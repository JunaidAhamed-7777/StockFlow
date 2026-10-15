import axios, { type AxiosResponse } from "axios";
import { TOKEN_KEY, readStorage, expireSession } from "../utils/storage";

function normalizeApiBase(value: unknown): string {
  return String(value || "http://localhost:3001/api")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/api$/i, "/api");
}

const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
const apiBase = new URL(API_BASE_URL, window.location.origin);
const apiOrigin = apiBase.origin;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  // Never attach this application's bearer token to an arbitrary absolute URL.
  const target = new URL(config.url || "", `${apiBase.href.replace(/\/$/, "")}/`);
  if (target.origin !== apiOrigin) {
    return Promise.reject(new Error("The API request must use the configured StockFlow server."));
  }
  const token = readStorage<string>(TOKEN_KEY);
  if (typeof token === "string" && token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const path = String(error.config?.url || "").split("?")[0];
      const isPublicHandshake = /\/auth\/(login|register)$/.test(path);
      // Ignore a response that belonged to a previous, already replaced session.
      const sentToken = error.config?.headers?.Authorization;
      const currentToken = readStorage<string>(TOKEN_KEY);
      if (!isPublicHandshake && currentToken && sentToken === `Bearer ${currentToken}`) expireSession();
    }
    return Promise.reject(error);
  }
);

export function unwrap<T = unknown>(response: AxiosResponse<T | { data: T }>): T {
  const body = response.data;
  return body && typeof body === "object" && "data" in body ? body.data : body as T;
}

export async function getHealth(): Promise<{ success?: boolean }> {
  const response = await api.get<{ success?: boolean }>("/health");
  return response.data;
}
