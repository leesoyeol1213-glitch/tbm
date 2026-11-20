import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_DAYS,
  NOTICE_KIND_LABEL,
  ackRate,
  defaultEndsOn,
  isPosted,
  isUpcoming,
  targetLabel,
  targets,
  visibleNotices,
  type NoticeKind,
  type NoticeLike,
} from "@/lib/notice";
import { parseYmd, ymd } from "@/lib/kst";

/**
 * 공지사항 거르기.
 *
 * 여기가 어긋나면 두 가지로 틀린다. 안 보이거나, 남의 법인에 보인다. 뒤쪽이
 * 더 나쁘다 — 진천 기숙사 사진이 창녕 근로자 폰에 뜨면 공지를 못 믿게 된다.
 */

const TODAY = parseYmd("2026-11-20");

function notice(over: Partial<NoticeLike> = {}): NoticeLike {
  return {
    kind: "TIDY",
    startsOn: parseYmd("2026-11-20"),
    endsOn: parseYmd("2026-12-04"),
    siteIds: [],
    ...over,
  };
}

describe("targets — 누가 받는가", () => {
  it("대상이 비어 있으면 전사 공지다", () => {
    const n = notice({ siteIds: [] });
    expect(targets(n, ["F01"])).toBe(true);
    expect(targets(n, ["F09"])).toBe(true);
  });

  it("고른 법인에만 보낸다", () => {
    // 진천 기숙사 지적이 창녕 근로자 폰에 뜨면 안 된다.
    const n = notice({ siteIds: ["F01", "F02", "F03", "F04"] });
    expect(targets(n, ["F01"])).toBe(true);
    expect(targets(n, ["F04"])).toBe(true);
    expect(targets(n, ["F09"])).toBe(false);
  });

  it("한 곳만 고른 공지는 그 법인만 받는다", () => {
    const n = notice({ siteIds: ["F07"] });
    expect(targets(n, ["F07"])).toBe(true);
    expect(targets(n, ["F08"])).toBe(false);
  });

  it("공용 QR처럼 보는 쪽이 여러 법인이면 하나만 걸려도 받는다", () => {
    // 진천 출하 게이트 QR 하나가 법인 넷 명부를 함께 받는다. 체크인 전에는
    // 보는 사람 법인을 모르므로 넷을 다 넣어 본다.
    const jincheon = ["F01", "F02", "F03", "F04"];
    expect(targets(notice({ siteIds: ["F03"] }), jincheon)).toBe(true);
    expect(targets(notice({ siteIds: ["F09"] }), jincheon)).toBe(false);
  });

  it("보는 쪽이 비면 전사 공지만 받는다", () => {
    expect(targets(notice({ siteIds: [] }), [])).toBe(true);
    expect(targets(notice({ siteIds: ["F01"] }), [])).toBe(false);
  });
});

describe("isPosted — 언제 보이는가", () => {
  it("시작일 당일에 보인다", () => {
    // 올린 날 확인할 수 없으면 올린 사람이 맞게 올렸는지 알 수 없다.
    expect(isPosted(notice({ startsOn: TODAY, endsOn: TODAY }), TODAY)).toBe(true);
  });

  it("종료일 당일에 보인다", () => {
    const n = notice({ startsOn: parseYmd("2026-11-01"), endsOn: TODAY });
    expect(isPosted(n, TODAY)).toBe(true);
  });

  it("종료일 다음 날부터 사라진다", () => {
    const n = notice({ startsOn: parseYmd("2026-11-01"), endsOn: parseYmd("2026-11-19") });
    expect(isPosted(n, TODAY)).toBe(false);
  });

  it("시작일 전에는 안 보인다", () => {
    const n = notice({ startsOn: parseYmd("2026-11-21"), endsOn: parseYmd("2026-12-05") });
    expect(isPosted(n, TODAY)).toBe(false);
    expect(isUpcoming(n, TODAY)).toBe(true);
  });

  it("시각이 섞여 들어와도 같은 날로 본다", () => {
    // DB는 @db.Date 지만 Date 객체로 올라온다. 현지 시각이 묻어 들어오는
    // 경로가 생겨도 날짜 비교가 어긋나면 안 된다.
    const n = notice({
      startsOn: new Date("2026-11-20T15:00:00.000Z"),
      endsOn: new Date("2026-11-20T15:00:00.000Z"),
    });
    expect(ymd(n.startsOn)).toBe("2026-11-21");
    expect(isPosted(n, parseYmd("2026-11-21"))).toBe(true);
  });
});

describe("visibleNotices — 무엇을 먼저 보이는가", () => {
  it("지적이 결과 공유와 일정보다 앞", () => {
    const list = visibleNotices(
      [
        notice({ kind: "SCHEDULE" }),
        notice({ kind: "RESULT" }),
        notice({ kind: "TIDY" }),
      ],
      ["F01"],
      TODAY,
    );
    expect(list.map((n) => n.kind)).toEqual<NoticeKind[]>(["TIDY", "RESULT", "SCHEDULE"]);
  });

  it("같은 분류에서는 늦게 시작한 것이 앞", () => {
    const old = notice({ startsOn: parseYmd("2026-11-10") });
    const fresh = notice({ startsOn: parseYmd("2026-11-19") });
    const list = visibleNotices([old, fresh], ["F01"], TODAY);
    expect(list[0]).toBe(fresh);
  });

  it("대상과 기간을 함께 거른다", () => {
    const list = visibleNotices(
      [
        notice({ siteIds: ["F09"] }), // 남의 법인
        notice({ endsOn: parseYmd("2026-11-19") }), // 지난 것
        notice({ startsOn: parseYmd("2026-11-25") }), // 아직
        notice(), // 이것만 남아야 한다
      ],
      ["F01"],
      TODAY,
    );
    expect(list).toHaveLength(1);
  });

  it("실을 것이 없으면 빈 배열이다", () => {
    expect(visibleNotices([], ["F01"], TODAY)).toEqual([]);
    expect(visibleNotices([notice({ siteIds: ["F09"] })], ["F01"], TODAY)).toEqual([]);
  });
});

describe("defaultEndsOn", () => {
  it("기본 2주 뒤다", () => {
    expect(ymd(defaultEndsOn(parseYmd("2026-11-20")))).toBe("2026-12-04");
    expect(DEFAULT_POST_DAYS).toBe(14);
  });

  it("달을 넘겨도 맞다", () => {
    expect(ymd(defaultEndsOn(parseYmd("2026-12-25")))).toBe("2027-01-08");
  });

  it("원본을 건드리지 않는다", () => {
    const start = parseYmd("2026-11-20");
    defaultEndsOn(start);
    expect(ymd(start)).toBe("2026-11-20");
  });
});

describe("ackRate", () => {
  it("비율을 반올림한다", () => {
    expect(ackRate(41, 60)).toBe(68);
    expect(ackRate(60, 60)).toBe(100);
    expect(ackRate(0, 60)).toBe(0);
  });

  it("대상이 0명이면 null이다", () => {
    // 0%로 적으면 아무도 안 읽은 것처럼 보이는데, 읽을 사람이 없는 것이다.
    expect(ackRate(0, 0)).toBeNull();
    expect(ackRate(0, -1)).toBeNull();
  });
});

describe("targetLabel", () => {
  it("비면 전사", () => {
    expect(targetLabel([])).toBe("전사");
  });

  it("두 곳까지는 다 적는다", () => {
    expect(targetLabel(["진천공장"])).toBe("진천공장");
    expect(targetLabel(["진천공장", "음성공장"])).toBe("진천공장 · 음성공장");
  });

  it("셋 이상은 줄인다", () => {
    expect(targetLabel(["가", "나", "다", "라"])).toBe("가 외 3곳");
  });
});

describe("NOTICE_KIND_LABEL", () => {
  it("분류마다 이름이 있다", () => {
    for (const k of ["TIDY", "RESULT", "SCHEDULE"] as NoticeKind[]) {
      expect(NOTICE_KIND_LABEL[k]).toBeTruthy();
    }
  });
});
