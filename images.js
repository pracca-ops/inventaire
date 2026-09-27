// Compression des photos dans le téléphone, avant l'envoi

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Photo illisible. Essayez de la reprendre.")); };
    img.src = url;
  });
}

async function decode(file) {
  // createImageBitmap respecte l'orientation EXIF des photos de téléphone
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* repli */ }
  }
  return loadImage(file);
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compression impossible."))), "image/jpeg", quality));
}

// Photo complète : 1600 px maximum, JPEG ~0,78 (≈ 200–400 Ko)
export async function compressPhoto(file, maxSide = 1600, quality = 0.78) {
  const src = await decode(file);
  const w = src.width, h = src.height;
  if (!w || !h) throw new Error("Photo illisible. Essayez de la reprendre.");
  const r = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * r); c.height = Math.round(h * r);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  let q = quality, blob = await canvasToBlob(c, q);
  while (blob.size > 900 * 1024 && q > 0.45) { q -= 0.08; blob = await canvasToBlob(c, q); }
  if (src.close) src.close();
  return blob;
}

// Miniature carrée pour la liste (data URL de quelques Ko)
export async function makeThumb(blob, size = 160, quality = 0.7) {
  const src = await decode(blob);
  const s = Math.min(src.width, src.height);
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
  if (src.close) src.close();
  return c.toDataURL("image/jpeg", quality);
}

// Version réduite en base64 pour l'IA
export async function toBase64ForAI(blob, maxSide = 1280) {
  const small = await compressPhoto(blob, maxSide, 0.82);
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
