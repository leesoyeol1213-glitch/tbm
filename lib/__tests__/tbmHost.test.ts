import { describe, expect, it } from "vitest";
import { allHosts, hostLabel, tbmHostFor, tbmHostOn } from "@/lib/tbmHost";
import { parseYmd } from "@/lib/kst";

/**
 * 주재자와 교육 장소.
 *
 * 고용노동부 TBM 예시 양식의 다섯 항목(일자·장소·시간·강사·참석 인원) 중
 * 둘이다. 틀리면 교육시간 인정을 다툴 때 내놓을 기록이 어긋난다.
 */

const JINCHEON = "충북 진천군 덕산읍 산수산단3로 26";
const EUMSEONG = "충북 음성군 대소읍 성본산단1로 148";

describe("tbmHostFor", () => {
  it("진천 주소면 진천공장 주재자를 준다", () => {
    const h = tbmHostFor(JINCHEON)!;
    expect(h.factory).toBe("진천공장");
    expect(h.hostRole).toBe("생산팀장");
    expect(h.place).toBe("출하 게이트");
  });

  it("띄어쓰기가 달라도 같은 공장으로 본다", () => {
    expect(tbmHostFor("충북진천군 덕산읍산수산단3로26")?.factory).toBe("진천공장");
  });

  it("진천 법인 넷이 같은 주재자·장소를 본다", () => {
    // 생산팀장 한 사람이 네 법인을 모두 교육하고, 모두 출하 게이트에서 한다.
    for (const address of [
      "충북 진천군 덕산읍 산수산단3로 26",
      "충북진천군 덕산읍 산수산단3로 26",
      " 충북 진천군 덕산읍 산수산단3로 26 ",
    ]) {
      expect(tbmHostFor(address)?.place, address).toBe("출하 게이트");
    }
  });

  it("등록하지 않은 공장과 빈 주소는 null", () => {
    // 빈 주소끼리 한 덩어리가 되면 엉뚱한 공장 장소가 찍힌다.
    for (const address of [EUMSEONG, null, "", "   "]) {
      expect(tbmHostFor(address), String(address)).toBeNull();
    }
  });
});

describe("tbmHostOn — 시행일", () => {
  it("시행일 앞의 작업일에는 찍지 않는다", () => {
    // 이미 결재가 끝나 종이로 보관된 문서에 없던 칸이 생기면 안 되고,
    // 지난 8월 TBM이 지금의 생산팀장에게 열렸다고 단정할 근거도 없다.
    const h = tbmHostFor(JINCHEON)!;
    const site = { address: JINCHEON };
    expect(tbmHostOn(site, parseYmd("2026-09-01"))).toBeNull();
    expect(tbmHostOn(site, parseYmd("2026-11-19"))).toBeNull();
    expect(tbmHostOn(site, parseYmd(h.effectiveFrom))).not.toBeNull();
    expect(tbmHostOn(site, parseYmd("2026-12-01"))).not.toBeNull();
  });

  it("등록하지 않은 공장은 시행일과 무관하게 null", () => {
    expect(tbmHostOn({ address: EUMSEONG }, parseYmd("2026-12-01"))).toBeNull();
  });
});

describe("hostLabel", () => {
  it("이름이 있으면 역할과 함께 적는다", () => {
    expect(
      hostLabel({
        factory: "x",
        address: "a",
        hostRole: "생산팀장",
        hostName: "홍길동",
        place: "p",
        effectiveFrom: "2026-01-01",
      }),
    ).toBe("생산팀장 홍길동");
  });

  it("이름을 모르면 역할만 적는다", () => {
    // 사람 이름을 추측해 교육 기록에 적을 수는 없다.
    expect(hostLabel(tbmHostFor(JINCHEON)!)).toBe("생산팀장");
  });
});

describe("등록된 주재자 전체 점검", () => {
  it("빈 값이 없고 시행일이 날짜 모양이다", () => {
    for (const h of allHosts()) {
      expect(h.factory.trim(), h.factory).not.toBe("");
      expect(h.hostRole.trim(), h.factory).not.toBe("");
      expect(h.place.trim(), h.factory).not.toBe("");
      expect(h.address.trim(), h.factory).not.toBe("");
      expect(h.effectiveFrom, h.factory).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 이름을 비워 두는 것은 괜찮지만, 빈 글자를 넣어 두면 "생산팀장 "이 찍힌다.
      expect(h.hostName === null || h.hostName.trim() !== "", h.factory).toBe(true);
    }
  });
});
