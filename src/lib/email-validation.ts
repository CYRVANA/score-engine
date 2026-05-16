/**
 * Email validation utilities. Pure functions; no I/O.
 *
 * Used server-side in captureLead to validate lead-gate submissions before
 * inserting into the leads table. Also used client-side for the snappy
 * format-error feedback in EmailGate.
 */

/**
 * Curated list of common disposable / throwaway email domains.
 * Strict default per Phase 1.4 decision — leans toward false positives over false negatives.
 *
 * Maintenance: when you find a junk lead that slipped through, add the domain here.
 * When a legitimate lead complains they were blocked, remove it.
 */
const DISPOSABLE_DOMAINS = new Set([
  // Mailinator family
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  // Guerrilla Mail
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "sharklasers.com",
  "grr.la",
  // 10MinuteMail and family
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  // TempMail family
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailaddress.com",
  // Yopmail
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  // Throwaway / disposable services
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "dispostable.com",
  "fakeinbox.com",
  "fake-mail.net",
  "getairmail.com",
  "getnada.com",
  "maildrop.cc",
  "spam4.me",
  "spamgourmet.com",
  // Mailtrap / testing
  "mailtrap.io",
]);

export type EmailValidationResult =
  | { ok: true }
  | { ok: false; reason: "format" | "disposable" };

/**
 * Validate an email address: format + disposable-domain check.
 * Domain comparison is case-insensitive.
 */
export function validateEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  // RFC-pragmatic format check. Not strictly RFC 5322 but covers ~99.9% of real emails.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, reason: "format" };
  }

  const domain = trimmed.split("@")[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: "disposable" };
  }

  return { ok: true };
}

/**
 * For surfacing to the user. Don't reveal which exact rule fired — just a hint.
 */
export function emailValidationMessage(reason: "format" | "disposable"): string {
  switch (reason) {
    case "format":
      return "Please enter a valid email address.";
    case "disposable":
      return "Please use a permanent email address (work email preferred).";
  }
}
