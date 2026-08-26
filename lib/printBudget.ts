/**
 * 일괄 내려받기 묶음 크기 계산.
 *
 * 서버리스 응답 한도가 약 4.5MB다. 예전에는 "12건"처럼 건수로 끊었는데,
 * 사진이 몇 장 든 문서인지에 따라 건당 크기가 세 배 넘게 차이 나서 어떤 달은
 * 통째로 실패했다. 그래서 건수가 아니라 예상 용량으로 끊는다.
 *
 * 아래 값은 실제로 만들어 재 본 것이다(인쇄용 800px/품질 72 기준).
 *
 *   TBM 사진 없음   136KB      순찰일지        115KB
 *   TBM 사진 1장    229KB      사진 한 장당    +93KB
 *   TBM 사진 2장    322KB
 *
 * 화면과 서버가 같은 식을 써야 "다음 N건" 버튼이 고른 묶음이 서버에서
 * 그대로 통과한다. 그래서 Prisma를 끌어들이지 않고 여기에 따로 둔다.
 */

/** TBM 한 건의 본문 몫. */
export const TBM_BASE_KB = 140;

/** 사진 한 장이 더해지는 몫. */
export const PHOTO_KB = 95;

/** 순찰일지 한 건. 사진이 없어 크기가 일정하다. */
export const PATROL_KB = 120;

/**
 * 한 번에 담을 용량. 4.5MB 한도에 여유를 둔다.
 *
 * 예상은 어디까지나 예상이라 딱 맞춰 채우면 사진이 큰 달에 넘친다.
 * 한 번 더 나눠 받는 것이 통째로 실패하는 것보다 낫다.
 */
export const BUDGET_KB = 3800;

/**
 * 건수 상한. 용량이 남아도 여기서 끊는다.
 *
 * 문서마다 사진을 내려받아 다시 그리므로, 너무 많이 담으면 용량보다
 * 실행 시간이 먼저 걸린다.
 */
export const MAX_DOCS = 20;

export type PrintDoc = { kind: "tbm" | "patrol"; photoCount: number };

/** 이 문서 한 건이 차지할 것으로 보는 크기(KB). */
export function estimateKb(doc: PrintDoc): number {
  if (doc.kind === "patrol") return PATROL_KB;
  return TBM_BASE_KB + doc.photoCount * PHOTO_KB;
}

export function estimateTotalKb(docs: PrintDoc[]): number {
  return docs.reduce((sum, d) => sum + estimateKb(d), 0);
}

/**
 * `from`부터 담을 수 있는 만큼 담는다.
 *
 * 한 건도 못 담는 경우는 없다. 혼자서 예산을 넘는 문서라도 하나는 내보내야
 * 목록이 그 자리에서 멈추지 않는다.
 */
export function fitBatch<T extends PrintDoc>(docs: T[], from: number): T[] {
  const batch: T[] = [];
  let kb = 0;
  for (let i = from; i < docs.length && batch.length < MAX_DOCS; i += 1) {
    const size = estimateKb(docs[i]);
    if (batch.length > 0 && kb + size > BUDGET_KB) break;
    batch.push(docs[i]);
    kb += size;
  }
  return batch;
}
