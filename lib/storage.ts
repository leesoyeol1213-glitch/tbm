import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type StoredFile = { url: string; pathname: string };

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function isAllowedImage(contentType: string): boolean {
  return contentType in EXT_BY_TYPE;
}

/**
 * 사진을 저장한다.
 * BLOB_READ_WRITE_TOKEN이 있으면 Vercel Blob, 없으면 로컬 public/uploads (개발용).
 */
export async function storeImage(
  prefix: string,
  body: Buffer,
  contentType: string,
): Promise<StoredFile> {
  const ext = EXT_BY_TYPE[contentType] ?? "bin";
  const key = `${prefix}/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    const res = await put(key, body, {
      access: "public",
      contentType,
      token,
      addRandomSuffix: false,
    });
    return { url: res.url, pathname: res.pathname };
  }

  const rel = `uploads/${key}`;
  const abs = path.join(process.cwd(), "public", rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
  return { url: `/${rel}`, pathname: rel };
}
