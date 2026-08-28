import type { ProductLabelDraft } from '@opendish/contracts';

import { supabase } from '@/lib/supabase';

export class ProductLabelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProductLabelError';
    this.code = code;
  }
}

interface ProductLabelResponse {
  draft: ProductLabelDraft;
  requiresConfirmation: true;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the label image.'));
    reader.readAsDataURL(file);
  });
}

export async function extractProductLabel(
  file: File,
): Promise<ProductLabelDraft> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new ProductLabelError(
      'invalid_image',
      'Choose a JPEG, PNG, or WebP image.',
    );
  }
  if (file.size > 7 * 1024 * 1024) {
    throw new ProductLabelError(
      'image_too_large',
      'The label image must be 7 MB or smaller.',
    );
  }
  const { data, error } = await supabase.functions.invoke<ProductLabelResponse>(
    'ai-extract-product-label',
    { body: { imageDataUrl: await fileToDataUrl(file) } },
  );
  if (error) {
    const context = error.context as
      { json?: () => Promise<unknown> } | undefined;
    const payload = context?.json
      ? await context.json().catch(() => null)
      : null;
    const details = (
      payload as { error?: { code?: string; message?: string } } | null
    )?.error;
    throw new ProductLabelError(
      details?.code ?? 'provider_error',
      details?.message ?? error.message,
    );
  }
  if (!data?.requiresConfirmation || !data.draft) {
    throw new ProductLabelError(
      'invalid_ai_output',
      'The label response was invalid.',
    );
  }
  return data.draft;
}
