import { prisma } from "@/lib/db";

/**
 * 주소 비교용 정규화. 띄어쓰기만 다른 주소는 같은 곳으로 본다.
 * 관리 화면과 사진 공유가 같은 기준을 써야 해서 여기에 모아 둔다.
 */
export function normalizeAddress(address: string | null): string {
  return (address ?? "").replace(/\s+/g, "");
}

/**
 * 같은 주소를 쓰는 다른 사업장.
 *
 * 외국인 고용 때문에 법인을 쪼개 둔 탓에 공장 하나에 법인이 여럿 들어가 있다.
 * 그 법인들은 아침에 TBM을 한자리에서 함께 하므로 현장 사진도 같은 것을 쓴다.
 *
 * 주소가 비어 있으면 묶지 않는다. 빈 주소끼리 전부 한 덩어리가 되어
 * 엉뚱한 사업장에 사진이 퍼지기 때문이다.
 */
export async function siblingSites(site: { id: string; address: string | null }) {
  const key = normalizeAddress(site.address);
  if (!key) return [];

  const others = await prisma.site.findMany({
    where: { active: true, id: { not: site.id } },
    select: { id: true, name: true, address: true, geofenceM: true, lat: true, lng: true },
  });
  return others.filter((s) => normalizeAddress(s.address) === key);
}
