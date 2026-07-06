import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

// gpt-image-1 can only output 1024x1024 (1:1), 1024x1536 (2:3) or 1536x1024
// (3:2), never a true 16:9. Full-slide deck images are generated at 1536x1024
// (3:2), while PPTX/PDF slides are 16:9 (13.33in x 7.5in). Callers should use
// the original aspect ratio and place images with "contain" to avoid stretching.

export async function imageDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const img = await Image.decode(bytes);
  return { width: img.width, height: img.height };
}
