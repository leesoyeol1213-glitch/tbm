import { describe, expect, it } from "vitest";
import {
  DIGEST_PRINT_FROM,
  MAX_DIGEST_LINES,
  buildDigest,
  clipText,
  lineLabel,
  printsDigest,
  type DigestInput,
} from "@/lib/dailyDigest";
import { parseYmd } from "@/lib/kst";

/**
 * 전일 공유 요약본.
 *
 * 여기서 잘리는 줄은 아침에 공유되지 않는 줄이다. 사고가 휴가 공지에 밀려
 * 상한 밖으로 나가면 요약본이 있는 쪽이 없는 쪽보다 나쁘다 — 공유했다고
 * 믿게 되기 때문이다. 그래서 순서와 거름을 테스트로 고정한다.
 */

const TODAY = parseYmd("2026-11-19");
const YESTERDAY = parseYmd("2026-11-18");
const BEFORE = parseYmd("2026-11-17");

function tbm(remarks: string, date = YESTERDAY, over: Partial<DigestInput> = {}): DigestInput {
  return {
    source: "TBM",
    docId: "t1",
    date,
    where: "지지산업(주) 진천",
    detail: "가공1팀",
    remarks,
    ...over,
  } as DigestInput;
}

function patrol(text: string, date = YESTERDAY, over: Partial<DigestInput> = {}): DigestInput {
  return {
    source: "PATROL",
    docId: "p1",
    date,
    where: "진천 1공장",
    detail: "소화기 점검",
    text,
    ...over,
  } as DigestInput;
}

describe("buildDigest — 무엇을 싣는가", () => {
  it("실을 것이 없으면 null", () => {
    expect(buildDigest([], TODAY)).toBeNull();
  });

  it("인원·운영은 싣지 않는다", () => {
    // 특이사항 162줄 가운데 69줄이 휴가·입원·연락이다(2026-11-19 실측).
    // 섞으면 사고가 밀려난다.
    const d = buildDigest([tbm("왓산 입원 중 / 공임수 경조휴가")], TODAY);
    expect(d).toBeNull();
  });

  it("오늘 것은 섞지 않는다", () => {
    // 아침에 방금 쓴 칸이 "어제"로 올라오면 안 된다.
    expect(buildDigest([tbm("벨트슬링 파단품 발견", TODAY)], TODAY)).toBeNull();
  });

  it("한 칸에 여러 건이 적혀 있으면 줄 단위로 쪼갠다", () => {
    const d = buildDigest(
      [tbm("1. 왓산 입원 중\n2. 가공1팀 벨트슬링 파단품 15개 발견")],
      TODAY,
    )!;
    // 인원 사정은 빠지고 위험요인만 남는다. 머리 번호도 떼어진다.
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].text).toBe("가공1팀 벨트슬링 파단품 15개 발견");
  });

  it("두 자 미만 줄은 버린다", () => {
    expect(buildDigest([tbm("-\n.")], TODAY)).toBeNull();
  });
});

describe("buildDigest — 어느 날 것인가", () => {
  it("기록이 있는 가장 가까운 지난 날 하나만 싣는다", () => {
    const d = buildDigest(
      [tbm("크레인 와이어 손상", BEFORE), tbm("지게차 후진 중 근접", YESTERDAY)],
      TODAY,
    )!;
    expect(d.date).toEqual(YESTERDAY);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].text).toBe("지게차 후진 중 근접");
  });

  it("어제가 비어 있으면 그 앞 작업일로 거슬러 간다", () => {
    // 월요일 아침에 주말을 보고 "공유할 것 없음"을 띄우면, 월요일마다
    // 아무것도 공유되지 않는다.
    const monday = parseYmd("2026-11-23");
    const friday = parseYmd("2026-11-20");
    const d = buildDigest([tbm("벨트슬링 파단", friday)], monday)!;
    expect(d.date).toEqual(friday);
  });
});

describe("buildDigest — 무엇을 먼저 싣는가", () => {
  it("사고가 맨 앞이다", () => {
    const d = buildDigest(
      [
        tbm("소화기 압력 미달"),
        patrol("안전난간 일부 파손"),
        tbm("판재 이동 중 손가락 협착으로 병원 치료"),
        tbm("아차사고 — 지게차 후진 중 근접"),
      ],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("ACCIDENT");
    expect(d.lines[1].kind).toBe("NEAR_MISS");
  });

  it("같은 위험요인끼리는 순찰 지적을 먼저 둔다", () => {
    // 점검자가 직접 보고 찍은 것이라 조치로 이어질 확률이 높다.
    const d = buildDigest([tbm("크레인 주의 필요"), patrol("크레인 와이어 손상")], TODAY)!;
    expect(d.lines[0].source).toBe("PATROL");
  });

  it("타사 사례는 우리 사고 아래로 내려간다", () => {
    const d = buildDigest(
      [tbm("타사 중대재해 사고 사례 공유"), tbm("우리 공장 크레인 와이어 손상")],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("HAZARD");
    expect(d.lines[1].kind).toBe("SHARED");
  });
});

describe("buildDigest — 내용 없는 순찰 줄", () => {
  it("조치·비고가 빈 순찰 지적은 뒤로 미룬다", () => {
    // "설비별 안전순회 — 불량"을 읽어도 할 일이 떠오르지 않는다.
    // 2026-11-19 실측: 음성공장의 유일한 지적이 바로 이 모양이었다.
    const d = buildDigest(
      [
        patrol("설비별 안전순회 — 불량", YESTERDAY, { docId: "thin", thin: true }),
        tbm("크레인 와이어 손상 확인"),
      ],
      TODAY,
    )!;
    expect(d.lines[0].source).toBe("TBM");
    expect(d.lines[1].thin).toBe(true);
  });

  it("버리지는 않는다 — 불량이 났다는 사실은 사실이다", () => {
    const d = buildDigest(
      [patrol("설비별 안전순회 — 불량", YESTERDAY, { thin: true })],
      TODAY,
    )!;
    expect(d.lines).toHaveLength(1);
  });

  it("내용이 얇아도 사고는 맨 앞이다", () => {
    const d = buildDigest(
      [
        tbm("크레인 와이어 손상 확인"),
        patrol("작업자 손가락 협착으로 병원 치료", YESTERDAY, { docId: "acc", thin: true }),
      ],
      TODAY,
    )!;
    expect(d.lines[0].docId).toBe("acc");
    expect(d.lines[0].kind).toBe("ACCIDENT");
  });
});

describe("buildDigest — 중복과 상한", () => {
  it("한 공장 네 법인이 같은 것을 적어도 한 줄로 묶는다", () => {
    // 진천은 아침 TBM을 한자리에서 함께 한다. 그대로 두면 다섯 줄이 같은
    // 문장 네 개로 차 버린다.
    const text = "벨트슬링 파단품 15개 발견";
    const d = buildDigest(
      [
        tbm(text, YESTERDAY, { docId: "a", where: "금문철강(주) 진천공장" }),
        tbm(text, YESTERDAY, { docId: "b", where: "지지산업(주) 진천" }),
        tbm(`${text}.`, YESTERDAY, { docId: "c", where: "케이지산업(주) 진천" }),
        tbm(text, YESTERDAY, { docId: "d", where: "(주)지지스틸텍 진천" }),
      ],
      TODAY,
    )!;
    expect(d.lines).toHaveLength(1);
    expect(d.omitted).toBe(0);
  });

  it("상한을 넘으면 자르고 넘친 수를 적는다", () => {
    const inputs = Array.from({ length: 8 }, (_, i) =>
      tbm(`위험요인 ${i} 크레인 점검 필요`, YESTERDAY, { docId: `d${i}` }),
    );
    const d = buildDigest(inputs, TODAY)!;
    expect(d.lines).toHaveLength(MAX_DIGEST_LINES);
    expect(d.omitted).toBe(3);
  });

  it("상한에 걸려도 사고는 잘리지 않는다", () => {
    // 이것이 이 기능 전체에서 제일 중요한 보장이다.
    const noise = Array.from({ length: 8 }, (_, i) =>
      tbm(`크레인 점검 필요 ${i}`, YESTERDAY, { docId: `n${i}` }),
    );
    const d = buildDigest(
      [...noise, tbm("판재 이동 중 손가락 협착으로 병원 치료", YESTERDAY, { docId: "acc" })],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("ACCIDENT");
    expect(d.lines.map((l) => l.docId)).toContain("acc");
  });
});

describe("lineLabel", () => {
  it("순찰에서 온 위험요인은 '순찰 지적'으로 적는다", () => {
    const d = buildDigest([patrol("안전난간 일부 파손")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("순찰 지적");
  });

  it("순찰에서 온 사고는 그대로 '사고 발생'이다", () => {
    const d = buildDigest([patrol("작업자 손가락 협착으로 병원 치료")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("사고 발생");
  });
});

describe("clipText", () => {
  it("짧으면 그대로", () => {
    expect(clipText("크레인 점검", 20)).toBe("크레인 점검");
  });

  it("길면 줄임표를 붙여 자른다", () => {
    const out = clipText("가".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("printsDigest", () => {
  it("기능을 넣은 날 앞의 문서는 종이 모양을 그대로 둔다", () => {
    // 결재가 끝난 문서에 없던 칸이 생기면 보관본과 다시 뽑은 것이 달라진다.
    expect(printsDigest(parseYmd("2026-11-19"))).toBe(false);
    expect(printsDigest(parseYmd("2026-09-01"))).toBe(false);
  });

  it("시행일부터는 찍는다", () => {
    expect(printsDigest(parseYmd(DIGEST_PRINT_FROM))).toBe(true);
    expect(printsDigest(parseYmd("2026-12-01"))).toBe(true);
  });
});
