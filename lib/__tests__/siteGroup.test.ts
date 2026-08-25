import { describe, expect, it } from "vitest";
import { normalizeAddress } from "@/lib/siteGroup";

describe("normalizeAddress", () => {
  it("띄어쓰기만 다른 주소를 같게 본다", () => {
    expect(normalizeAddress("충북 진천군 덕산읍 산수산단3로 26")).toBe(
      normalizeAddress("충북진천군 덕산읍산수산단3로26"),
    );
  });

  it("주소가 없으면 빈 문자열이다", () => {
    // 빈 주소끼리 묶이면 좌표 없는 사업장 전체에 사진이 퍼진다.
    // siblingSites는 이 값이 비면 아무것도 묶지 않는다.
    expect(normalizeAddress(null)).toBe("");
    expect(normalizeAddress("   ")).toBe("");
  });

  it("다른 주소는 다르게 본다", () => {
    expect(normalizeAddress("충북 음성군 대소읍 성본산단1로 148")).not.toBe(
      normalizeAddress("충북 진천군 덕산읍 산수산단3로 26"),
    );
  });
});
