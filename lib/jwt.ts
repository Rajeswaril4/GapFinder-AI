// JWT (JSON Web Token) generation and verification utility for GapFinder AI.
// Works seamlessly in server and edge runtimes with zero external dependencies.

import crypto from "crypto";

const DEFAULT_SECRET =
  process.env.JWT_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "gapfinder-ai-jwt-secret-key-2026";

export interface JwtPayload {
  id: string;
  email: string;
  name?: string;
  role?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface JwtVerifyResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64").toString("utf-8");
}

/**
 * Creates a signed JWT token with HS256 algorithm.
 * @param payload Data payload to encode into the token
 * @param secret Optional secret override (falls back to JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY)
 * @param expiresInSeconds Expiration duration in seconds (default: 7 days = 604,800 seconds)
 */
export function signJwt(
  payload: JwtPayload,
  secret: string = DEFAULT_SECRET,
  expiresInSeconds: number = 7 * 24 * 60 * 60
): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies a JWT token's signature and expiration time.
 */
export function verifyJwt(token: string, secret: string = DEFAULT_SECRET): JwtVerifyResult {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Token is required" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed JWT token" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (signatureB64 !== expectedSignature) {
      return { valid: false, error: "Invalid token signature" };
    }

    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson) as JwtPayload;

    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, error: "Token has expired", payload };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: (err as Error).message || "Token verification failed" };
  }
}

/**
 * Decodes a JWT token without verifying its signature.
 */
export function decodeJwt(token: string): { header?: unknown; payload?: JwtPayload } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * Extracts Bearer token from Request headers or cookies.
 */
export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/gapfinder_jwt=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }

  return null;
}
