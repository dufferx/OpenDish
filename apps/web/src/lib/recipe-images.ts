import { supabase } from '@/lib/supabase';

export const RECIPE_IMAGES_BUCKET = 'recipe-images';

/** Signed URLs for the private bucket expire after one hour (R11). */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type ImageValidationResult =
  { ok: true } | { ok: false; reason: string };

/** Client-side guard before any upload attempt (FR image handling edge case). */
export function validateRecipeImage(file: File): ImageValidationResult {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, reason: 'Please choose a JPEG, PNG, or WebP image.' };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, reason: 'Image must be 5 MB or smaller.' };
  }
  return { ok: true };
}

/**
 * Upload a recipe image to the private bucket. The path follows
 * `{user_id}/{recipe_id}/{filename}` so the storage RLS policy can enforce
 * ownership. Returns the object path on success.
 */
export async function uploadRecipeImage(
  file: File,
  recipeId: string,
): Promise<string> {
  const validation = validateRecipeImage(file);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('You must be signed in to upload images.');
  }

  const extension = file.name.split('.').pop() ?? 'jpg';
  const path = `${user.id}/${recipeId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(RECIPE_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error(`Image upload failed: ${error.message}`);
  }
  return path;
}

/**
 * Create a short-lived signed URL for an object in the private
 * `recipe-images` bucket. Returns `null` when the object is missing or
 * unreadable — images are optional, so callers render a fallback instead
 * of an error page.
 */
export async function getRecipeImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECIPE_IMAGES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}
