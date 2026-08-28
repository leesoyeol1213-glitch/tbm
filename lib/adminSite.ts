import type { Site } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";

/**
 * 관리 화면에서 다룰 사업장을 정한다.
 * 본사 관리자는 여러 사업장 중 하나를 고르고, 사업장 관리자는 소속 사업장으로 고정된다.
 */
export async function resolveAdminSite(
  user: SessionUser,
  requestedId?: string,
): Promise<{ sites: Site[]; site: Site | null }> {
  const sites = await prisma.site.findMany({
    where:
      user.role === "HQ_ADMIN"
        ? { active: true }
        : { id: { in: user.siteIds.length > 0 ? user.siteIds : ["__none__"] } },
    orderBy: { code: "asc" },
  });

  const site = sites.find((s) => s.id === requestedId) ?? sites[0] ?? null;
  return { sites, site };
}
