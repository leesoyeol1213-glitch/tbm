import { describe, expect, it } from "vitest";
import {
  BLANK_ROWS,
  EDU_KINDS,
  EDU_PRESETS,
  countPages,
  findPreset,
} from "@/lib/eduRoster";

describe("법정의무교육 목록", () => {
  it("목록과 종류가 어긋나지 않는다", () => {
    expect(EDU_PRESETS.map((p) => p.kind).sort()).toEqual([...EDU_KINDS].sort());
  });

  it("종류마다 하나씩만 있다", () => {
    const kinds = EDU_PRESETS.map((p) => p.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("모든 교육에 근거와 교육내용이 있다", () => {
    for (const p of EDU_PRESETS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.basis.length).toBeGreaterThan(0);
      expect(p.contents.length).toBeGreaterThan(0);
      // 종이에 "1. " 번호를 붙여 찍으므로 빈 줄이 섞이면 번호만 남는다.
      for (const line of p.contents) expect(line.trim()).toBe(line);
      for (const line of p.contents) expect(line.length).toBeGreaterThan(0);
    }
  });

  /**
   * 직장 내 괴롭힘 예방교육은 고용노동부 법령해석상 의무가 아니다. 이것이
   * 의무로 바뀌어 버리면 화면의 경고가 사라지고, 무엇을 반드시 해야 하는지가
   * 흐려진다. 법이 바뀌어 고칠 때는 이 테스트도 같이 고쳐야 한다.
   */
  it("괴롭힘 예방교육만 의무가 아니다", () => {
    const optional = EDU_PRESETS.filter((p) => !p.mandatory).map((p) => p.kind);
    expect(optional).toEqual(["BULLYING"]);
  });

  it("없는 교육을 고르면 null이다", () => {
    expect(findPreset("HARASSMENT")?.kind).toBe("HARASSMENT");
    expect(findPreset("")).toBeNull();
    expect(findPreset("NOPE")).toBeNull();
    // 폼에서 그대로 넘어오는 값이라 대소문자가 다르면 받지 않는다.
    expect(findPreset("harassment")).toBeNull();
  });
});

describe("countPages — 장수 어림", () => {
  it("빈 줄까지 세어 한 장에 들어가면 한 장이다", () => {
    expect(countPages(10, 17, 31)).toBe(1);
    expect(countPages(17 - BLANK_ROWS, 17, 31)).toBe(1);
  });

  it("한 장을 넘기면 둘째 장부터 더 담는다", () => {
    expect(countPages(17 - BLANK_ROWS + 1, 17, 31)).toBe(2);
    expect(countPages(17 - BLANK_ROWS + 31, 17, 31)).toBe(2);
    expect(countPages(17 - BLANK_ROWS + 31 + 1, 17, 31)).toBe(3);
  });

  it("아무도 없어도 한 장은 나온다", () => {
    expect(countPages(0, 17, 31)).toBe(1);
  });

  it("실제 법인 규모(9~23명)는 모두 두 장 안에 든다", () => {
    for (const n of [9, 10, 14, 17, 18, 19, 23]) {
      expect(countPages(n, 17, 31)).toBeLessThanOrEqual(2);
    }
  });
});
