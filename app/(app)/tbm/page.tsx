import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, siteScope } from "@/lib/authz";
import { dateLabel, daysAgo, kstDateOnly, minuteLabel, ymd } from "@/lib/kst";
import { openTbmAction } from "@/actions/tbm";
import { FlagChips, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function TbmListPage() {
  const user = await requireUser();
  const today = kstDateOnly();

  // 내가 볼 수 있는 팀 범위
  const teamWhere =
    user.role === "TEAM_LEAD"
      ? { leaderId: user.id, active: true }
      : { ...siteScope(user), active: true };

  const teams = await prisma.team.findMany({
    where: teamWhere,
    include: {
      site: { select: { id: true, name: true, dueMinute: true } },
      _count: { select: { workers: { where: { active: true } } } },
    },
    orderBy: [{ site: { code: "asc" } }, { name: "asc" }],
  });

  const teamIds = teams.map((t) => t.id);

  const [todayTbms, recent] = await Promise.all([
    prisma.tbm.findMany({
      where: { teamId: { in: teamIds }, workDate: today },
      include: {
        _count: { select: { photos: true } },
        attendances: { select: { state: true } },
      },
    }),
    prisma.tbm.findMany({
      where: {
        teamId: { in: teamIds },
        workDate: { gte: daysAgo(14), lt: today },
      },
      include: {
        team: { select: { name: true } },
        site: { select: { name: true, dueMinute: true } },
        _count: { select: { photos: true, attendances: true } },
      },
      orderBy: [{ workDate: "desc" }, { team: { name: "asc" } }],
      take: 60,
    }),
  ]);

  const byTeam = new Map(todayTbms.map((t) => [t.teamId, t]));

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-900">오늘의 TBM</h1>
          <p className="text-sm text-slate-500">{dateLabel(today)}</p>
        </div>

        {teams.length === 0 ? (
          <p className="card text-sm text-slate-500">
            담당하는 작업팀이 없습니다. 관리자에게 팀 배정을 요청하세요.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {teams.map((team) => {
              const tbm = byTeam.get(team.id);
              const present =
                tbm?.attendances.filter((a) => a.state !== "ABSENT").length ?? 0;

              return (
                <li key={team.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{team.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {team.site.name} · 인원 {team._count.workers}명 · 마감{" "}
                        {minuteLabel(team.site.dueMinute)}
                      </p>
                    </div>
                    {tbm ? (
                      <StatusBadge status={tbm.status} />
                    ) : (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-300">
                        미시작
                      </span>
                    )}
                  </div>

                  {tbm && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                      <span>
                        출석{" "}
                        <strong className="tabular-nums text-slate-900">
                          {present}/{team._count.workers}
                        </strong>
                      </span>
                      <span>
                        사진{" "}
                        <strong
                          className={`tabular-nums ${tbm._count.photos === 0 ? "text-rose-600" : "text-slate-900"}`}
                        >
                          {tbm._count.photos}장
                        </strong>
                      </span>
                      <FlagChips tbm={tbm} site={team.site} />
                    </div>
                  )}

                  <div className="mt-3">
                    {tbm ? (
                      <Link href={`/tbm/${tbm.id}`} className="btn-secondary w-full sm:w-auto">
                        {tbm.status === "DRAFT" || tbm.status === "REJECTED"
                          ? "이어서 작성"
                          : "기록 보기"}
                      </Link>
                    ) : (
                      <form action={openTbmAction}>
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="workDate" value={ymd(today)} />
                        <button type="submit" className="btn-primary w-full sm:w-auto">
                          오늘 TBM 시작
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">최근 2주 기록</h2>

        {recent.length === 0 ? (
          <p className="card text-sm text-slate-500">지난 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {recent.map((tbm) => (
              <li key={tbm.id}>
                <Link
                  href={`/tbm/${tbm.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {dateLabel(tbm.workDate)} · {tbm.team.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {tbm.site.name} · 출석 {tbm._count.attendances}명 · 사진{" "}
                      {tbm._count.photos}장
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <FlagChips tbm={tbm} site={tbm.site} />
                    <StatusBadge status={tbm.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
