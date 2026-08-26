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

/**
 * 저장한 사진 파일을 지운다.
 *
 * 지우지 못해도 조용히 넘어간다. 파일이 남는 것보다 삭제가 실패해 화면이
 * 멈추는 쪽이 나쁘다. 남은 파일은 용량 화면에 "주인 없는 파일"로 잡힌다.
 */
export async function deleteStoredImage(url: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    if (token) {
      const { del } = await import("@vercel/blob");
      await del(url, { token });
      return;
    }
    // 개발용 로컬 저장. url은 "/uploads/…" 형태다.
    if (url.startsWith("/")) {
      await fs.rm(path.join(process.cwd(), "public", url.slice(1)), { force: true });
    }
  } catch {
    // 파일이 이미 없거나 권한이 없는 경우. 기록은 이미 지워졌다.
  }
}
