import { describe, expect, it } from "vitest";
import {
  NATIONAL,
  allNets,
  contactLabel,
  duplicatePhones,
  emergencyBoard,
  emergencyFor,
  telHref,
} from "@/lib/emergency";

/**
 * 비상연락망.
 *
 * 여기 적힌 번호는 불이 났을 때 거는 번호다. 틀리면 화면이 어색해지는 정도가
 * 아니라 전화가 안 닿는다. 그래서 형식과 묶음 기준을 테스트로 고정해 둔다.
 */

const JINCHEON = "충북 진천군 덕산읍 산수산단3로 26";
const EUMSEONG = "충북 음성군 대소읍 성본산단1로 148";
const INCHEON = "인천 제물포구 중봉대로 15";
const CHANGNYEONG = "경남 창녕군 영산면 월령공장길 89";

describe("emergencyFor", () => {
  it("진천 주소면 진천공장 연락망을 준다", () => {
    expect(emergencyFor(JINCHEON)?.factory).toBe("진천공장");
  });

  it("띄어쓰기가 달라도 같은 공장으로 본다", () => {
    // 사업장 주소는 사람이 입력한다. 띄어쓰기로 연락망이 사라지면 안 된다.
    expect(emergencyFor("충북진천군 덕산읍산수산단3로26")?.factory).toBe("진천공장");
  });

  it("아직 등록하지 않은 공장은 null", () => {
    expect(emergencyFor(EUMSEONG)).toBeNull();
    expect(emergencyFor(INCHEON)).toBeNull();
    expect(emergencyFor(CHANGNYEONG)).toBeNull();
  });

  it("주소가 비면 아무 연락망에도 붙이지 않는다", () => {
    // 빈 주소끼리 한 덩어리가 되면 엉뚱한 공장 번호가 걸린다.
    expect(emergencyFor(null)).toBeNull();
    expect(emergencyFor("")).toBeNull();
    expect(emergencyFor("   ")).toBeNull();
  });
});

describe("emergencyBoard", () => {
  it("등록하지 않은 공장에는 아무것도 그리지 않는다", () => {
    // 119만 띄워 두는 것보다, 연락망이 없는 공장은 비워 두는 편이 낫다.
    // "등록되지 않았습니다"라고 적힌 칸은 있으나 마나다.
    for (const address of [EUMSEONG, INCHEON, CHANGNYEONG, null, ""]) {
      expect(emergencyBoard({ address }), String(address)).toBeNull();
    }
  });

  it("주소는 사업장에 적힌 것을 그대로 싣는다 — 신고할 때 제일 먼저 묻는다", () => {
    expect(emergencyBoard({ address: JINCHEON })!.address).toBe(JINCHEON);
  });

  it("119가 맨 앞이다", () => {
    const board = emergencyBoard({ address: JINCHEON })!;
    expect(board.groups[0]).toEqual(NATIONAL);
    expect(board.groups[0].contacts[0].phone).toBe("119");
  });

  it("진천은 경비실·공장장·유관기관·현장수습이 다 붙는다", () => {
    const board = emergencyBoard({ address: JINCHEON })!;
    expect(board.factory).toBe("진천공장");
    expect(board.effectiveFrom).toBe("2026-06-23");
    expect(board.groups).toHaveLength(5);
    const phones = board.groups.flatMap((g) => g.contacts.map((c) => c.phone));
    expect(phones).toContain("010-6318-1267"); // 경비 김진홍
    expect(phones).toContain("010-4120-9391"); // 경비 조항태
    expect(phones).toContain("043-533-1711"); // 중앙제일병원
  });

  it("진천 법인 넷이 같은 연락망을 본다", () => {
    // 한 공장에 법인 네 곳(F01~F04)이 들어가 있다. 불이 나면 같은 경비실로 뛴다.
    // 넷 다 주소가 같으므로 띄어쓰기가 흔들려도 같은 연락망에 붙어야 한다.
    const addresses = [
      "충북 진천군 덕산읍 산수산단3로 26",
      "충북진천군 덕산읍 산수산단3로 26",
      "충북 진천군 덕산읍 산수산단3로26",
      " 충북 진천군 덕산읍 산수산단3로 26 ",
    ];
    for (const address of addresses) {
      expect(emergencyBoard({ address })?.factory, address).toBe("진천공장");
    }
  });
});

describe("telHref", () => {
  it("숫자만 남긴다", () => {
    expect(telHref("010-6318-1267")).toBe("tel:01063181267");
    expect(telHref("043-539-8183")).toBe("tel:0435398183");
  });

  it("짧은 번호도 그대로 건다", () => {
    expect(telHref("119")).toBe("tel:119");
    expect(telHref("182")).toBe("tel:182");
  });
});

describe("contactLabel", () => {
  it("이름이 있으면 역할·이름·번호를 잇는다", () => {
    expect(contactLabel({ role: "경비", name: "김진홍", phone: "010-6318-1267" })).toBe(
      "경비 김진홍 010-6318-1267",
    );
  });

  it("이름이 없으면 역할과 번호만", () => {
    expect(contactLabel({ role: "경비실", name: null, phone: "119" })).toBe("경비실 119");
  });
});

describe("등록된 연락망 전체 점검", () => {
  const nets = allNets();

  it("빈 묶음이나 빈 번호가 없다", () => {
    for (const net of nets) {
      expect(net.groups.length, net.factory).toBeGreaterThan(0);
      for (const g of net.groups) {
        expect(g.contacts.length, `${net.factory} ${g.title}`).toBeGreaterThan(0);
        for (const c of g.contacts) {
          expect(c.role.trim(), `${net.factory} ${g.title}`).not.toBe("");
          expect(c.phone.trim(), `${net.factory} ${g.title} ${c.role}`).not.toBe("");
        }
      }
    }
  });

  it("번호 모양이 전부 전화번호다", () => {
    // 휴대전화, 지역번호, 세 자리 신고번호 셋만 받는다. 오타가 들어오면 걸린다.
    const SHAPE = /^(?:1\d{2}|18\d|0\d{1,2}-\d{3,4}-\d{4})$/;
    for (const net of [...nets, { factory: "공통", groups: [NATIONAL] }]) {
      for (const g of net.groups) {
        for (const c of g.contacts) {
          expect(c.phone, `${net.factory} ${c.role} ${c.name ?? ""}`).toMatch(SHAPE);
        }
      }
    }
  });

  it("시행일이 날짜 모양이다", () => {
    for (const net of nets) {
      expect(net.effectiveFrom, net.factory).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("duplicatePhones", () => {
  it("같은 사람이 두 자리에 올라 있는 것은 중복이 아니다", () => {
    const net = {
      factory: "시험",
      address: "a",
      effectiveFrom: "2026-01-01",
      groups: [
        { title: "1", note: null, contacts: [{ role: "경비", name: "김", phone: "010-1-1" }] },
        { title: "2", note: null, contacts: [{ role: "수습", name: "김", phone: "010-1-1" }] },
      ],
    };
    expect(duplicatePhones(net)).toEqual([]);
  });

  it("이름이 다른데 번호가 같으면 집어낸다", () => {
    const net = {
      factory: "시험",
      address: "a",
      effectiveFrom: "2026-01-01",
      groups: [
        {
          title: "1",
          note: null,
          contacts: [
            { role: "경비", name: "김", phone: "010-1-1" },
            { role: "반장", name: "이", phone: "010-1-1" },
          ],
        },
      ],
    };
    expect(duplicatePhones(net)).toEqual(["010-1-1"]);
  });

  it("등록된 연락망에 겹치는 번호가 없다", () => {
    // 비상연락망에서 사람만 다르고 번호가 같으면 둘 중 하나는 안 닿는다.
    // 260623 종이에는 이승표 반장이 김진홍 경비 번호로 적혀 있었고(오기),
    // 2026-11-18 에 010-6249-7758 로 확인받아 고쳤다.
    for (const net of allNets()) {
      expect(duplicatePhones(net), net.factory).toEqual([]);
    }
  });
});
