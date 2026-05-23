"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================================
// Create document (upload file to Supabase Storage + save record)
// ============================================================================
export type CreateDocumentResult =
  | { ok: true; document_id: string }
  | { ok: false; error: string };

export async function createDocument(
  formData: FormData,
): Promise<CreateDocumentResult> {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const file = formData.get("file") as File | null;
  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const accessLevel = String(formData.get("access_level") ?? "email_gated");
  const isDirectAccessible = formData.get("is_direct_accessible") === "true";

  if (!title) return { ok: false, error: "Title is required." };
  if (!slug) return { ok: false, error: "Slug is required." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: "Slug must be lowercase letters, numbers, and hyphens only." };
  }
  if (!file || file.size === 0) return { ok: false, error: "A file is required." };
  if (file.type !== "application/pdf") {
    return { ok: false, error: "Only PDF files are supported." };
  }
  if (file.size > 50 * 1024 * 1024) {
    return { ok: false, error: "File must be under 50MB." };
  }
  if (!["public", "email_gated", "paid"].includes(accessLevel)) {
    return { ok: false, error: "Invalid access level." };
  }

  // Check slug uniqueness.
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { ok: false, error: "A document with this slug already exists." };

  // Choose bucket based on access level.
  const bucket = accessLevel === "public" ? "documents-public" : "documents-gated";
  const storagePath = `${slug}.pdf`;

  // Upload to Supabase Storage.
  const fileBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    if (uploadErr.message.includes("already exists")) {
      return { ok: false, error: "A file with this slug already exists in storage. Use a different slug." };
    }
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  // Save document record.
  const { data: doc, error: dbErr } = await supabase
    .from("documents")
    .insert({
      workspace_id: WORKSPACE_ID,
      title,
      slug,
      description: description || null,
      storage_path: storagePath,
      bucket,
      access_level: accessLevel,
      is_direct_accessible: isDirectAccessible,
      is_active: true,
    })
    .select("id")
    .single();

  if (dbErr || !doc) {
    // Roll back the storage upload.
    await supabase.storage.from(bucket).remove([storagePath]);
    return { ok: false, error: `Failed to save document record: ${dbErr?.message ?? "unknown"}` };
  }

  revalidatePath("/admin/documents");
  return { ok: true, document_id: doc.id };
}

// ============================================================================
// Toggle document active/inactive
// ============================================================================
export async function setDocumentActive(
  docId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("documents")
    .update({ is_active: active })
    .eq("id", docId)
    .eq("workspace_id", WORKSPACE_ID);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/documents");
  return { ok: true };
}

// ============================================================================
// Delete document
// ============================================================================
export async function deleteDocument(
  docId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  // Check for access grants.
  const { count } = await supabase
    .from("document_access")
    .select("id", { count: "exact", head: true })
    .eq("document_id", docId);

  if (count && count > 0) {
    return {
      ok: false,
      error: `Cannot delete — ${count} lead(s) have accessed this document. Deactivate it instead.`,
    };
  }

  const { data: doc } = await supabase
    .from("documents")
    .select("bucket, storage_path")
    .eq("id", docId)
    .eq("workspace_id", WORKSPACE_ID)
    .single();

  if (!doc) return { ok: false, error: "Document not found." };

  // Delete from storage first.
  await supabase.storage.from(doc.bucket).remove([doc.storage_path]);

  // Delete record.
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", docId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/documents");
  return { ok: true };
}

// ============================================================================
// Attach/detach document to/from a result tier
// ============================================================================
export async function attachDocumentToTier(
  tierId: string,
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("tier_documents")
    .upsert({ tier_id: tierId, document_id: documentId }, { ignoreDuplicates: true });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/documents");
  revalidatePath("/admin/quizzes");
  return { ok: true };
}

export async function detachDocumentFromTier(
  tierId: string,
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("tier_documents")
    .delete()
    .eq("tier_id", tierId)
    .eq("document_id", documentId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/documents");
  revalidatePath("/admin/quizzes");
  return { ok: true };
}
