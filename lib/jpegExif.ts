/**
 * JPEG의 EXIF(APP1) 조각을 떼어 내고 다시 붙이는 도구.
 *
 * 브라우저에서 사진을 줄여 보내면 EXIF가 통째로 날아간다. canvas는 화소만
 * 다시 그리기 때문이다. 그래서 원본의 머리 조각을 따로 받아 촬영 시각·좌표를
 * 읽고, 저장할 파일에도 그 EXIF를 도로 끼워 넣는다.
 *
 * 원본 전체를 받던 때와 신뢰 수준은 같다. 어느 쪽이든 브라우저가 보낸 바이트다.
 */

const SOI = 0xd8;
const SOS = 0xda;
const APP1 = 0xe1;
const EXIF_ID = "Exif\0\0";

function hasSoi(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === SOI;
}

/**
 * EXIF가 담긴 APP1 세그먼트를 마커째로 잘라 낸다. 없으면 null.
 *
 * 잘린 파일(앞부분만 받은 조각)이어도 APP1은 보통 파일 앞 64KB 안에 있으므로
 * 그대로 찾힌다.
 */
export function extractApp1(buf: Buffer): Buffer | null {
  if (!hasSoi(buf)) return null;

  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null; // 마커가 아니면 더 볼 것이 없다
    const marker = buf[i + 1];

    // 길이 필드가 없는 마커들
    if (marker === SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // 화소 데이터가 시작되면 EXIF는 없다
    if (marker === SOS) return null;

    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const end = i + 2 + len;

    if (
      marker === APP1 &&
      buf.subarray(i + 4, i + 4 + 6).toString("latin1") === EXIF_ID
    ) {
      // 조각이 잘려 세그먼트가 다 안 왔으면 붙여 봐야 깨진 파일이 된다.
      if (end > buf.length) return null;
      return buf.subarray(i, end);
    }

    i = end;
  }
  return null;
}

/**
 * SOI 바로 뒤에 APP1을 끼워 넣는다.
 *
 * 이미 EXIF가 있으면 그대로 둔다. 두 개가 되면 읽는 쪽이 어느 것을 볼지
 * 알 수 없다.
 */
export function spliceApp1(jpeg: Buffer, app1: Buffer): Buffer {
  if (!hasSoi(jpeg)) return jpeg;
  if (extractApp1(jpeg)) return jpeg;
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}
