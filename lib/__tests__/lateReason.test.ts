import { describe, expect, it } from "vitest";
import {
  LATE_PRESETS,
  THIN_ATTENDANCE_NOTE,
  isMeaningfulLateReason,
  isThinAttendance,
  lateDays,
  lateDaysLabel,
  withThinAttendanceNote,
} from "@/lib/tbm";
import { parseYmd } from "@/lib/kst";

/**
 * 늦게 올리는 사유.
 *
 * 작업일이 지난 뒤 올리는 건은 사유가 있어야 올라간다. 그 규칙의 목적은
 * "휴무일 작업을 다음 날 올린 것"과 "사후에 꾸며 넣은 것"을 가르는 데 있다.
 * 글자가 있는지만 보던 동안에는 "." 한 글자가 통과해 16건이 쌓였고, 그러면
 * 두 경우가 전혀 구분되지 않는다.
 */

describe("isMeaningfulLateReason", () => {
  it("빈 값은 사유가 아니다", () => {
    expect(isMeaningfulLateReason(null)).toBe(false);
    expect(isMeaningfulLateReason(undefined)).toBe(false);
    expect(isMeaningfulLateReason("")).toBe(false);
    expect(isMeaningfulLateReason("   ")).toBe(false);
  });

  it("문장부호만 있으면 거른다 — 실제로 쌓였던 값이다", () => {
    expect(isMeaningfulLateReason(".")).toBe(false);
    expect(isMeaningfulLateReason("..")).toBe(false);
    expect(isMeaningfulLateReason("....")).toBe(false);
    expect(isMeaningfulLateReason("-")).toBe(false);
    expect(isMeaningfulLateReason("/")).toBe(false);
    expect(isMeaningfulLateReason(" . ")).toBe(false);
  });

  it("한 글자는 뜻을 담지 못한다", () => {
    expect(isMeaningfulLateReason("늦")).toBe(false);
    expect(isMeaningfulLateReason("x")).toBe(false);
  });

  it("두 글자부터 받는다 — 짧아도 뜻이 있는 말을 막지 않는다", () => {
    // 길이를 길게 요구하면 통과용으로 "...."을 찍게 될 뿐이다.
    expect(isMeaningfulLateReason("휴무")).toBe(true);
    expect(isMeaningfulLateReason("누락")).toBe(true);
  });

  it("실제로 적혀 있던 사유를 전부 받는다", () => {
    // 2026-11 기준 진천 69건에서 뽑은 값들.
    expect(isMeaningfulLateReason("작성 누락")).toBe(true);
    expect(isMeaningfulLateReason("업무과다")).toBe(true);
    expect(isMeaningfulLateReason("휴무일 작업")).toBe(true);
    expect(isMeaningfulLateReason("사진 전달 지연")).toBe(true);
    expect(isMeaningfulLateReason("2공장 휴무 / 왓산 입원 중")).toBe(true);
  });

  it("고를 수 있는 사유는 모두 통과해야 한다", () => {
    // 이게 깨지면 단추를 눌러도 상신이 막힌다 — 고치려던 문제가 그대로 남는다.
    for (const preset of LATE_PRESETS) {
      expect(isMeaningfulLateReason(preset), preset).toBe(true);
    }
  });

  it("숫자만으로도 두 자리면 받는다", () => {
    // "11/14 작업" 처럼 날짜만 적는 사람이 있다.
    expect(isMeaningfulLateReason("11/14")).toBe(true);
    expect(isMeaningfulLateReason("1")).toBe(false);
  });
});

describe("lateDays", () => {
  const at = (s: string) => parseYmd(s);

  it("같은 날이면 0", () => {
    expect(lateDays(at("2026-11-18"), at("2026-11-18"))).toBe(0);
  });

  it("하루 늦으면 1", () => {
    expect(lateDays(at("2026-11-17"), at("2026-11-18"))).toBe(1);
  });

  it("토요일 작업을 월요일에 올리면 2일", () => {
    // 가장 잦은 경우다. 진천 토요일 작성률이 64%인 이유가 여기다.
    expect(lateDays(at("2026-11-14"), at("2026-11-16"))).toBe(2);
  });

  it("한 달 가까이 지난 것도 센다", () => {
    expect(lateDays(at("2026-10-03"), at("2026-11-02"))).toBe(30);
  });

  it("작업일이 미래면 음수다 — 늦은 게 아니다", () => {
    expect(lateDays(at("2026-11-19"), at("2026-11-18"))).toBe(-1);
  });

  it("서머타임이 없는 KST라 월을 넘어가도 어긋나지 않는다", () => {
    expect(lateDays(at("2026-08-31"), at("2026-09-01"))).toBe(1);
    expect(lateDays(at("2026-12-31"), at("2027-01-01"))).toBe(1);
  });
});

describe("lateDaysLabel", () => {
  it("늦지 않았으면 아무 말도 하지 않는다", () => {
    expect(lateDaysLabel(0)).toBe("");
    expect(lateDaysLabel(-1)).toBe("");
  });

  it("하루는 하루라고 적는다", () => {
    expect(lateDaysLabel(1)).toBe("하루 지난 기록입니다");
  });

  it("며칠까지는 날 수만 적는다", () => {
    expect(lateDaysLabel(2)).toBe("2일 지난 기록입니다");
    expect(lateDaysLabel(3)).toBe("3일 지난 기록입니다");
  });

  it("한 주가 넘어가면 말이 달라진다", () => {
    // 하루 늦은 것과 3주 늦은 것은 다른 일인데, 지금까지 문서에서 구분되지 않았다.
    expect(lateDaysLabel(5)).toContain("한 주");
    expect(lateDaysLabel(10)).toContain("사후 작성");
    expect(lateDaysLabel(30)).toContain("사후 작성");
  });
});

describe("LATE_PRESETS", () => {
  it("휴무일·주말 작업이 첫 번째다", () => {
    // 토요일 건을 월요일에 올리는 경우가 가장 잦아, 제일 누르기 쉬운 자리에 둔다.
    expect(LATE_PRESETS[0]).toBe("휴무일·주말 작업");
  });

  it("선택지가 중복 없이 네 개다", () => {
    expect(LATE_PRESETS).toHaveLength(4);
    expect(new Set(LATE_PRESETS).size).toBe(4);
  });
});

describe("isThinAttendance", () => {
  it("절반 이하면 부분 가동으로 본다", () => {
    // 실제로 있었던 토요일들: 9명 명부에 1명, 19명에 1명.
    expect(isThinAttendance(1, 9)).toBe(true);
    expect(isThinAttendance(4, 9)).toBe(true);
    expect(isThinAttendance(1, 19)).toBe(true);
    expect(isThinAttendance(9, 18)).toBe(true);
  });

  it("절반을 넘으면 평소 근무다", () => {
    // 한두 명 빠진 날까지 안내를 띄우면 결근과 휴일 가동이 섞인다.
    expect(isThinAttendance(5, 9)).toBe(false);
    expect(isThinAttendance(8, 9)).toBe(false);
    expect(isThinAttendance(17, 19)).toBe(false);
  });

  it("아무도 안 나온 날은 부분 가동이 아니다", () => {
    // 그건 다른 문제이고, 출석 0명은 애초에 상신이 막힌다.
    expect(isThinAttendance(0, 9)).toBe(false);
    expect(isThinAttendance(0, 0)).toBe(false);
  });

  it("명부가 작으면 '적다'를 말하지 않는다", () => {
    expect(isThinAttendance(1, 3)).toBe(false);
    expect(isThinAttendance(1, 2)).toBe(false);
    expect(isThinAttendance(2, 4)).toBe(true);
  });
});

describe("withThinAttendanceNote", () => {
  it("빈 칸이면 그 한 줄만 들어간다", () => {
    expect(withThinAttendanceNote("")).toBe(THIN_ATTENDANCE_NOTE);
    expect(withThinAttendanceNote("   ")).toBe(THIN_ATTENDANCE_NOTE);
  });

  it("이미 적힌 위험요인을 지우지 않고 뒤에 붙인다", () => {
    // 단추가 기록을 깎으면 안 된다. 진천 특이사항은 43%가 실제 위험요인이다.
    const written = "호이스트 체인고리 훅해지장치 파손시 즉시 교체";
    expect(withThinAttendanceNote(written)).toBe(`${written}\n${THIN_ATTENDANCE_NOTE}`);
  });

  it("두 번 눌러도 한 번만 들어간다", () => {
    const once = withThinAttendanceNote("우천 주의");
    expect(withThinAttendanceNote(once)).toBe(once);
  });

  it("이미 그 문장이 적혀 있으면 손대지 않는다", () => {
    const already = `${THIN_ATTENDANCE_NOTE} (2공장만 가동)`;
    expect(withThinAttendanceNote(already)).toBe(already);
  });
});
