import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

// gpt-image-1 can only output 1024x1024 (1:1), 1024x1536 (2:3) or 1536x1024
// (3:2), never a true 16:9. Full-slide deck images are generated at 1536x1024
// (3:2) but the PPTX/PDF slide is 16:9 (13.33in x 7.5in). Placing a 3:2 image
// full-bleed on a 16:9 slide stretches it horizontally (~18%), which squishes
// faces, text, and logos. We fix that at the source: center-crop every
// full-slide image to exactly 16:9 before it is stored/embedded, so it fills
// the slide with zero distortion in every renderer.
const TARGET_RATIO = 16 / 9;

// Center-crop raw PNG/JPEG bytes to a 16:9 aspect ratio; returns PNG bytes.
// A near-16:9 image (within a tiny tolerance) is returned re-encoded but uncropped.
export async function cropBytesTo16by9(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const w = img.width;
  const h = img.height;
  const ratio = w / h;

  let cw = w;
  let ch = h;
  let x = 0;
  let y = 0;

  if (ratio > TARGET_RATIO + 0.002) {
    // Too wide: trim the sides.
    cw = Math.round(h * TARGET_RATIO);
    x = Math.round((w - cw) / 2);
  } else if (ratio < TARGET_RATIO - 0.002) {
    // Too tall (the 3:2 case): trim top and bottom.
    ch = Math.round(w / TARGET_RATIO);
    y = Math.round((h - ch) / 2);
  } else {
    return await img.encode();
  }

  const cropped = img.crop(x, y, cw, ch);
  return await cropped.encode();
}
