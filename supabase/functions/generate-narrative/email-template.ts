// score-engine — assessment result email template.
// Renders HTML for the email sent to leads after their narrative is generated.
//
// Design constraints:
//   - Inline styles only (most email clients strip <style> tags)
//   - Table-based outer layout for Outlook compatibility
//   - Max width 600px (standard email-safe width)
//   - Web fonts replaced with system font stack (most clients block @font-face)
//   - Light mode only (dark mode email is fragile across clients)
//
// Brand colors (kept in sync with the web app):
//   brand:      #ec6202 (CYRVANA orange)
//   navy:       #1A2332
//   navy-deep:  #0D1117

export type EmailRenderInput = {
  recipient_name: string | null;
  recipient_email: string;
  quiz_title: string;
  quiz_slug: string;
  score: number | null;
  tier_title: string | null;
  tier_description: string | null;
  tier_cta_label: string | null;
  tier_cta_url: string | null;
  narrative_body: string;
  results_page_url: string;
};

/**
 * Render the full HTML email body. Returns a string.
 * The text fallback (for clients that prefer plain text) is rendered separately.
 */
export function renderEmailHtml(input: EmailRenderInput): string {
  const greeting = input.recipient_name
    ? `Hi ${escapeHtml(input.recipient_name.split(/\s+/)[0])},`
    : "Hello,";

  // Convert the narrative into paragraphs.
  const narrativeParagraphs = input.narrative_body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p style="${P_STYLE}">${escapeHtml(p)}</p>`)
    .join("");

  // Tier and score badge.
  const tierBadge = input.tier_title
    ? `<span style="${BADGE_STYLE}">${escapeHtml(input.tier_title)}${
        input.score !== null ? ` · ${input.score} points` : ""
      }</span>`
    : "";

  // CTA — only render if both label and URL are present.
  const cta =
    input.tier_cta_label && input.tier_cta_url
      ? `
      <tr>
        <td align="center" style="padding: 16px 0 8px 0;">
          <a href="${escapeAttr(input.tier_cta_url)}" target="_blank" rel="noopener" style="${CTA_STYLE}">
            ${escapeHtml(input.tier_cta_label)}
          </a>
        </td>
      </tr>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(input.quiz_title)} · Your results</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif; color:#1A2332; line-height:1.55;">
  <!-- Hidden preheader, shown by some clients in the inbox preview -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    Your ${escapeHtml(input.quiz_title)} results from CYRVANA — including your personalized analysis.
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f7;">
    <tr>
      <td align="center" style="padding: 32px 16px;">

        <!-- Main content card -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05);">

          <!-- Header band -->
          <tr>
            <td style="background:#0D1117; padding:24px 32px;">
              <div style="font-size:13px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#ec6202;">CYRVANA</div>
              <div style="margin-top:4px; font-size:13px; color:rgba(255,255,255,0.7);">${escapeHtml(input.quiz_title)}</div>
            </td>
          </tr>

          <!-- Result tier -->
          <tr>
            <td style="padding: 32px 32px 8px 32px;">
              <h1 style="margin:0 0 16px 0; font-size:26px; font-weight:700; color:#1A2332; line-height:1.25;">Your results are in.</h1>
              <p style="margin:0 0 24px 0; font-size:16px; color:#1A2332;">${greeting}</p>
              ${tierBadge}
              ${
                input.tier_description
                  ? `<p style="${P_STYLE} margin-top:20px;">${escapeHtml(input.tier_description)}</p>`
                  : ""
              }
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 8px 32px;">
              <div style="height:1px; background:#e5e7eb;"></div>
            </td>
          </tr>

          <!-- Personalized analysis -->
          <tr>
            <td style="padding: 16px 32px 8px 32px;">
              <div style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#ec6202; margin-bottom:12px;">Your personalized analysis</div>
              ${narrativeParagraphs}
            </td>
          </tr>

          <!-- CTA -->
          ${cta}

          <!-- View on web link -->
          <tr>
            <td align="center" style="padding: 24px 32px 32px 32px;">
              <a href="${escapeAttr(input.results_page_url)}" target="_blank" rel="noopener" style="font-size:13px; color:#6b7280; text-decoration:underline;">View your results in the browser</a>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; margin-top:16px;">
          <tr>
            <td align="center" style="padding: 16px;">
              <p style="margin:0; font-size:12px; color:#6b7280; line-height:1.5;">
                You received this email because you completed an assessment at assess.cyrvana.com.<br />
                Replies to this email go to a real person at CYRVANA.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Render the plain-text fallback. Resend requires both for best deliverability.
 */
export function renderEmailText(input: EmailRenderInput): string {
  const greeting = input.recipient_name
    ? `Hi ${input.recipient_name.split(/\s+/)[0]},`
    : "Hello,";

  const tierLine =
    input.tier_title && input.score !== null
      ? `\nResult: ${input.tier_title} (${input.score} points)\n`
      : input.tier_title
        ? `\nResult: ${input.tier_title}\n`
        : "";

  const ctaLine =
    input.tier_cta_label && input.tier_cta_url
      ? `\n${input.tier_cta_label}: ${input.tier_cta_url}\n`
      : "";

  return [
    `Your ${input.quiz_title} results`,
    "",
    greeting,
    tierLine,
    input.tier_description ?? "",
    "",
    "── Your personalized analysis ──",
    "",
    input.narrative_body,
    "",
    ctaLine,
    `View in browser: ${input.results_page_url}`,
    "",
    "—",
    "CYRVANA · You received this email because you completed an assessment at assess.cyrvana.com.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

// ============================================================================
// Styles (inlined into the HTML at render time)
// ============================================================================

const P_STYLE =
  "margin:0 0 14px 0; font-size:16px; color:#1A2332; line-height:1.6;";

const BADGE_STYLE =
  "display:inline-block; padding:6px 14px; background:#ec620215; color:#ec6202; font-size:14px; font-weight:600; border-radius:999px;";

const CTA_STYLE =
  "display:inline-block; padding:14px 28px; background:#ec6202; color:#ffffff !important; font-size:15px; font-weight:600; text-decoration:none; border-radius:8px;";

// ============================================================================
// Escape helpers
// ============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  // For href/src attributes — same as HTML but also strip control characters.
  return escapeHtml(str).replace(/[\u0000-\u001F\u007F]/g, "");
}
