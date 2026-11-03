import { describe, expect, it } from "vitest";
import {
  GRACE_MIN,
  minutesLabel,
  newToken,
  scanStep,
  sessionPhase,
  stayMinutes,
  stayVerdict,
  tally,
} from "@/lib/legalEdu";

const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00+09:00`);

describe("sessionPhase", () => {
  it("열기 전 · 진행 중 · 마감을 가린다", () => {
    expect(sessionPhase({ openedAt: null, closedAt: null })).toBe("BEFORE");
    expect(sessionPhase({ openedAt: at("08:30"), closedAt: null })).toBe("OPEN");
    expect(sessionPhase({ openedAt: at("08:30"), closedAt: at("09:30") })).toBe("CLOSED");
  });

  it("열지 않고 닫힌 회차도 마감으로 본다", () => {
    // 열지 않고 닫는 길은 막아 두었지만, 데이터가 그 꼴이면 스캔은 받지 않아야 한다.
    expect(sessionPhase({ openedAt: null, closedAt: at("09:30") })).toBe("CLOSED");
  });
});

describe("scanStep — 지금 찍을 차례", () => {
  it("기록이 없으면 시작부터", () => {
    expect(scanStep(null)).toBe("START");
    expect(scanStep({ startedAt: null, endedAt: null })).toBe("START");
  });

  it("시작만 있으면 다음은 종료", () => {
    expect(scanStep({ startedAt: at("08:30"), endedAt: null })).toBe("END");
  });

  it("둘 다 있으면 끝났다", () => {
    expect(scanStep({ startedAt: at("08:30"), endedAt: at("09:31") })).toBe("DONE");
  });

  /**
   * 시작이 비었는데 종료만 있는 꼴은 만들어지지 않는다. 그래도 그런 줄을
   * 만나면 시작부터 다시 받는다 — 종료만 있는 기록은 체류시간을 못 내므로
   * 쓸모가 없다.
   */
  it("종료만 있으면 시작부터 다시 받는다", () => {
    expect(scanStep({ startedAt: null, endedAt: at("09:31") })).toBe("START");
  });
});

describe("stayMinutes — 체류시간", () => {
  it("두 시각의 차를 분으로 센다", () => {
    expect(stayMinutes({ startedAt: at("08:30"), endedAt: at("09:31") })).toBe(61);
  });

  it("하나라도 없으면 null이다 — 추측해 채우지 않는다", () => {
    expect(stayMinutes({ startedAt: at("08:30"), endedAt: null })).toBeNull();
    expect(stayMinutes({ startedAt: null, endedAt: at("09:31") })).toBeNull();
    expect(stayMinutes({ startedAt: null, endedAt: null })).toBeNull();
  });

  it("종료가 시작보다 앞서면 믿지 않는다", () => {
    expect(stayMinutes({ startedAt: at("09:31"), endedAt: at("08:30") })).toBeNull();
  });
});

describe("stayVerdict — 최소시간을 채웠는지", () => {
  const full = { startedAt: at("08:30"), endedAt: at("09:31") };

  it("1시간을 넘기면 통과", () => {
    expect(stayVerdict(full, 60)).toBe("OK");
  });

  it("재량 여유 안쪽은 통과시킨다", () => {
    const grace = { startedAt: at("08:30"), endedAt: at("09:28") }; // 58분
    expect(58 + GRACE_MIN).toBeGreaterThanOrEqual(60);
    expect(stayVerdict(grace, 60)).toBe("OK");
  });

  it("여유를 넘어 모자라면 미달", () => {
    const short = { startedAt: at("08:30"), endedAt: at("09:00") }; // 30분
    expect(stayVerdict(short, 60)).toBe("SHORT");
  });

  it("종료를 안 찍었으면 미달이 아니라 확인 안 됨이다", () => {
    // 참석은 종이 서명으로 증명된다. 체류시간만 모르는 것이라 미달로 적으면
    // 사실과 다르다.
    expect(stayVerdict({ startedAt: at("08:30"), endedAt: null }, 60)).toBe("UNKNOWN");
  });

  it("최소시간 규정이 없는 교육은 언제나 통과", () => {
    expect(stayVerdict({ startedAt: at("08:30"), endedAt: at("08:35") }, null)).toBe("OK");
  });
});

describe("minutesLabel", () => {
  it("시간과 분으로 적는다", () => {
    expect(minutesLabel(0)).toBe("0분");
    expect(minutesLabel(45)).toBe("45분");
    expect(minutesLabel(60)).toBe("1시간");
    expect(minutesLabel(75)).toBe("1시간 15분");
    expect(minutesLabel(120)).toBe("2시간");
  });

  it("모르는 값은 줄표", () => {
    expect(minutesLabel(null)).toBe("—");
  });
});

describe("tally — 회차 집계", () => {
  const scans = [
    { startedAt: at("08:30"), endedAt: at("09:31") }, // 61분 · 통과
    { startedAt: at("08:31"), endedAt: at("09:00") }, // 29분 · 미달
    { startedAt: at("08:32"), endedAt: null }, // 끝을 안 찍음
  ];

  it("명부 인원까지 세어 빠진 사람을 낸다", () => {
    const t = tally(10, scans, 60);
    expect(t).toEqual({
      total: 10,
      started: 3,
      ended: 2,
      ok: 1,
      short: 1,
      unknown: 1,
      missing: 7,
    });
  });

  it("합이 맞는다", () => {
    const t = tally(10, scans, 60);
    expect(t.ok + t.short).toBe(t.ended);
    expect(t.ended + t.unknown).toBe(t.started);
    expect(t.started + t.missing).toBe(t.total);
  });

  it("명부보다 많이 찍혀도 빠진 사람을 음수로 내지 않는다", () => {
    // 명부에서 지워진 사람의 기록이 남아 있을 수 있다.
    expect(tally(2, scans, 60).missing).toBe(0);
  });

  it("아무도 안 찍으면 전원 미기록", () => {
    expect(tally(9, [], 60)).toEqual({
      total: 9,
      started: 0,
      ended: 0,
      ok: 0,
      short: 0,
      unknown: 0,
      missing: 9,
    });
  });
});

describe("newToken", () => {
  it("붙임표를 떼고 24자로 자른다", () => {
    const t = newToken(() => "3f2b1c9a-4d5e-6f70-8192-a3b4c5d6e7f8");
    expect(t).toBe("3f2b1c9a4d5e6f708192a3b4");
    expect(t).toHaveLength(24);
    expect(t).not.toContain("-");
  });

  it("짧은 값이 와도 터지지 않는다", () => {
    expect(newToken(() => "abc")).toBe("abc");
  });
});
