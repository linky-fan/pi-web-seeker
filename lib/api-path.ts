"use client";

function normalizeApiPath(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return clean.startsWith("api/") ? clean : `api/${clean}`;
}

export function apiPath(path: string): string {
  const normalized = normalizeApiPath(path);
  if (typeof window === "undefined") return normalized;

  const pathname = window.location.pathname;
  if (!pathname || pathname === "/") return normalized;

  const base = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${base}${normalized}`;
}
