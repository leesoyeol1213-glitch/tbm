import { describe, expect, it } from "vitest";
import {
  ATTEND_GRACE_MIN,
  GRACE_MIN,
  acceptsScan,
  effectiveStay,
  stayVerdictOf,
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
      manual: 0,
      missing: 7,
      adjusted: 0,
    });
  });

  it("합이 맞는다", () => {
    const t = tally(10, scans, 60);
    expect(t.ok + t.short).toBe(t.ended);
    expect(t.ended + t.unknown).toBe(t.started);
    // 어느 사람도 두 칸에 들어가지 않고, 아무 칸에도 안 들어가지도 않는다.
    expect(t.ok + t.short + t.unknown + t.manual + t.missing).toBe(t.total);
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
      manual: 0,
      missing: 9,
      adjusted: 0,
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

describe("effectiveStay — 수기 확인이 메우는 시각", () => {
  const session = { openedAt: at("08:30"), closedAt: at("09:35") };

  it("수기가 아니면 빈 쪽을 회차 시각으로 메우지 않는다", () => {
    // 유예 바깥(회차 시작 08:30에서 40분 뒤)이라 당겨지지도 않는다.
    const eff = effectiveStay(
      { startedAt: at("09:10"), endedAt: null, manualAt: null },
      session,
    );
    expect(eff).toEqual({
      startedAt: at("09:10"),
      endedAt: null,
      manual: false,
      adjusted: false,
    });
  });

  it("기록이 아예 없으면 빈 채로 둔다", () => {
    expect(effectiveStay(null, session)).toEqual({
      startedAt: null,
      endedAt: null,
      manual: false,
      adjusted: false,
    });
  });

  it("수기면 빈 쪽만 회차 시각으로 메운다 — 실제로 잰 값은 버리지 않는다", () => {
    // 유예 바깥에 찍어 당겨지지 않는 시각을 쓴다. 09:10은 회차 시작에서 40분 뒤다.
    const eff = effectiveStay(
      { startedAt: at("09:10"), endedAt: null, manualAt: at("10:00") },
      session,
    );
    expect(eff.startedAt).toEqual(at("09:10")); // 본인이 찍은 값 그대로
    expect(eff.endedAt).toEqual(at("09:35")); // 비었던 쪽만 회차 시각
    expect(eff.manual).toBe(true);
  });

  it("양쪽이 다 비었으면 회차 시각 전체를 쓴다", () => {
    const eff = effectiveStay(
      { startedAt: null, endedAt: null, manualAt: at("10:00") },
      session,
    );
    expect(eff.startedAt).toEqual(at("08:30"));
    expect(eff.endedAt).toEqual(at("09:35"));
    expect(stayMinutes(eff)).toBe(65);
  });

  /**
   * 열지 않고 닫는 길은 막혀 있지만, 그런 줄을 만나도 시각을 만들어 내서는
   * 안 된다. 빌려 올 값이 없으면 빈 채로 둔다.
   */
  it("회차 시각이 없으면 수기라도 빈 채로 둔다", () => {
    const eff = effectiveStay(
      { startedAt: null, endedAt: null, manualAt: at("10:00") },
      { openedAt: null, closedAt: null },
    );
    expect(eff.startedAt).toBeNull();
    expect(eff.endedAt).toBeNull();
    expect(stayMinutes(eff)).toBeNull();
  });
});

describe("stayVerdictOf — 수기는 통과도 미달도 아니다", () => {
  const session = { openedAt: at("08:30"), closedAt: at("09:35") };

  it("수기로 인정하면 MANUAL이다", () => {
    // 65분이라 최소시간을 넘기지만, 기계가 잰 값이 아니므로 통과로 적지 않는다.
    expect(
      stayVerdictOf({ startedAt: null, endedAt: null, manualAt: at("10:00") }, session, 60),
    ).toBe("MANUAL");
  });

  it("회차가 짧았어도 수기는 미달로 적지 않는다", () => {
    // 미달로 적으면 실제로 참석한 사람을 깎는 셈이 된다. 짧은 것은 회차의
    // 문제이지 그 사람의 문제가 아니다.
    expect(
      stayVerdictOf(
        { startedAt: null, endedAt: null, manualAt: at("10:00") },
        { openedAt: at("08:30"), closedAt: at("08:50") },
        60,
      ),
    ).toBe("MANUAL");
  });

  it("수기가 아니면 평소 판정과 같다", () => {
    expect(
      stayVerdictOf({ startedAt: at("08:30"), endedAt: at("09:31"), manualAt: null }, session, 60),
    ).toBe("OK");
    expect(
      stayVerdictOf({ startedAt: at("08:30"), endedAt: at("09:00"), manualAt: null }, session, 60),
    ).toBe("SHORT");
    expect(
      stayVerdictOf({ startedAt: at("08:30"), endedAt: null, manualAt: null }, session, 60),
    ).toBe("UNKNOWN");
    expect(stayVerdictOf(null, session, 60)).toBe("UNKNOWN");
  });
});

describe("tally — 수기 인정이 섞일 때", () => {
  it("수기는 최소시간 집계에서 빼고, 미기록에서도 뺀다", () => {
    const t = tally(
      5,
      [
        { startedAt: at("08:30"), endedAt: at("09:31"), manualAt: null }, // 통과
        { startedAt: at("08:30"), endedAt: at("09:00"), manualAt: null }, // 미달
        { startedAt: null, endedAt: null, manualAt: at("10:00") }, // 수기
        { startedAt: at("08:30"), endedAt: null, manualAt: null }, // 끝 안 찍음
      ],
      60,
    );
    expect(t.ok).toBe(1);
    expect(t.short).toBe(1);
    expect(t.unknown).toBe(1);
    expect(t.manual).toBe(1);
    // 명부 5명 중 4명이 어떻게든 확인됐으므로 미기록은 1명이다.
    expect(t.missing).toBe(1);
    expect(t.ok + t.short + t.unknown + t.manual + t.missing).toBe(t.total);
  });

  /**
   * 본인이 시작만 찍고 끝을 못 찍어 수기로 인정한 경우. 이 사람은 수기 한 칸에만
   * 들어가야 한다. unknown에도 세면 같은 사람이 두 번 세어진다.
   */
  it("스캔이 있는 사람을 수기로 인정하면 수기 쪽에만 센다", () => {
    const t = tally(
      3,
      [{ startedAt: at("08:30"), endedAt: null, manualAt: at("10:00") }],
      60,
    );
    expect(t.manual).toBe(1);
    expect(t.unknown).toBe(0);
    expect(t.ok).toBe(0);
    expect(t.short).toBe(0);
    expect(t.missing).toBe(2);
    expect(t.ok + t.short + t.unknown + t.manual + t.missing).toBe(t.total);
  });

  it("시작 찍음은 수기와 무관하게 실제 스캔 수다", () => {
    const t = tally(
      3,
      [
        { startedAt: at("08:30"), endedAt: null, manualAt: at("10:00") },
        { startedAt: null, endedAt: null, manualAt: at("10:00") },
      ],
      60,
    );
    expect(t.started).toBe(1); // 수기로 인정했어도 찍은 사람은 한 명
    expect(t.manual).toBe(2);
  });
});

describe("경계로 당겨 인정 — 교육 시각 전후 30분", () => {
  // 회차 09:00 ~ 10:05 (1시간 5분)
  const session = { openedAt: at("09:00"), closedAt: at("10:05") };
  const S = { openedAt: session.openedAt, closedAt: session.closedAt };

  it("유예가 30분이다", () => {
    expect(ATTEND_GRACE_MIN).toBe(30);
  });

  it("경계 바로 옆은 경계로 당긴다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:01"), endedAt: at("10:04"), manualAt: null },
      S,
    );
    expect(eff.startedAt).toEqual(at("09:00"));
    expect(eff.endedAt).toEqual(at("10:05"));
    expect(eff.adjusted).toBe(true);
    expect(stayMinutes(eff)).toBe(65);
  });

  it("25분 늦게 찍고 25분 일찍 찍어도 회차 전체로 인정한다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:25"), endedAt: at("09:40"), manualAt: null },
      S,
    );
    expect(stayMinutes(eff)).toBe(65);
    expect(stayVerdictOf({ startedAt: at("09:25"), endedAt: at("09:40"), manualAt: null }, S, 60)).toBe(
      "OK",
    );
  });

  it("교육 전에 찍은 것도 시작 시각으로 당긴다", () => {
    // 08:40은 회차 시작 20분 전. 교육이 시작되기 전부터 앉아 있었다 해서
    // 체류시간을 더 주지는 않는다 — 경계로 당기므로 09:00이 된다.
    const eff = effectiveStay(
      { startedAt: at("08:40"), endedAt: at("10:04"), manualAt: null },
      S,
    );
    expect(eff.startedAt).toEqual(at("09:00"));
    expect(stayMinutes(eff)).toBe(65);
  });

  /**
   * 당겨 주는 범위를 30분으로 가둔 이유가 이것이다. 잠깐 얼굴만 보이고 간
   * 사람은 그대로 미달로 남아야 측정값에 뜻이 생긴다.
   */
  it("유예 바깥은 찍힌 그대로 둔다 — 12분만 있던 사람은 미달", () => {
    const scan = { startedAt: at("09:00"), endedAt: at("09:12"), manualAt: null };
    const eff = effectiveStay(scan, S);
    expect(eff.endedAt).toEqual(at("09:12")); // 10:05에서 53분 떨어져 당기지 않는다
    expect(eff.adjusted).toBe(false);
    expect(stayMinutes(eff)).toBe(12);
    expect(stayVerdictOf(scan, S, 60)).toBe("SHORT");
  });

  it("아주 늦게 와서 아주 늦게 간 사람도 당겨 주지 않는다", () => {
    // 10:40~10:50은 양쪽 경계에서 모두 30분 넘게 떨어져 있다.
    const scan = { startedAt: at("10:40"), endedAt: at("10:50"), manualAt: null };
    const eff = effectiveStay(scan, S);
    expect(eff.startedAt).toEqual(at("10:40"));
    expect(eff.endedAt).toEqual(at("10:50"));
    expect(stayMinutes(eff)).toBe(10);
    expect(stayVerdictOf(scan, S, 60)).toBe("SHORT");
  });

  it("경계와 똑같이 찍혔으면 보정이 아니다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:00"), endedAt: at("10:05"), manualAt: null },
      S,
    );
    expect(eff.adjusted).toBe(false);
  });

  it("정확히 30분 떨어진 것은 당겨 준다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:30"), endedAt: at("10:05"), manualAt: null },
      S,
    );
    expect(eff.startedAt).toEqual(at("09:00"));
    expect(eff.adjusted).toBe(true);
  });

  it("31분 떨어지면 당겨 주지 않는다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:31"), endedAt: at("10:05"), manualAt: null },
      S,
    );
    expect(eff.startedAt).toEqual(at("09:31"));
    expect(eff.adjusted).toBe(false);
  });

  it("회차 시각이 없으면 당길 데가 없다", () => {
    const eff = effectiveStay(
      { startedAt: at("09:01"), endedAt: at("10:04"), manualAt: null },
      { openedAt: null, closedAt: null },
    );
    expect(eff.startedAt).toEqual(at("09:01"));
    expect(eff.adjusted).toBe(false);
  });

  it("집계에도 당겨 준 숫자가 함께 나온다", () => {
    const t = tally(
      4,
      [
        { startedAt: at("09:25"), endedAt: at("09:40"), manualAt: null }, // 보정 → 통과
        { startedAt: at("09:00"), endedAt: at("10:05"), manualAt: null }, // 그대로 통과
        { startedAt: at("09:00"), endedAt: at("09:12"), manualAt: null }, // 미달
      ],
      60,
      S,
    );
    expect(t.ok).toBe(2);
    expect(t.short).toBe(1);
    expect(t.adjusted).toBe(1);
    // adjusted는 ok에 겹쳐 들어 있으므로 합에는 넣지 않는다.
    expect(t.ok + t.short + t.unknown + t.manual + t.missing).toBe(t.total);
  });
});

describe("acceptsScan — 마감 뒤 30분까지", () => {
  const opened = at("09:00");
  const closed = at("10:05");

  it("열지 않은 회차는 받지 않는다", () => {
    expect(acceptsScan({ openedAt: null, closedAt: null }, at("09:30"))).toBe(false);
  });

  it("열려 있으면 언제든 받는다", () => {
    expect(acceptsScan({ openedAt: opened, closedAt: null }, at("09:30"))).toBe(true);
    expect(acceptsScan({ openedAt: opened, closedAt: null }, at("23:00"))).toBe(true);
  });

  it("마감 뒤 30분까지는 받는다", () => {
    expect(acceptsScan({ openedAt: opened, closedAt: closed }, at("10:06"))).toBe(true);
    expect(acceptsScan({ openedAt: opened, closedAt: closed }, at("10:35"))).toBe(true);
  });

  it("30분을 넘기면 받지 않는다", () => {
    expect(acceptsScan({ openedAt: opened, closedAt: closed }, at("10:36"))).toBe(false);
    expect(acceptsScan({ openedAt: opened, closedAt: closed }, at("18:00"))).toBe(false);
  });
});
