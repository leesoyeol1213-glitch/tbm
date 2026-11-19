import { KIND_LABEL, classifyNote, splitNote, type NoteKind } from "@/lib/hazardLog";
import { ymd } from "@/lib/kst";

/**
 * 전일 공유 요약본.
 *
 * 아침 TBM에서 어제 무슨 일이 있었는지 되돌려 준다. 새로 적게 하는 것은 없다 —
 * 어제 이미 적힌 TBM 특이사항과 순찰 지적에서 중한 것만 골라 다시 보여 준다.
 *
 * 만든 이유는 둘이다.
 *
 * 하나. 안전보건교육규정(고용노동부고시 제2023-63호) 제4조는 TBM을 산업안전보건법
 * 정기교육 시간으로 인정하는데, 인정되는 내용에 "최근 이슈나 사고"가 들어 있다.
 * 지금 우리 교육 항목은 매일 양식에서 복사된 같은 줄이라 그 요건을 대지 못한다.
 * 어제 난 사고를 오늘 아침에 공유한 기록이 날짜별로 쌓이면 그것이 증빙이 된다.
 *
 * 둘. 「사업장 위험성평가에 관한 지침」의 상시적 위험성평가는 매 작업일 작업 전
 * 안전점검회의로 위험요인을 공유·주지하게 한다. 어제 올라온 것을 오늘 아침에
 * 돌려주는 것이 그 공유다.
 *
 * TBM의 위험요인 칸(HazardItem)은 여기 쓰지 않는다. 3,415줄 전부가 템플릿
 * 복사본이라(2026-11 확인) 되돌려 줘도 같은 다섯 문장이 매일 되풀이된다.
 * 사람이 그날 손으로 적은 것은 특이사항 칸과 순찰 지적뿐이고, 그것만 싣는다.
 */

/** 요약본에 실을 한 줄. */
export type DigestLine = {
  /** ADMIN(인원·운영)은 걸러져서 여기 오지 않는다. */
  kind: NoteKind;
  source: "TBM" | "PATROL";
  /** 원본 문서로 가는 링크에 쓸 id */
  docId: string;
  /** 작업일 또는 순찰일 */
  date: Date;
  /** 법인 이름(TBM) 또는 공장 이름(순찰) */
  where: string;
  /** 작업팀(TBM) 또는 점검 항목·순찰 장소(순찰). 없으면 null */
  detail: string | null;
  /** 개조식으로 줄인 본문. terseText를 볼 것. */
  text: string;
  /** 사람이 적은 그대로. 줄이는 과정에서 뜻이 바뀌었는지 볼 수 있게 남긴다. */
  raw: string;
  /**
   * "~하도록 합시다"처럼 하라고 한 말인지. 어제 무엇을 발견했다는 말과
   * 무엇을 하라고 당부한 말은 읽는 사람이 할 일이 다르다.
   */
  urging: boolean;
  /**
   * 사람이 적은 내용이 없는 줄. 순찰에서 불량 판정만 찍고 조치·비고를 비워
   * 둔 경우다. 본문이 양식 문구("설비별 안전순회")뿐이라 읽어도 무슨 일이
   * 있었는지 알 수 없다. 버리지는 않고 뒤로 미룬다 — 불량이 났다는 사실은
   * 사실이고, 원본을 열어 보면 된다.
   */
  thin: boolean;
};

export type DailyDigest = {
  /**
   * 요약한 날. 어제가 아니라 "기록이 있는 가장 가까운 지난 작업일"이다.
   * 월요일 아침에는 금요일 것이 올라온다 — 주말에 빈 요약본을 띄우면
   * 월요일마다 아무것도 공유되지 않는다.
   */
  date: Date;
  lines: DigestLine[];
  /** 상한을 넘겨 싣지 못한 줄 수 */
  omitted: number;
};

/** 요약본에 넣을 원자료. 부르는 쪽이 DB에서 긁어 온 그대로 넣는다. */
export type DigestInput =
  | {
      source: "TBM";
      docId: string;
      date: Date;
      where: string;
      detail: string | null;
      /** 특이사항 칸 전체. 한 칸에 여러 건이 들어오므로 여기서 쪼갠다. */
      remarks: string | null;
    }
  | {
      source: "PATROL";
      docId: string;
      date: Date;
      where: string;
      detail: string | null;
      text: string;
      /** 조치·비고가 비어 본문이 양식 문구뿐인지. DigestLine.thin을 볼 것. */
      thin?: boolean;
    };

/**
 * 한 화면에 실을 줄 수.
 *
 * 다섯 줄로 묶는다. 어제 올라온 것을 다 띄우면 사흘 만에 아무도 안 읽는다 —
 * 길어서 안 읽히는 공유는 안 한 것과 같다. 넘친 수는 따로 적어, 더 있다는
 * 사실만은 숨기지 않는다.
 */
export const MAX_DIGEST_LINES = 5;

/**
 * 요약본을 출력물에 싣기 시작하는 작업일.
 *
 * 이 날 앞의 문서는 종이 모양을 그대로 둔다. 이미 결재가 끝난 기록에 없던 칸이
 * 생기면, 보관 중인 종이와 다시 뽑은 PDF가 달라진다. 결재가 끝난 문서는 조용히
 * 바뀌어서는 안 된다.
 *
 * 2026-11-19에 만들었으나 그날 문서는 이미 결재가 끝났을 수 있어 다음 날로 둔다.
 */
export const DIGEST_PRINT_FROM = "2026-11-20";

/** 이 작업일의 문서에 요약본을 찍어도 되는지. */
export function printsDigest(workDate: Date): boolean {
  return ymd(workDate) >= DIGEST_PRINT_FROM;
}

/**
 * 중한 것부터. 사고가 아차사고 아래로 내려가거나, 순찰 지적이 되풀이되는
 * 주의 문구에 밀려 잘려 나가면 요약본의 뜻이 없다.
 */
const KIND_RANK: Record<NoteKind, number> = {
  ACCIDENT: 0,
  NEAR_MISS: 1,
  HAZARD: 3,
  SHARED: 4,
  ADMIN: 9,
};

function rank(line: DigestLine): number {
  // 사고·아차사고는 내용이 얇든 어떻든 맨 앞이다. 어제 사람이 다쳤다는 말이
  // 뒤로 밀리는 규칙은 두지 않는다.
  if (line.kind === "ACCIDENT" || line.kind === "NEAR_MISS") return KIND_RANK[line.kind];

  // 사람이 적은 내용이 없으면 뒤로. 다섯 줄 가운데 한 칸을 "설비별 안전순회"가
  // 차지하면 그만큼 읽을 것이 줄어든다.
  if (line.thin) return KIND_RANK[line.kind] + 2;

  // 당부한 말은 발견한 것 아래로. "보호구 착용 철저"는 매일 할 수 있는 말이고,
  // "벨트슬링 파단품 15개 발견"은 어제만의 일이다.
  if (line.urging && line.kind === "HAZARD") return KIND_RANK[line.kind] + 1;

  // 순찰 지적은 점검자가 직접 보고 찍은 것이라, 같은 위험요인끼리는 먼저 둔다.
  const patrolBoost = line.source === "PATROL" && line.kind === "HAZARD" ? 1 : 0;
  return KIND_RANK[line.kind] - patrolBoost;
}

/** 화면과 출력물에 붙일 꼬리표. */
export function lineLabel(line: DigestLine): string {
  if (line.source === "PATROL" && line.kind === "HAZARD") return "순찰 지적";
  // 하라고 당부한 말은 발견한 것과 구분한다. 진천 특이사항 칸이 실제로는
  // 아침 훈화로 쓰이고 있어(2026-11-19 실측), 둘을 같은 꼬리표로 묶으면
  // "위험요인 — 작업전 스트레칭"처럼 읽힌다.
  if (line.urging && line.kind === "HAZARD") return "권장";
  return KIND_LABEL[line.kind];
}

/**
 * 서술형 문장을 개조식으로 줄인다.
 *
 * 특이사항 칸은 "~하도록 합시다"로 끝나는 문장으로 적힌다. 그대로 되돌려
 * 주면 "어제 스트레칭하라고 했습니다"처럼 읽혀, 어제 무슨 일이 있었는지가
 * 아니라 누가 무슨 말을 했는지가 남는다. 어미를 떼고 알맹이만 남긴다.
 *
 * 앞뒤를 자르지 않는 것이 규칙이다. 꼬리의 어미와 뜻 없는 군더더기만 뗀다 —
 * "호이스트 체인고리 훅해지장치 파손시 즉시 교체"에서 한 마디라도 줄이려
 * 들면 제일 값어치 있는 말이 날아간다. 원문은 raw에 그대로 남는다.
 */
const URGING_TAIL =
  /\s*(?:하|해)?\s*(?:도록|시기)?\s*(?:합시다|합니다|하십시오|하세요|바랍니다|바람|주세요|주십시오|주시기\s*바랍니다|해야\s*한다|할\s*것|하자)\s*[.!~]*$/;

/** 꼬리에 남는 뜻 없는 말. "체조 등을 하고 작업" → "체조" */
const TRAIL_FILLER = /\s*등(?:을|를|의)?\s*(?:하고|해서|하여)?\s*(?:작업|실시|진행)?\s*$/;

/** 꼬리에 매달린 조사·접속사 */
const TRAIL_DANGLE = /\s*(?:을|를|이|가|은|는|및|과|와|하고|하여|해서)\s*$/;

export function terseText(raw: string): { text: string; urging: boolean } {
  let t = raw.replace(/\s+/g, " ").trim();

  const urging = URGING_TAIL.test(t);
  if (urging) t = t.replace(URGING_TAIL, "");

  t = t.replace(TRAIL_FILLER, "");
  // 조사가 겹쳐 남는 경우가 있다("…을 하고" → "…을" → "…").
  for (let i = 0; i < 3; i += 1) t = t.replace(TRAIL_DANGLE, "");
  // 개조식에서는 부사도 명사형으로 끝낸다. "착용 철저히" → "착용 철저"
  t = t.replace(/철저히$/, "철저");
  t = t.replace(/[\s,.·]+$/, "");

  // 전부 떨어져 나가면 줄이지 않은 것으로 둔다. 빈 줄을 공유할 수는 없다.
  const text = t.trim();
  return { text: text || raw.replace(/\s+/g, " ").trim(), urging };
}

/** 긴 줄을 자른다. 출력물은 한 줄이 길어지면 쪽수가 늘어난다. */
export function clipText(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * 같은 내용인지 보는 열쇠.
 *
 * 한 공장에 법인이 넷 들어가 있고 아침 TBM을 한자리에서 함께 한다. 그래서
 * 같은 사고가 네 법인 특이사항에 똑같이 적히는 일이 흔하다. 그대로 두면
 * 요약본 다섯 줄이 같은 문장 네 개로 차 버린다.
 */
function sameKey(line: DigestLine): string {
  return line.text.replace(/[\s.,·/]+/g, "").toLowerCase();
}

/**
 * 요약본을 만든다. 실을 것이 없으면 null.
 *
 * @param before 이 날보다 앞선 기록만 본다. 보통 오늘(KST 자정).
 *   오늘 것을 섞으면 아침에 방금 쓴 칸이 "어제"로 올라온다.
 */
export function buildDigest(
  inputs: DigestInput[],
  before: Date,
  maxLines: number = MAX_DIGEST_LINES,
): DailyDigest | null {
  const cut = before.getTime();
  const all: DigestLine[] = [];

  for (const input of inputs) {
    if (input.date.getTime() >= cut) continue;

    // 특이사항은 한 칸에 여러 건이 들어온다. "1. 왓산 입원 중 / 2. 벨트슬링
    // 파단"처럼 적히므로 칸째로 분류하면 사고가 인원 사정에 묻힌다.
    const texts =
      input.source === "TBM" ? splitNote(input.remarks) : [input.text.trim()];

    for (const raw of texts) {
      if (raw.length < 2) continue;
      // 분류는 원문으로 한다. 어미를 떼고 나면 "아차사고 — …"의 표지나
      // "타사 사례" 같은 단서가 사라질 수 있다.
      const kind = classifyNote(raw);
      const { text, urging } = terseText(raw);
      // 인원·연락·운영은 공유할 위험이 아니다. 특이사항의 절반 가까이가
      // 여기라, 섞으면 사고가 휴가 공지에 밀려 잘린다.
      if (kind === "ADMIN") continue;
      all.push({
        kind,
        source: input.source,
        docId: input.docId,
        date: input.date,
        where: input.where,
        detail: input.detail,
        text,
        raw,
        urging,
        thin: input.source === "PATROL" && input.thin === true,
      });
    }
  }

  if (all.length === 0) return null;

  // 기록이 있는 가장 가까운 지난 날 하나만 싣는다. 여러 날을 모으면 어제 난
  // 사고와 지난주 일이 같은 무게로 보인다.
  const latest = Math.max(...all.map((l) => l.date.getTime()));
  const sameDay = all.filter((l) => l.date.getTime() === latest);

  // 중한 것부터 세운 뒤에 중복을 뗀다. 같은 문장이 둘이면 꼬리표가 더 무거운
  // 쪽(사고 쪽)이 남아야 한다.
  sameDay.sort((a, b) => rank(a) - rank(b));

  const seen = new Set<string>();
  const unique: DigestLine[] = [];
  for (const line of sameDay) {
    const key = sameKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }

  return {
    date: new Date(latest),
    lines: unique.slice(0, maxLines),
    omitted: Math.max(0, unique.length - maxLines),
  };
}
