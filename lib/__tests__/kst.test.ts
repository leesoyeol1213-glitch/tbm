import { describe, expect, it } from "vitest";
import {
  dateLabel,
  dateTimeLabel,
  daysAgo,
  kstDateOnly,
  kstMinuteOfDay,
  minuteLabel,
  parseYmd,
  resolvePeriod,
  timeLabel,
  ymd,
} from "@/lib/kst";

/**
 * 이 시스템은 Vercel(UTC) 위에서 돌지만 모든 날짜는 KST 기준이어야 한다.
 * "UTC로는 어제, KST로는 오늘"인 경계 시각을 중심으로 검증한다.
 */
describe("kstDateOnly", () => {
  it("UTC 23:00은 KST로 다음 날이다", () => {
    // 2026-08-17T23:00:00Z = 2026-08-18 08:00 KST
    const at = new Date("2026-08-17T23:00:00Z");
    expect(ymd(kstDateOnly(at))).toBe("2026-08-18");
  });

  it("UTC 14:59는 아직 KST로 같은 날이다", () => {
    // 2026-08-18T14:59:00Z = 2026-08-18 23:59 KST
    const at = new Date("2026-08-18T14:59:00Z");
    expect(ymd(kstDateOnly(at))).toBe("2026-08-18");
  });

  it("UTC 15:00부터 KST 날짜가 넘어간다", () => {
    // 2026-08-18T15:00:00Z = 2026-08-19 00:00 KST
    const at = new Date("2026-08-18T15:00:00Z");
    expect(ymd(kstDateOnly(at))).toBe("2026-08-19");
  });

  it("결과는 UTC 자정이라 @db.Date에 그대로 넣을 수 있다", () => {
    const d = kstDateOnly(new Date("2026-08-17T23:30:00Z"));
    expect(d.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });
});

describe("ymd / parseYmd", () => {
  it("왕복 변환이 유지된다", () => {
    expect(ymd(parseYmd("2026-08-18"))).toBe("2026-08-18");
  });

  it("@db.Date로 읽어온 값(UTC 자정)도 같은 날로 읽힌다", () => {
    // Prisma가 돌려주는 형태
    expect(ymd(new Date("2026-08-18T00:00:00.000Z"))).toBe("2026-08-18");
  });
});

describe("kstMinuteOfDay", () => {
  it("KST 08:30을 510분으로 읽는다", () => {
    // 2026-08-17T23:30:00Z = 2026-08-18 08:30 KST
    expect(kstMinuteOfDay(new Date("2026-08-17T23:30:00Z"))).toBe(510);
  });

  it("KST 자정은 0분이다", () => {
    expect(kstMinuteOfDay(new Date("2026-08-17T15:00:00Z"))).toBe(0);
  });
});

describe("라벨", () => {
  it("minuteLabel은 두 자리로 채운다", () => {
    expect(minuteLabel(510)).toBe("08:30");
    expect(minuteLabel(0)).toBe("00:00");
    expect(minuteLabel(1439)).toBe("23:59");
  });

  it("timeLabel은 KST 벽시계를 보여준다", () => {
    expect(timeLabel(new Date("2026-08-17T23:32:00Z"))).toBe("08:32");
  });

  it("dateTimeLabel은 KST 날짜와 시각을 함께 보여준다", () => {
    expect(dateTimeLabel(new Date("2026-08-17T23:32:00Z"))).toBe("2026-08-18 08:32");
  });

  it("dateLabel은 요일을 KST 기준으로 붙인다", () => {
    // 2026-08-18은 화요일
    expect(dateLabel(parseYmd("2026-08-18"))).toBe("2026-08-18 (화)");
  });
});

describe("daysAgo", () => {
  it("KST 날짜 기준으로 n일 전을 준다", () => {
    const from = new Date("2026-08-17T23:00:00Z"); // KST 8/18
    expect(ymd(daysAgo(0, from))).toBe("2026-08-18");
    expect(ymd(daysAgo(1, from))).toBe("2026-08-17");
    expect(ymd(daysAgo(13, from))).toBe("2026-08-05");
  });
});

/**
 * 대표가 월·분기 단위로 몰아서 결재할 때 쓰는 구간.
 * 서버가 UTC로 도는데 구간은 KST 달력 기준이어야 하므로 경계를 직접 확인한다.
 */
describe("resolvePeriod", () => {
  // 2026-08-20 01:00 KST (= 전날 16:00 UTC). 서버 UTC 날짜와 KST 날짜가 다른 시각.
  const kstAug20 = new Date("2026-08-19T16:00:00Z");

  it("이번 달은 1일부터 말일까지", () => {
    const p = resolvePeriod("this-month", kstAug20);
    expect(ymd(p.from!)).toBe("2026-08-01");
    expect(ymd(p.to!)).toBe("2026-08-31");
    expect(p.label).toBe("2026년 8월");
  });

  it("지난달은 30일로 끝나는 달도 맞게 잡는다", () => {
    const p = resolvePeriod("last-month", kstAug20);
    expect(ymd(p.from!)).toBe("2026-07-01");
    expect(ymd(p.to!)).toBe("2026-07-31");
  });

  it("2월은 그 해에 맞춰 끝난다", () => {
    const p = resolvePeriod("this-month", new Date("2024-02-10T00:00:00Z"));
    expect(ymd(p.to!)).toBe("2024-02-29"); // 윤년
  });

  it("이번 분기는 3개월 묶음이다", () => {
    const p = resolvePeriod("this-quarter", kstAug20);
    expect(ymd(p.from!)).toBe("2026-07-01");
    expect(ymd(p.to!)).toBe("2026-09-30");
    expect(p.label).toBe("2026년 3분기");
  });

  it("1분기의 지난 분기는 작년 4분기다", () => {
    const p = resolvePeriod("last-quarter", new Date("2026-02-10T00:00:00Z"));
    expect(ymd(p.from!)).toBe("2025-10-01");
    expect(ymd(p.to!)).toBe("2025-12-31");
    expect(p.label).toBe("2025년 4분기");
  });

  it("전체는 구간 제한이 없다", () => {
    const p = resolvePeriod("all", kstAug20);
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
  });

  it("KST로 날이 바뀐 직후에도 그날 기준으로 잡는다", () => {
    // 2026-09-01 00:30 KST = 2026-08-31 15:30 UTC. UTC로는 아직 8월이다.
    const p = resolvePeriod("this-month", new Date("2026-08-31T15:30:00Z"));
    expect(ymd(p.from!)).toBe("2026-09-01");
  });
});
