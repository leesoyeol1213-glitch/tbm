/**
 * 브라우저에서 사진을 줄여 보내는 일.
 *
 * TBM 현장 사진과 공지사항 사진이 같은 벽에 부딪힌다 — 폰 원본은 한 장에
 * 4~6MB인데 Vercel은 4.5MB 넘는 요청을 함수에 닿기도 전에 잘라 버린다.
 * 사유 없이 실패하므로 보내기 전에 줄여야 한다.
 *
 * 둘의 차이는 EXIF 하나다. TBM 사진은 현장에서 찍었는지가 쟁점이라 촬영
 * 시각·좌표를 검증해야 하지만, 기숙사 정리정돈 사진에 거리 판정은 뜻이 없다.
 * 그래서 EXIF를 떼어 보낼지를 부르는 쪽이 고른다.
 *
 * 이 파일은 브라우저 전용이다 — canvas와 createImageBitmap을 쓴다.
 */

/**
 * 올리기 전에 줄일 긴 변 화소. 서버가 저장하는 크기와 같게 맞춘다.
 * 어차피 서버에서 1280px로 줄이므로 미리 줄여 보내도 결과물은 같다.
 */
export const MAX_PX = 1280;
export const QUALITY = 0.8;

/**
 * 원본에서 떼어 보낼 앞부분 크기.
 *
 * EXIF(APP1)는 JPEG 규격상 한 조각이 64KB를 넘을 수 없고 파일 맨 앞에 온다.
 * 128KB면 촬영 시각·좌표가 확실히 들어온다.
 */
export const EXIF_HEAD_BYTES = 128 * 1024;

/**
 * 한 번에 보낼 수 있는 바이트. Vercel이 4.5MB에서 자르므로 그보다 낮게 잡는다.
 * 여기 걸리면 사유 없이 실패하던 것을 미리 붙잡아 알려 준다.
 */
export const SAFE_BYTES = 4 * 1024 * 1024;

export type Prepared = { body: Blob; name: string; head: Blob | null };

/**
 * 브라우저에서 사진을 줄인다.
 *
 * canvas로 다시 그리면 EXIF가 날아가므로, `withExifHead`가 켜져 있으면 원본
 * 앞부분을 따로 떼어 `head`에 담아 준다 — 촬영 시각과 위치는 그것으로
 * 검증한다. 꺼져 있으면 `head`는 항상 null이고 보낼 바이트가 그만큼 줄어든다.
 *
 * 줄이지 못하면 원본을 그대로 돌려준다. HEIC처럼 브라우저가 못 읽는 형식이
 * 있기 때문이다.
 */
export async function prepareImage(
  file: File,
  { withExifHead = true }: { withExifHead?: boolean } = {},
): Promise<Prepared> {
  const asIs: Prepared = { body: file, name: file.name, head: null };
  if (typeof createImageBitmap !== "function") return asIs;

  let bitmap: ImageBitmap;
  try {
    // 방향은 손대지 않는다. EXIF를 그대로 붙여 보내고 서버가 세운다.
    bitmap = await createImageBitmap(file, { imageOrientation: "none" });
  } catch {
    return asIs;
  }

  try {
    const scale = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    // 이미 작고 가벼우면 그대로 보낸다. 다시 그리면 화질만 깎인다.
    if (scale === 1 && file.size <= SAFE_BYTES / 2) return asIs;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return asIs;

    return {
      body: blob,
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      head: withExifHead ? file.slice(0, EXIF_HEAD_BYTES) : null,
    };
  } finally {
    bitmap.close();
  }
}
