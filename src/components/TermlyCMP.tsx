"use client";

import Script from "next/script";

/**
 * Termly Consent Management Platform embed.
 * Follows Termly's official Next.js App Router pattern:
 *   https://support.termly.io/hc/en-us/articles/30710477395089
 *
 * Pass the website UUID via NEXT_PUBLIC_TERMLY_UUID. If unset, renders nothing
 * (so local dev / preview deploys don't break).
 */
export function TermlyCMP() {
  const uuid = process.env.NEXT_PUBLIC_TERMLY_UUID;
  if (!uuid) return null;

  return (
    <Script
      id="termly-jssdk"
      src={`https://app.termly.io/resource-blocker/${uuid}?autoBlock=on`}
      strategy="afterInteractive"
    />
  );
}
