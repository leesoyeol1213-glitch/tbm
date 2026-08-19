import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { DeleteSite, NewSiteForm, type SiteSummary } from "@/components/admin/SiteManager";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const user = await requireRole("HQ_ADMIN");

  const sites = await prisma.site.findMany({
    include: {
      _count: { select: { teams: true, workers: true, tbms: true, users: true } },
    },
    orderBy: { code: "asc" },
  });

  const summaries: SiteSummary[] = sites.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    hasCoords: s.lat !== null && s.lng !== null,
    teams: s._count.teams,
    workers: s._count.workers,
    tbms: s._count.tbms,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">사업장</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            본사 관리자만 사업장을 만들고 지울 수 있습니다.
          </p>
        </div>
      </div>

      <NewSiteForm />

      {summaries.length === 0 ? (
        <p className="card text-sm text-slate-500">등록된 사업장이 없습니다.</p>
      ) : (
        <ul className="space-y-2.5">
          {summaries.map((site) => (
            <li key={site.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">
                    <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                      {site.code}
                    </span>
                    {site.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {site.address || "주소 없음"}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-600">
                    팀 {site.teams} · 작업자 {site.workers} · 기록 {site.tbms}건
                  </p>
                </div>
                {!site.hasCoords && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
                    좌표 없음
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
                <Link
                  href={`/admin?site=${site.id}`}
                  className="text-xs font-semibold text-slate-600 hover:underline"
                >
                  설정·좌표
                </Link>
                <Link
                  href={`/admin/teams?site=${site.id}`}
                  className="text-xs font-semibold text-slate-600 hover:underline"
                >
                  작업팀
                </Link>
                <Link
                  href={`/admin/workers?site=${site.id}`}
                  className="text-xs font-semibold text-slate-600 hover:underline"
                >
                  작업자 명부
                </Link>
                <Link
                  href={`/admin/qr?site=${site.id}`}
                  className="text-xs font-semibold text-slate-600 hover:underline"
                >
                  출석 QR
                </Link>
                <span className="ml-auto">
                  <DeleteSite site={site} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {user.role === "HQ_ADMIN" && summaries.some((s) => !s.hasCoords) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          좌표가 없는 사업장은 사진 위치 검증이 동작하지 않습니다. 설정에서 위도·경도를
          넣어 주세요.
        </p>
      )}
    </div>
  );
}
