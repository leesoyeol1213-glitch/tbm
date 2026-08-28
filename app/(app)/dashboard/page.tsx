import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { isCompanyWide, requireRole } from "@/lib/authz";
import { dateLabel, daysAgo, kstDateOnly, ymd } from "@/lib/kst";
import { hasAnyFlag } from "@/lib/tbm";
import { canViewPatrols } from "@/lib/patrolRules";
import { FlagChips, Stat, StatusBadge } from "@/components/badges";
import { PatrolStatusBadge } from "@/components/patrol/PatrolStatusBadge";
import StorageUsage from "@/components/StorageUsage";

export const dynamic = "force-dynamic";

const TREND_DAYS = 7;

export default async function DashboardPage() {
  // 안전실장·본부장은 순찰일지를 결재하므로 각 공장 TBM 현황도 볼 수 있어야 한다.
  const user = await requireRole(
    "CEO",
    "SITE_MANAGER",
    "SAFETY_DIRECTOR",
    "DIVISION_HEAD",
    "HQ_ADMIN",
  );
  const today = kstDateOnly();
  const from = daysAgo(TREND_DAYS - 1);

  const sites = await prisma.site.findMany({
    where: {
      ...(isCompanyWide(user)
        ? {}
        : { id: { in: user.siteIds.length > 0 ? user.siteIds : ["__none__"] } }),
      active: true,
    },
    include: { _count: { select: { teams: { where: { active: true } } } } },
    orderBy: { code: "asc" },
  });
  const siteIds = sites.map((s) => s.id);

  const showPatrols = canViewPatrols(user);

  const [window, flagged, plants, todayPatrols] = await Promise.all([
    prisma.tbm.findMany({
      where: { siteId: { in: siteIds }, workDate: { gte: from, lte: today } },
      select: { siteId: true, workDate: true, status: true },
    }),
    prisma.tbm.findMany({
      where: {
        siteId: { in: siteIds },
        workDate: { gte: daysAgo(13), lte: today },
        status: { not: "DRAFT" },
        OR: [
          { flagLateSubmit: true },
          { flagPhotoDateGap: true },
          { flagOutsideFence: true },
          { flagNoExif: true },
        ],
      },
      include: {
        team: { select: { name: true } },
        site: { select: { name: true, dueMinute: true } },
      },
      orderBy: { workDate: "desc" },
      take: 30,
    }),
    showPatrols
      ? prisma.plant.findMany({
          where: { active: true },
          orderBy: [{ sort: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
    showPatrols
      ? prisma.patrol.findMany({
          where: { patrolDate: today },
          include: { checks: { select: { state: true } } },
        })
      : Promise.resolve([]),
  ]);

  // 사업장별 오늘 현황
  const todayRows = sites.map((site) => {
    const rows = window.filter(
      (t) => t.siteId === site.id && ymd(t.workDate) === ymd(today),
    );
    const expected = site._count.teams;
    const done = rows.filter((t) => t.status === "APPROVED").length;
    const waiting = rows.filter((t) => t.status === "SUBMITTED").length;
    const writing = rows.filter(
      (t) => t.status === "DRAFT" || t.status === "REJECTED",
    ).length;
    const notStarted = Math.max(0, expected - rows.length);
    return { site, expected, done, waiting, writing, notStarted };
  });

  const totalExpected = todayRows.reduce((s, r) => s + r.expected, 0);
  const totalDone = todayRows.reduce((s, r) => s + r.done, 0);
  const totalWaiting = todayRows.reduce((s, r) => s + r.waiting, 0);
  const totalNotStarted = todayRows.reduce((s, r) => s + r.notStarted, 0);

  const patrolByPlant = new Map(todayPatrols.map((p) => [p.plantId, p]));
  const patrolDone = plants.filter(
    (p) => patrolByPlant.get(p.id)?.status === "APPROVED",
  ).length;
  const patrolNotStarted = plants.filter((p) => !patrolByPlant.has(p.id)).length;

  // 최근 7일 이행률 (상신 이상 / 예상 팀 수)
  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = daysAgo(TREND_DAYS - 1 - i);
    const rows = window.filter((t) => ymd(t.workDate) === ymd(date));
    const submitted = rows.filter((t) => t.status !== "DRAFT").length;
    const expected = totalExpected || 1;
    return {
      date,
      submitted,
      expected: totalExpected,
      rate: Math.round((submitted / expected) * 100),
    };
  });

  return (
    <div className="space-y-6">
      {/* --- 오늘 요약 --- */}
      <section className="card">
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-900">오늘 이행 현황</h1>
          <p className="text-sm text-slate-500">{dateLabel(today)}</p>
        </div>

        <p className="mb-2 text-xs font-semibold text-slate-500">TBM (작업팀 기준)</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="대상 작업팀" value={`${totalExpected}팀`} />
          <Stat label="승인 완료" value={`${totalDone}팀`} tone="ok" />
          <Stat label="결재 대기" value={`${totalWaiting}팀`} />
          <Stat
            label="미시작"
            value={`${totalNotStarted}팀`}
            tone={totalNotStarted > 0 ? "warn" : "ok"}
          />
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{
              width: `${totalExpected ? Math.round((totalDone / totalExpected) * 100) : 0}%`,
            }}
          />
        </div>

        {showPatrols && plants.length > 0 && (
          <>
            <p className="mt-5 mb-2 text-xs font-semibold text-slate-500">
              안전(순찰)일지 (공장 기준)
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="대상 공장" value={`${plants.length}곳`} />
              <Stat label="승인 완료" value={`${patrolDone}곳`} tone="ok" />
              <Stat
                label="결재 진행"
                value={`${todayPatrols.filter((p) => p.status === "SUBMITTED").length}곳`}
              />
              <Stat
                label="미시작"
                value={`${patrolNotStarted}곳`}
                tone={patrolNotStarted > 0 ? "warn" : "ok"}
              />
            </div>
          </>
        )}
      </section>

      {/* --- 공장별 순찰 --- */}
      {showPatrols && plants.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">공장별 순찰</h2>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {plants.map((plant) => {
              const patrol = patrolByPlant.get(plant.id);
              const bad = patrol?.checks.filter((c) => c.state === "BAD").length ?? 0;
              return (
                <li key={plant.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-bold text-slate-900">
                      {plant.name}
                    </p>
                    {patrol ? (
                      <PatrolStatusBadge status={patrol.status} />
                    ) : (
                      <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-inset ring-rose-300">
                        미시작
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {patrol ? (
                      <>
                        {patrol.patrollerName || "순찰자 미기재"}
                        {bad > 0 ? (
                          <span className="ml-1.5 font-semibold text-rose-700">
                            불량 {bad}건
                          </span>
                        ) : (
                          <span className="ml-1.5 text-emerald-700">전 항목 양호</span>
                        )}
                      </>
                    ) : (
                      "오늘 순찰일지가 아직 없습니다."
                    )}
                  </p>
                  {patrol && (
                    <Link
                      href={`/patrol/${patrol.id}`}
                      className="mt-2 block text-xs font-semibold text-slate-600 hover:underline"
                    >
                      열어 보기 →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* --- 사업장별 TBM --- */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">사업장별 TBM</h2>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {todayRows.map((row) => {
            const rate = row.expected
              ? Math.round((row.done / row.expected) * 100)
              : 0;
            return (
              <li key={row.site.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{row.site.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      {row.site.code}
                    </p>
                  </div>
                  {row.notStarted > 0 ? (
                    <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-inset ring-rose-300">
                      미시작 {row.notStarted}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300">
                      전 팀 시작
                    </span>
                  )}
                </div>

                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${rate}%` }}
                  />
                </div>

                {/* 숫자를 한 줄에 몰아 둔다. 카드가 많아 세로로 길어지면 한눈에 안 들어온다. */}
                <p className="mt-2 text-xs tabular-nums text-slate-600">
                  대상 <strong className="text-slate-900">{row.expected}</strong>
                  <span className="mx-1 text-slate-300">·</span>
                  승인 <strong className="text-emerald-700">{row.done}</strong>
                  <span className="mx-1 text-slate-300">·</span>
                  대기 <strong className="text-amber-700">{row.waiting}</strong>
                  <span className="mx-1 text-slate-300">·</span>
                  작성중 <strong className="text-slate-900">{row.writing}</strong>
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- 최근 7일 추이 --- */}
      <section className="card">
        <h2 className="mb-1 font-bold text-slate-900">최근 7일 실시율</h2>
        <p className="mb-4 text-xs text-slate-500">
          상신 이상 기록 수 ÷ 대상 작업팀 수
        </p>

        <ul className="flex items-end justify-between gap-2">
          {trend.map((d) => (
            <li key={ymd(d.date)} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-xs font-semibold tabular-nums text-slate-600">
                {d.rate}%
              </span>
              <div className="flex h-24 w-full items-end rounded-md bg-slate-100">
                <div
                  className={`w-full rounded-md transition-all ${
                    d.rate >= 100
                      ? "bg-emerald-500"
                      : d.rate >= 70
                        ? "bg-amber-400"
                        : "bg-rose-400"
                  }`}
                  style={{ height: `${Math.min(100, d.rate)}%` }}
                />
              </div>
              <span className="text-xs text-slate-400">{ymd(d.date).slice(5)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* --- 검증 경고 --- */}
      <section>
        <h2 className="mb-1 text-lg font-bold text-slate-900">자동 검증 경고</h2>
        <p className="mb-3 text-xs text-slate-500">
          최근 2주간 사후 작성·현장 이탈이 의심되는 기록입니다.
        </p>

        {flagged.length === 0 ? (
          <p className="card text-sm text-slate-500">경고가 걸린 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {flagged.filter(hasAnyFlag).map((tbm) => (
              <li key={tbm.id}>
                <Link
                  href={`/tbm/${tbm.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {dateLabel(tbm.workDate)} · {tbm.site.name} {tbm.team.name}
                    </p>
                    <div className="mt-1">
                      <FlagChips tbm={tbm} site={tbm.site} />
                    </div>
                  </div>
                  <StatusBadge status={tbm.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        저장 용량은 본사만 본다. 현장에서는 손쓸 수 있는 일이 아니고,
        저장소에 직접 물어보느라 느릴 수 있어 Suspense로 감싼다.
        이 칸이 늦어도 위의 현황은 먼저 뜬다.
      */}
      {user.role === "HQ_ADMIN" && (
        <Suspense
          fallback={
            <section className="card">
              <h2 className="font-bold text-slate-900">저장 용량</h2>
              <p className="mt-2 text-sm text-slate-500">재는 중…</p>
            </section>
          }
        >
          <StorageUsage />
        </Suspense>
      )}
    </div>
  );
}
