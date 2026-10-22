import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { getDb } from "./db";

export type SessionUser = { id: number; username: string };

type UserRow = { id: number; username: string; password_hash: string };

const COOKIE = "ufc_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secret(): string {
  const file = path.join(process.cwd(), "data", "session.secret");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString("hex"));
  return fs.readFileSync(file, "utf8");
}

export function usernameKey(username: string): string {
  return username.normalize("NFC").trim().toLowerCase();
}

export function validUsername(username: string): boolean {
  return /^[\p{L}\p{N}_]{2,20}$/u.test(username.normalize("NFC").trim());
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string): string {
  const mac = createHmac("sha256", secret()).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function unsign(token: string): string | null {
  const index = token.lastIndexOf(".");
  if (index <= 0) return null;
  const value = token.slice(0, index);
  const mac = token.slice(index + 1);
  const expected = createHmac("sha256", secret()).update(value).digest("base64url");
  const actualBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return value;
}

export async function setSession(userId: number): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + THIRTY_DAYS * 1000 })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, sign(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const payload = unsign(token);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: number; exp?: number };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    const user = getDb().prepare("SELECT id, username FROM users WHERE id = ?").get(parsed.uid) as
      | { id: number; username: string }
      | undefined;
    return user ?? null;
  } catch {
    return null;
  }
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare("SELECT id, username, password_hash FROM users WHERE username_key = ?").get(usernameKey(username)) as
    | UserRow
    | undefined;
}
