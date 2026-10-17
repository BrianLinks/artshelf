/** File types are decided from content (magic bytes), never from the filename or client-supplied MIME. */
export type Format = "png" | "jpeg" | "webp" | "pdf" | "zip" | "wav" | "mp3" | "mp4";

export const FORMAT_INFO: Record<Format, { mime: string; ext: string; image: boolean }> = {
  png: { mime: "image/png", ext: "png", image: true },
  jpeg: { mime: "image/jpeg", ext: "jpg", image: true },
  webp: { mime: "image/webp", ext: "webp", image: true },
  pdf: { mime: "application/pdf", ext: "pdf", image: false },
  zip: { mime: "application/zip", ext: "zip", image: false },
  wav: { mime: "audio/wav", ext: "wav", image: false },
  mp3: { mime: "audio/mpeg", ext: "mp3", image: false },
  mp4: { mime: "video/mp4", ext: "mp4", image: false },
};

function startsWith(data: Buffer, bytes: readonly number[]): boolean {
  return data.length >= bytes.length && bytes.every((value, index) => data[index] === value);
}

function ascii(data: Buffer, start: number, end: number): string {
  return data.subarray(start, end).toString("latin1");
}

export function detectFormat(data: Buffer): Format | undefined {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "jpeg";
  if (data.length >= 12 && ascii(data, 0, 4) === "RIFF") {
    const kind = ascii(data, 8, 12);
    if (kind === "WEBP") return "webp";
    if (kind === "WAVE") return "wav";
    return undefined;
  }
  if (ascii(data, 0, 5) === "%PDF-") return "pdf";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (data.length >= 12 && ascii(data, 4, 8) === "ftyp") return "mp4";
  if (ascii(data, 0, 3) === "ID3") return "mp3";
  const second = data[1];
  if (data[0] === 0xff && second !== undefined && (second & 0xe0) === 0xe0 && (second & 0x06) !== 0) return "mp3";
  return undefined;
}
