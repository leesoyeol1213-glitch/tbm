import { prisma } from "@/lib/db";

/**
 * QR 토큰으로 체크인 지점과 담당 사업장을 함께 읽는다.
 *
 * 한 물리적 장소에 여러 법인이 들어가 지문인식기를 공용으로 쓰는 경우가 있어,
 * QR 하나가 여러 사업장의 명부를 받을 수 있다. 관리 주체 사업장(point.site)은
 * 항상 담당에 포함된다.
 */
export async function loadPointByToken(token: string) {
  const point = await prisma.checkinPoint.findUnique({
    where: { token },
    include: {
      site: true,
      coverage: { include: { site: true } },
    },
  });
  if (!point) return null;

  const sites = [point.site, ...point.coverage.map((c) => c.site)];
  const unique = [...new Map(sites.map((s) => [s.id, s])).values()].filter(
    (s) => s.active,
  );

  return { point, sites: unique, siteIds: unique.map((s) => s.id) };
}

/** 담당 사업장 목록을 통째로 갈아끼운다. 관리 주체 사업장은 항상 남는다. */
export async function setPointCoverage(
  pointId: string,
  ownerSiteId: string,
  siteIds: string[],
): Promise<void> {
  const wanted = [...new Set(siteIds)].filter((id) => id !== ownerSiteId);

  await prisma.$transaction([
    prisma.checkinPointSite.deleteMany({ where: { pointId } }),
    prisma.checkinPointSite.createMany({
      data: wanted.map((siteId) => ({ pointId, siteId })),
      skipDuplicates: true,
    }),
  ]);
}
