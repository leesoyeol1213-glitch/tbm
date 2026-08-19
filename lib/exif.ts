import exifr from "exifr";

export type PhotoExif = {
  hasExif: boolean;
  /** 촬영 시각. EXIF DateTimeOriginal은 타임존이 없으므로 KST 벽시계로 해석한다. */
  takenAt: Date | null;
  lat: number | null;
  lng: number | null;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * "2026:08:18 08:30:12" 형태의 EXIF 날짜 문자열을 KST 벽시계로 보고 Date로 변환.
 *
 * EXIF DateTimeOriginal에는 타임존 정보가 없다. exifr가 자동 변환하면 서버
 * 로컬 타임존(Vercel은 UTC)으로 해석돼 9시간이 어긋나므로 직접 파싱한다.
 */
export function parseExifDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - KST_OFFSET_MS;
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function readPhotoExif(buf: Buffer): Promise<PhotoExif> {
  const empty: PhotoExif = { hasExif: false, takenAt: null, lat: null, lng: null };

  // 날짜는 원본 문자열이 필요하므로 reviveValues: false 로 읽는다.
  const raw = await exifr
    .parse(buf, {
      reviveValues: false,
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    })
    .catch(() => null);

  // GPS는 exifr의 전용 헬퍼가 도분초 → 십진수 변환까지 해준다.
  const gps = await exifr.gps(buf).catch(() => null);

  const takenAt =
    parseExifDate(raw?.DateTimeOriginal) ??
    parseExifDate(raw?.CreateDate) ??
    parseExifDate(raw?.ModifyDate);

  const lat = typeof gps?.latitude === "number" ? gps.latitude : null;
  const lng = typeof gps?.longitude === "number" ? gps.longitude : null;

  if (!takenAt && lat === null) return empty;

  return { hasExif: true, takenAt, lat, lng };
}
