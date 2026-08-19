import { describe, expect, it } from "vitest";
import { parseExifDate } from "@/lib/exif";
import { distanceMeters, distanceLabel } from "@/lib/geo";
import { checkPhoto } from "@/lib/tbm";
import { parseYmd } from "@/lib/kst";

describe("parseExifDate", () => {
  it("EXIF 벽시계를 KST로 해석한다", () => {
    // 서버가 UTC여도 현장에서 08:30에 찍은 사진이어야 한다.
    const d = parseExifDate("2026:08:18 08:30:12");
    expect(d?.toISOString()).toBe("2026-08-17T23:30:12.000Z");
  });

  it("하이픈·T 구분자도 받는다", () => {
    expect(parseExifDate("2026-08-18T08:30:12")?.toISOString()).toBe(
      "2026-08-17T23:30:12.000Z",
    );
  });

  it("형식이 아니면 null", () => {
    expect(parseExifDate("")).toBeNull();
    expect(parseExifDate("어제")).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
    expect(parseExifDate(new Date())).toBeNull();
  });
});

describe("distanceMeters", () => {
  it("같은 지점은 0m", () => {
    expect(distanceMeters(37.1996, 126.8314, 37.1996, 126.8314)).toBe(0);
  });

  it("위도 0.01도는 약 1.1km", () => {
    const d = distanceMeters(37.1996, 126.8314, 37.2096, 126.8314);
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1150);
  });

  it("라벨은 1km 이상이면 km로 바꾼다", () => {
    expect(distanceLabel(340)).toBe("340m");
    expect(distanceLabel(1200)).toBe("1.2km");
  });
});

describe("checkPhoto", () => {
  const site = { lat: 37.1996, lng: 126.8314, geofenceM: 500 };
  const workDate = parseYmd("2026-08-18");

  it("당일·현장 안에서 찍힌 사진은 경고가 없다", () => {
    const res = checkPhoto(
      {
        hasExif: true,
        takenAt: new Date("2026-08-17T23:30:00Z"), // KST 8/18 08:30
        lat: 37.1998,
        lng: 126.8316,
      },
      site,
      workDate,
    );
    expect(res.warnings).toEqual([]);
    expect(res.distanceM).not.toBeNull();
    expect(res.distanceM!).toBeLessThan(500);
  });

  it("전날 찍은 사진은 촬영일 불일치로 잡는다", () => {
    const res = checkPhoto(
      {
        hasExif: true,
        takenAt: new Date("2026-08-16T23:30:00Z"), // KST 8/17
        lat: 37.1998,
        lng: 126.8316,
      },
      site,
      workDate,
    );
    expect(res.warnings.some((w) => w.includes("촬영일"))).toBe(true);
  });

  it("KST 자정 직전에 찍힌 사진은 같은 날로 인정한다", () => {
    const res = checkPhoto(
      {
        hasExif: true,
        takenAt: new Date("2026-08-18T14:59:00Z"), // KST 8/18 23:59
        lat: 37.1998,
        lng: 126.8316,
      },
      site,
      workDate,
    );
    expect(res.warnings.some((w) => w.includes("촬영일"))).toBe(false);
  });

  it("반경 밖에서 찍힌 사진은 현장 이탈로 잡는다", () => {
    const res = checkPhoto(
      {
        hasExif: true,
        takenAt: new Date("2026-08-17T23:30:00Z"),
        lat: 37.2996, // 약 11km 북쪽
        lng: 126.8314,
      },
      site,
      workDate,
    );
    expect(res.warnings.some((w) => w.includes("떨어져"))).toBe(true);
    expect(res.distanceM!).toBeGreaterThan(500);
  });

  it("EXIF가 없으면 캡처·재전송 의심으로 잡는다", () => {
    const res = checkPhoto(
      { hasExif: false, takenAt: null, lat: null, lng: null },
      site,
      workDate,
    );
    expect(res.warnings.some((w) => w.includes("EXIF"))).toBe(true);
    expect(res.distanceM).toBeNull();
  });

  it("사업장 좌표가 없으면 거리 검증을 건너뛴다", () => {
    const res = checkPhoto(
      {
        hasExif: true,
        takenAt: new Date("2026-08-17T23:30:00Z"),
        lat: 37.9,
        lng: 127.9,
      },
      { lat: null, lng: null, geofenceM: 500 },
      workDate,
    );
    expect(res.distanceM).toBeNull();
    expect(res.warnings.some((w) => w.includes("떨어져"))).toBe(false);
  });
});
