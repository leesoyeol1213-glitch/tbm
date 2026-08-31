/**
 * 결재완료함 목록을 불러올 때 쓰는 값들.
 */

/**
 * 한 번에 불러올 문서 수 상한(종류별).
 *
 * 예전 상한은 200건이었다. 12개 팀이 매일 올리면 한 달에 TBM만 약 264건이라
 * 첫 달부터 모자란다. 목록은 최신순이라 넘치는 만큼이 그 달 앞쪽부터 조용히
 * 사라지고, "전체 선택 (200)"을 누른 사람은 다 받은 줄 안다.
 *
 * 그래서 한 달치는 넉넉히 담기게 올리되, 무제한으로 두지는 않는다. 분기나
 * 전체를 고르면 결국 넘치므로, 넘친 사실은 화면에 그대로 알린다.
 */
export const APPROVED_CAP = 1000;

/**
 * 종이 서명을 받았는지로 갈라 보는 칸.
 *
 * 전자결재가 끝나도 일이 끝난 게 아니다. 출력해서 최종결재자 서명을 받고
 * 보관해야 비로소 끝난다. 그런데 8월 승인 24건 가운데 수기결재로 표시된 건이
 * 한 건도 없었다. 끝난 것과 안 끝난 것이 한 목록에 섞여 있으면, 월말에 남은
 * 일을 세려면 285장을 눈으로 훑는 수밖에 없다.
 *
 * 그래서 남은 일을 기본으로 보여주고, 끝난 건은 다른 칸으로 치운다.
 */
export type PaperState = "waiting" | "done" | "all";

export const PAPER_STATES: PaperState[] = ["waiting", "done", "all"];

export const PAPER_STATE_LABEL: Record<PaperState, string> = {
  waiting: "출력·서명 대기",
  done: "보관 완료",
  all: "전체",
};

export function isPaperState(v: string): v is PaperState {
  return (PAPER_STATES as string[]).includes(v);
}

/** 해당 칸만 남기는 조회 조건. */
export function paperFilter(
  state: PaperState,
): { paperSignedAt?: null | { not: null } } {
  if (state === "waiting") return { paperSignedAt: null };
  if (state === "done") return { paperSignedAt: { not: null } };
  return {};
}

/**
 * 칸별 건수.
 *
 * 목록은 상한에서 잘리므로 건수는 따로 세어 넘겨받는다. 전체와 대기만 세고
 * 완료는 빼서 구한다 — 질의를 하나 줄이려는 것이고, 둘은 항상 같은 시점의
 * 숫자라 어긋나지 않는다.
 */
export function countFor(
  state: PaperState,
  total: number,
  waiting: number,
): number {
  if (state === "waiting") return waiting;
  if (state === "done") return total - waiting;
  return total;
}

/**
 * 서류철 단위로 묶는다.
 *
 * 목록은 날짜순 한 줄이었다. 그런데 서류철은 법인별로 따로 맨다. 한 줄에 10개
 * 사업장이 섞여 있으면 F01 것을 모으려고 목록 전체를 훑어야 한다.
 *
 * groupKey는 묶는 기준이면서 묶음의 차례이기도 하다. 조회는 최신순이어야
 * 상한에 걸렸을 때 오래된 것부터 잘리므로(사업장 하나가 통째로 사라지지
 * 않는다), 묶음의 차례는 조회 순서와 따로 여기서 키로 세운다.
 */
export type BinderDoc = {
  /** 묶는 기준이자 묶음의 차례. 사업장은 코드, 공장은 정렬값을 앞에 붙인 이름. */
  groupKey: string;
  groupLabel: string;
  paperLabel: string | null;
};

export type Binder<T> = {
  key: string;
  label: string;
  docs: T[];
  /** 이 묶음에서 아직 종이 서명을 받지 않은 건수. */
  waiting: number;
};

export function groupByBinder<T extends BinderDoc>(docs: T[]): Binder<T>[] {
  const byKey = new Map<string, Binder<T>>();
  for (const d of docs) {
    let binder = byKey.get(d.groupKey);
    if (!binder) {
      binder = { key: d.groupKey, label: d.groupLabel, docs: [], waiting: 0 };
      byKey.set(d.groupKey, binder);
    }
    binder.docs.push(d);
    if (!d.paperLabel) binder.waiting += 1;
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
