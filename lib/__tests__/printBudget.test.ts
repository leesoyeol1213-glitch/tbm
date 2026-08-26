import { describe, expect, it } from "vitest";
import {
  BUDGET_KB,
  MAX_DOCS,
  estimateKb,
  estimateTotalKb,
  fitBatch,
  type PrintDoc,
} from "@/lib/printBudget";

const tbm = (photoCount: number): PrintDoc => ({ kind: "tbm", photoCount });
const patrol = (): PrintDoc => ({ kind: "patrol", photoCount: 0 });

describe("estimateKb", () => {
  it("사진이 많을수록 커진다", () => {
    expect(estimateKb(tbm(0))).toBeLessThan(estimateKb(tbm(2)));
    expect(estimateKb(tbm(2))).toBeLessThan(estimateKb(tbm(4)));
  });

  it("순찰일지는 사진 장수와 무관하다", () => {
    expect(estimateKb(patrol())).toBe(estimateKb({ kind: "patrol", photoCount: 9 }));
  });

  it("실제로 재 본 크기와 크게 어긋나지 않는다", () => {
    // 인쇄용 800px/품질 72로 만들어 본 값: 0장 136KB, 2장 322KB, 순찰 115KB
    expect(Math.abs(estimateKb(tbm(0)) - 136)).toBeLessThan(20);
    expect(Math.abs(estimateKb(tbm(2)) - 322)).toBeLessThan(30);
    expect(Math.abs(estimateKb(patrol()) - 115)).toBeLessThan(20);
  });
});

describe("fitBatch", () => {
  it("예산 안에서만 담는다", () => {
    const docs = Array.from({ length: 50 }, () => tbm(4));
    const batch = fitBatch(docs, 0);
    expect(estimateTotalKb(batch)).toBeLessThanOrEqual(BUDGET_KB);
    // 한 건 더 담으면 넘어야 한다. 그래야 여유를 남기고 멈춘 것이 아니다.
    expect(estimateTotalKb([...batch, docs[0]])).toBeGreaterThan(BUDGET_KB);
  });

  it("사진이 없는 문서는 더 많이 담는다", () => {
    const heavy = fitBatch(Array.from({ length: 50 }, () => tbm(4)), 0);
    const light = fitBatch(Array.from({ length: 50 }, () => patrol()), 0);
    expect(light.length).toBeGreaterThan(heavy.length);
  });

  it("용량이 남아도 건수 상한에서 멈춘다", () => {
    const docs = Array.from({ length: 200 }, () => patrol());
    expect(fitBatch(docs, 0).length).toBe(MAX_DOCS);
  });

  it("이어서 담으면 빠뜨리는 문서가 없다", () => {
    // 한 달치를 나눠 받는 흐름. 건너뛰거나 겹치면 보관본에 구멍이 난다.
    const docs = Array.from({ length: 137 }, (_, i) => (i % 3 === 0 ? patrol() : tbm(i % 5)));
    const seen: PrintDoc[] = [];
    let cursor = 0;
    while (cursor < docs.length) {
      const batch = fitBatch(docs, cursor);
      expect(batch.length).toBeGreaterThan(0);
      expect(estimateTotalKb(batch)).toBeLessThanOrEqual(BUDGET_KB);
      seen.push(...batch);
      cursor += batch.length;
    }
    expect(seen).toEqual(docs);
  });

  it("혼자서 예산을 넘는 문서도 한 건은 내보낸다", () => {
    // 여기서 빈 묶음을 돌려주면 목록이 그 자리에서 영영 멈춘다.
    const monster: PrintDoc = { kind: "tbm", photoCount: 500 };
    expect(fitBatch([monster, patrol()], 0)).toEqual([monster]);
  });

  it("끝을 넘겨 부르면 빈 묶음", () => {
    expect(fitBatch([patrol()], 5)).toEqual([]);
  });
});
