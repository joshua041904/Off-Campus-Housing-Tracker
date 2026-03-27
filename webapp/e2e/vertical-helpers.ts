import { e2eApiBase } from "./helpers";

/** Full edge URL for a path (must start with /). */
export function edgePath(p: string): string {
  const base = e2eApiBase().replace(/\/$/, "");
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${base}${path}`;
}

export const invalidJwt = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid";
