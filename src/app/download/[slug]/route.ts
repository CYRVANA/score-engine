import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Branded download proxy at /download/[slug].
 *
 * Logs an anonymous (or identified) download event, then 302-redirects
 * to the actual file URL (public or signed Supabase Storage URL).
 *
 * Why redirect instead of streaming: Netlify functions cap response size
 * at ~6MB. Streaming a 50MB PDF through the function would fail. Redirecting
 * keeps the branded URL (assess.cyrvana.com/download/[slug]) as the link
 * people share and bookmark, logs the event server-side, and lets Supabase's
 * CDN serve the actual bytes without a size ceiling.
 *
 * Public docs:  /download/[slug]
 * Gated docs:   /download/[slug]?s=<lead_id>
 *
 * UTM params on the URL (?utm_source=linkedin&...) are captured for analytics.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = createServiceRoleClient();
  const searchParams = request.nextUrl.searchParams;

  // Load the document.
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, title, slug, bucket, storage_path, access_level, is_active, workspace_id")
    .eq("slug", slug)
    .single();

  if (error || !doc || !doc.is_active) {
    return new NextResponse("Document not found.", { status: 404 });
  }

  const leadId = searchParams.get("s");
  const isGated = doc.access_level !== "public";

  // For gated documents, verify the lead has an access grant.
  if (isGated) {
    if (!leadId) {
      return new NextResponse(
        "This resource requires access. Please submit the form to download.",
        { status: 403 },
      );
    }
    const { data: access } = await supabase
      .from("document_access")
      .select("id, expires_at")
      .eq("lead_id", leadId)
      .eq("document_id", doc.id)
      .maybeSingle();

    if (!access) {
      return new NextResponse("Access denied.", { status: 403 });
    }
    if (access.expires_at && new Date(access.expires_at) < new Date()) {
      return new NextResponse("Your access link has expired.", { status: 403 });
    }
  }

  // Log the download event (best-effort — never block the download on logging).
  try {
    await supabase.from("document_downloads").insert({
      document_id: doc.id,
      workspace_id: doc.workspace_id,
      is_gated: isGated,
      lead_id: isGated ? leadId : null,
      referrer: request.headers.get("referer"),
      utm_source: searchParams.get("utm_source"),
      utm_medium: searchParams.get("utm_medium"),
      utm_campaign: searchParams.get("utm_campaign"),
    });
  } catch (logErr) {
    console.error("[download] failed to log event", logErr);
  }

  // Resolve the target file URL.
  let targetUrl: string | null = null;

  if (doc.access_level === "public") {
    const { data } = supabase.storage.from(doc.bucket).getPublicUrl(doc.storage_path);
    targetUrl = data.publicUrl;
  } else {
    const { data: signed, error: signErr } = await supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.storage_path, 86400);
    if (!signErr && signed) {
      targetUrl = signed.signedUrl;
    }
  }

  if (!targetUrl) {
    return new NextResponse("File temporarily unavailable. Please try again.", {
      status: 502,
    });
  }

  // 302 redirect to the actual file.
  return NextResponse.redirect(targetUrl, { status: 302 });
}
