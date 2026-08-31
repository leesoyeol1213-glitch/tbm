import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 좌표를 고치면 이미 올라간 사진의 거리·경고도 따라와야 한다.
 *
 * 인천은 도로명주소가 가리키는 점이 실제 작업 구역에서 693m 떨어져 있었다.
 * 정상 작업 사진에 "현장에서 693m 떨어져 있습니다"가 붙은 채로 결재에
 * 올라갔고, 관리 화면에서 좌표를 고쳐도 그 문구는 그대로 남았다.
 */

const siteFindUnique = vi.fn();
const photoFindMany = vi.fn();
const photoUpdate = vi.fn();
const tbmFindUnique = vi.fn();
const tbmUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    site: { findUnique: (a: unknown) => siteFindUnique(a) },
    tbmPhoto: { findMany: (a: unknown) => photoFindMany(a), update: (a: unknown) => photoUpdate(a) },
    tbm: { findUnique: (a: unknown) => tbmFindUnique(a), update: (a: unknown) => tbmUpdate(a) },
  },
}));

const { recomputeSitePhotos } = await import("@/lib/tbm");

// 동국제강 인천공장 정문
const GATE = { id: "s1", lat: 37.48263, lng: 126.640612, geofenceM: 1000, dueMinute: 510 };
const WORK_DATE = new Date("2026-08-31T00:00:00+09:00");

/** 실제로 인천에서 올라온 사진. 정문에서 148m. */
const PHOTO = {
  id: "p1",
  tbmId: "t1",
  hasExif: true,
  takenAt: WORK_DATE,
  lat: 37.482777,
  lng: 126.638942,
  distanceM: 693,
  warnings: ["촬영 위치가 사업장에서 693m 떨어져 있습니다. (허용 500m)"],
  tbm: { workDate: WORK_DATE },
};

beforeEach(() => {
  for (const m of [siteFindUnique, photoFindMany, photoUpdate, tbmFindUnique, tbmUpdate]) m.mockReset();
  siteFindUnique.mockResolvedValue(GATE);
  photoFindMany.mockResolvedValue([PHOTO]);
  photoUpdate.mockResolvedValue({});
  tbmFindUnique.mockResolvedValue({
    id: "t1",
    workDate: WORK_DATE,
    submittedAt: null,
    site: GATE,
    photos: [{ ...PHOTO, included: true, distanceM: 148 }],
  });
  tbmUpdate.mockResolvedValue({});
});

describe("recomputeSitePhotos", () => {
  it("좌표가 바뀌면 거리와 경고를 다시 매긴다", async () => {
    const touched = await recomputeSitePhotos("s1");

    expect(photoUpdate).toHaveBeenCalledTimes(1);
    const data = photoUpdate.mock.calls[0][0].data;
    expect(data.distanceM).toBe(148);
    // 반경 안이므로 이탈 경고가 사라진다.
    expect(data.warnings).toEqual([]);
    // 플래그까지 다시 매긴 일지 수를 돌려준다.
    expect(touched).toBe(1);
    expect(tbmUpdate).toHaveBeenCalledTimes(1);
  });

  it("결재가 끝난 일지는 건드리지 않는다", async () => {
    // 승인된 문서는 그 시점의 기록이다. 설정을 고쳤다고 조용히 바뀌면 안 된다.
    await recomputeSitePhotos("s1");
    expect(photoFindMany.mock.calls[0][0].where).toEqual({
      tbm: { siteId: "s1", status: { not: "APPROVED" } },
    });
  });

  it("값이 그대로면 사진을 다시 쓰지 않는다", async () => {
    photoFindMany.mockResolvedValue([{ ...PHOTO, distanceM: 148, warnings: [] }]);

    const touched = await recomputeSitePhotos("s1");

    expect(photoUpdate).not.toHaveBeenCalled();
    expect(tbmUpdate).not.toHaveBeenCalled();
    expect(touched).toBe(0);
  });

  it("사업장이 없으면 아무것도 하지 않는다", async () => {
    siteFindUnique.mockResolvedValue(null);
    expect(await recomputeSitePhotos("없음")).toBe(0);
    expect(photoFindMany).not.toHaveBeenCalled();
  });
});
