import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, siteScope } from "@/lib/authz";
import { dateLabel, daysAgo, kstDateOnly, timeLabel, ymd } from "@/lib/kst";
import { canEditPatrol } from "@/lib/patrolRules";
import { openPatrolAction } from "@/actions/patrol";
import { StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function PatrolListPage() {
  const user = await requireUser();
  const today = kstDateOnly();

  const sites = await prisma.site.findMany({
    where: { ...siteScope(user), active: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const siteIds = sites.map((s) => s.id);

  const [todayPatrols, recent] = await Promise.all([
    prisma.patrol.findMany({
      where: { siteId: { in: siteIds }, patrolDate: today },
      include: { _count: { select: { rounds: true } }, checks: { select: { state: true } } },
    }),
    prisma.patrol.findMany({
      where: {
        siteId: { in: siteIds },
        patrolDate: { gte: daysAgo(30), lt: today },
      },
      include: {
        site: { select: { name: true } },
        checks: { select: { state: true } },
      },
      orderBy: [{ patrolDate: "desc" }, { site: { code: "asc" } }],
      take: 60,
    }),
  ]);

  const bySite = new Map(todayPatrols.map((p) => [p.siteId, p]));
  const canWrite = user.role === "SITE_MANAGER" || user.role === "HQ_ADMIN";

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-900">오늘의 안전순찰</h1>
          <p className="text-sm text-slate-500">{dateLabel(today)}</p>
        </div>

        {sites.length === 0 ? (
          <p className="card text-sm text-slate-500">볼 수 있는 사업장이 없습니다.</p>
        ) : (
          <ul className="space-y-2.5">
            {sites.map((site) => {
              const patrol = bySite.get(site.id);
              const bad = patrol?.checks.filter((c) => c.state === "BAD").length ?? 0;

              return (
                <li key={site.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{site.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{site.code}</p>
                    </div>
                    {patrol ? (
                      <StatusBadge status={patrol.status} />
                    ) : (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-300">
                        미시작
                      </span>
                    )}
                  </div>

                  {patrol && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                      <span>
                        순찰자{" "}
                        <strong className="text-slate-900">
                          {patrol.patrollerName || "미기재"}
                        </strong>
                      </span>
                      <span>순찰사항 {patrol._count.rounds}줄</span>
                      {bad > 0 ? (
                        <span className="font-semibold text-rose-700">불량 {bad}건</span>
                      ) : (
                        <span className="text-emerald-700">전 항목 양호</span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {patrol ? (
                      <Link
                        href={`/patrol/${patrol.id}`}
                        className="text-sm font-semibold text-slate-700 hover:underline"
                      >
                        열어 보기 →
                      </Link>
                    ) : canWrite && canEditPatrol(user, { siteId: site.id, status: "DRAFT" }) ? (
                      <form action={openPatrolAction}>
                        <input type="hidden" name="siteId" value={site.id} />
                        <input type="hidden" name="patrolDate" value={ymd(today)} />
                        <button type="submit" className="btn-primary py-2 text-sm">
                          오늘 순찰일지 열기
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-slate-400">아직 작성되지 않았습니다.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold text-slate-900">지난 30일</h2>
        {recent.length === 0 ? (
          <p className="card text-sm text-slate-500">지난 기록이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((p) => {
              const bad = p.checks.filter((c) => c.state === "BAD").length;
              return (
                <li key={p.id}>
                  <Link href={`/patrol/${p.id}`} className="card block hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {p.site.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {dateLabel(p.patrolDate)}
                          {p.startedAt && ` · ${timeLabel(p.startedAt)}`}
                          {p.patrollerName && ` · ${p.patrollerName}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {bad > 0 && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                            불량 {bad}
                          </span>
                        )}
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
