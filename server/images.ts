import { createHash } from "node:crypto";
import sharp from "sharp";
export type Fingerprint = {
  exact: string;
  hash: bigint;
  mean: number;
  deviation: number;
};
export async function prepareImage(
  buffer: Buffer,
): Promise<{ jpeg: Buffer; fingerprint: Fingerprint }> {
  const base = sharp(buffer, { limitInputPixels: 25_000_000, animated: false })
    .rotate()
    .flatten({ background: "#fff" });
  const jpeg = await base
    .clone()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  const pixels = await base
    .clone()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      hash =
        (hash << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
  const mean = pixels.reduce((sum, n) => sum + n, 0) / pixels.length;
  const deviation = Math.sqrt(
    pixels.reduce((sum, n) => sum + (n - mean) ** 2, 0) / pixels.length,
  );
  return {
    jpeg,
    fingerprint: {
      exact: createHash("sha256").update(buffer).digest("hex"),
      hash,
      mean,
      deviation,
    },
  };
}
export function hamming(a: bigint, b: bigint): number {
  let difference = a ^ b,
    count = 0;
  while (difference) {
    difference &= difference - 1n;
    count++;
  }
  return count;
}
export function isDuplicate(a: Fingerprint, b: Fingerprint): boolean {
  return (
    a.exact === b.exact ||
    (a.deviation > 10 &&
      b.deviation > 10 &&
      Math.abs(a.mean - b.mean) < 25 &&
      hamming(a.hash, b.hash) <= 4)
  );
}
