import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 사진 공유 범위는 주소 하나로 정해진다.
 *
 * 공유는 이제 받는 쪽 일지가 없으면 만들어서까지 붙인다. 그래서 이 경계가
 * 무너지면 남의 법인 일지가 새로 생기고 거기에 사진이 들어간다.
 * normalizeAddress 만으로는 그 경계를 지킨다고 말할 수 없어 따로 둔다.
 */

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { site: { findMany: () => findMany() } } }));

const { siblingSites } = await import("@/lib/siteGroup");

const ALL = [
  { id: "b", name: "지지산업 진천", address: "충북진천군 덕산읍 산수산단3로 26", geofenceM: 500, lat: 1, lng: 1 },
  { id: "c", name: "케이지산업 진천", address: "충북 진천군 덕산읍 산수산단3로26", geofenceM: 500, lat: 1, lng: 1 },
  { id: "d", name: "금문철강 음성", address: "충북 음성군 대소읍 성본산단1로 148", geofenceM: 500, lat: 2, lng: 2 },
  { id: "e", name: "주소 없는 곳", address: null, geofenceM: 500, lat: null, lng: null },
  { id: "f", name: "주소 빈 곳", address: "   ", geofenceM: 500, lat: null, lng: null },
];

beforeEach(() => {
  findMany.mockReset();
  // 호출한 사업장 자신은 쿼리에서 이미 빠져 나온다.
  findMany.mockResolvedValue(ALL);
});

describe("siblingSites", () => {
  it("띄어쓰기가 달라도 같은 주소면 묶는다", async () => {
    const got = await siblingSites({ id: "a", address: "충북 진천군 덕산읍 산수산단3로 26" });
    expect(got.map((s) => s.id).sort()).toEqual(["b", "c"]);
  });

  it("다른 주소는 절대 묶지 않는다", async () => {
    const got = await siblingSites({ id: "a", address: "충북 진천군 덕산읍 산수산단3로 26" });
    expect(got.map((s) => s.id)).not.toContain("d");
  });

  it("주소가 비어 있으면 아무 데도 보내지 않는다", async () => {
    // 빈 주소끼리 묶이면 좌표 없는 사업장 전체에 사진이 퍼진다.
    expect(await siblingSites({ id: "a", address: null })).toEqual([]);
    expect(await siblingSites({ id: "a", address: "  " })).toEqual([]);
    // DB를 뒤지지도 않는다.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("주소가 빈 사업장은 대상에 들어오지 않는다", async () => {
    const got = await siblingSites({ id: "a", address: "충북 진천군 덕산읍 산수산단3로 26" });
    expect(got.map((s) => s.id)).not.toContain("e");
    expect(got.map((s) => s.id)).not.toContain("f");
  });
});
