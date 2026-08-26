import { describe, expect, it } from "vitest";
import { extractApp1, spliceApp1 } from "@/lib/jpegExif";

/** APP1(EXIF) 세그먼트 한 개를 만든다. 내용은 길이만 맞으면 된다. */
function app1(payloadSize = 20): Buffer {
  const body = Buffer.alloc(payloadSize, 0x11);
  const id = Buffer.from("Exif\0\0", "latin1");
  const len = 2 + id.length + body.length;
  const head = Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]);
  return Buffer.concat([head, id, body]);
}

/** 길이 필드를 갖는 아무 세그먼트. APP0(JFIF) 자리를 채우는 용도. */
function app0(): Buffer {
  const body = Buffer.from("JFIF\0\0\0\0\0\0", "latin1");
  const len = 2 + body.length;
  return Buffer.concat([Buffer.from([0xff, 0xe0, len >> 8, len & 0xff]), body]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const SOS = Buffer.from([0xff, 0xda, 0x00, 0x02]);
const PIXELS = Buffer.alloc(64, 0x7f);

describe("extractApp1", () => {
  it("SOI 바로 뒤의 EXIF를 찾는다", () => {
    const jpeg = Buffer.concat([SOI, app1(), SOS, PIXELS]);
    expect(extractApp1(jpeg)?.equals(app1())).toBe(true);
  });

  it("JFIF 뒤에 있어도 찾는다", () => {
    const jpeg = Buffer.concat([SOI, app0(), app1(), SOS, PIXELS]);
    expect(extractApp1(jpeg)?.equals(app1())).toBe(true);
  });

  it("EXIF가 없으면 null", () => {
    expect(extractApp1(Buffer.concat([SOI, app0(), SOS, PIXELS]))).toBeNull();
  });

  it("JPEG가 아니면 null", () => {
    expect(extractApp1(Buffer.from("이건 사진이 아니다"))).toBeNull();
  });

  it("화소가 시작된 뒤는 뒤지지 않는다", () => {
    // SOS 뒤에 EXIF처럼 생긴 바이트가 우연히 나와도 집지 않는다.
    const jpeg = Buffer.concat([SOI, app0(), SOS, app1()]);
    expect(extractApp1(jpeg)).toBeNull();
  });

  it("세그먼트가 잘려 있으면 null", () => {
    // 앞부분만 받은 조각이라 EXIF가 다 오지 않은 경우. 붙이면 깨진 파일이 된다.
    const jpeg = Buffer.concat([SOI, app1(4096)]).subarray(0, 100);
    expect(extractApp1(jpeg)).toBeNull();
  });
});

describe("spliceApp1", () => {
  it("EXIF 없는 JPEG에 끼워 넣으면 다시 읽힌다", () => {
    const bare = Buffer.concat([SOI, app0(), SOS, PIXELS]);
    const out = spliceApp1(bare, app1());
    expect(extractApp1(out)?.equals(app1())).toBe(true);
    // 원래 있던 내용은 그대로 뒤에 남는다.
    expect(out.subarray(2 + app1().length).equals(bare.subarray(2))).toBe(true);
  });

  it("이미 EXIF가 있으면 건드리지 않는다", () => {
    const already = Buffer.concat([SOI, app1(8), SOS, PIXELS]);
    expect(spliceApp1(already, app1(20)).equals(already)).toBe(true);
  });

  it("JPEG가 아니면 그대로 둔다", () => {
    const notJpeg = Buffer.from("PNG라고 치자");
    expect(spliceApp1(notJpeg, app1()).equals(notJpeg)).toBe(true);
  });
});
