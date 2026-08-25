import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { dateLabel, daysAgo, kstDateOnly, timeLabel, ymd } from "@/lib/kst";
import { canViewPatrols, managedPlantIds } from "@/lib/patrol";
import { openPatrolAction } from "@/actions/patrol";
import { PatrolStatusBadge } from "@/components/patrol/PatrolStatusBadge";

export const dynamic = "force-dynamic";

export default async function PatrolListPage() {
  const user = await requireUser();
  if (!canViewPatrols(user)) notFound();

  const today = kstDateOnly();
  const [plants, mine] = await Promise.all([
    prisma.plant.findMany({
      where: { active: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    }),
    managedPlantIds(user),
  ]);
  const plantIds = plants.map((p) => p.id);
  const canWrite = new Set(mine);

  const [todayPatrols, recent] = await Promise.all([
    prisma.patrol.findMany({
      where: { plantId: { in: plantIds }, patrolDate: today },
      include: {
        _count: { select: { rounds: true } },
        checks: { select: { state: true } },
      },
    }),
    prisma.patrol.findMany({
      where: { plantId: { in: plantIds }, patrolDate: { gte: daysAgo(30), lt: today } },
      include: {
        plant: { select: { name: true } },
        checks: { select: { state: true } },
      },
      orderBy: [{ patrolDate: "desc" }, { plant: { sort: "asc" } }],
      take: 60,
    }),
  ]);

  const byPlant = new Map(todayPatrols.map((p) => [p.plantId, p]));

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-900">오늘의 안전순찰</h1>
          <p className="text-sm text-slate-500">{dateLabel(today)}</p>
        </div>

        {plants.length === 0 ? (
          <p className="card text-sm text-slate-500">
            등록된 공장이 없습니다. 관리 → 공장에서 먼저 만들어 주세요.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {plants.map((plant) => {
              const patrol = byPlant.get(plant.id);
              const bad = patrol?.checks.filter((c) => c.state === "BAD").length ?? 0;

              return (
                <li key={plant.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{plant.name}</p>
                      {plant.address && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {plant.address}
                        </p>
                      )}
                    </div>
                    {patrol ? (
                      <PatrolStatusBadge status={patrol.status} />
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
                    ) : canWrite.has(plant.id) ? (
                      <form action={openPatrolAction}>
                        <input type="hidden" name="plantId" value={plant.id} />
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
                          {p.plant.name}
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
                        <PatrolStatusBadge status={p.status} />
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
