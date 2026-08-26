import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { dateLabel, kstDateOnly, minuteLabel } from "@/lib/kst";
import { checkinWindowState } from "@/lib/tbm";
import { loadPointByToken } from "@/lib/checkinPoint";
import { needsVerify } from "@/lib/workerVerify";
import { rememberedWorkerId } from "@/actions/checkin";
import CheckinClient from "./CheckinClient";

// QR은 항상 최신 상태를 보여줘야 한다.
export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const loaded = await loadPointByToken(token);
  if (!loaded || !loaded.point.active || loaded.sites.length === 0) notFound();

  const { point, sites, siteIds } = loaded;
  const multiSite = sites.length > 1;

  const [workers, remembered] = await Promise.all([
    prisma.worker.findMany({
      where: { siteId: { in: siteIds }, active: true },
      select: {
        id: true,
        name: true,
        empNo: true,
        birthMmdd: true,
        verifiedAt: true,
        siteId: true,
        team: { select: { name: true } },
      },
      // 사번순. 사번이 없는 사람은 뒤로.
      orderBy: [
        { site: { code: "asc" } },
        { empNo: { sort: "asc", nulls: "last" } },
        { name: "asc" },
      ],
    }),
    rememberedWorkerId(),
  ]);

  const siteNameById = new Map(sites.map((s) => [s.id, s.name]));
  const now = new Date();

  const rememberedWorker = workers.find((w) => w.id === remembered) ?? null;

  // 공용 QR은 법인마다 체크인 시간이 다를 수 있다. 기억된 사람이 있으면 그 사람
  // 사업장으로 판정하고, 없으면 한 곳이라도 열려 있는 쪽을 기준으로 삼아 명단을
  // 보여 준다. 실제 판정은 사람을 고른 뒤 checkinAction이 본인 사업장으로 다시 한다.
  const states = sites.map((s) => ({ site: s, state: checkinWindowState(s, now) }));
  const ref =
    (rememberedWorker && states.find((x) => x.site.id === rememberedWorker.siteId)) ??
    states.find((x) => x.state.open) ??
    states[0];
  const refSite = ref.site;
  const window = ref.state;

  let alreadyToday = false;
  if (rememberedWorker) {
    alreadyToday =
      (await prisma.tbmAttendance.count({
        where: {
          workerId: rememberedWorker.id,
          tbm: { workDate: kstDateOnly(now) },
        },
      })) > 0;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-5">
        <p className="text-sm font-semibold text-slate-500">
          {multiSite ? `${sites.length}개 사업장 공용` : sites[0].name}
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-slate-900">TBM 출석 체크</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dateLabel(kstDateOnly(now))} · {point.name}
        </p>
      </header>

      {!window.open ? (
        <div className="card border-l-4 border-l-amber-400">
          <p className="font-semibold text-slate-900">지금은 체크인 시간이 아닙니다</p>
          <p className="mt-1 text-sm text-slate-600">{window.reason}</p>
          <p className="mt-3 text-xs text-slate-500">
            체크인 가능 시간 {minuteLabel(refSite.checkinFrom)} ~{" "}
            {minuteLabel(refSite.checkinUntil)}
          </p>
        </div>
      ) : (
        <CheckinClient
          token={token}
          multiSite={multiSite}
          workers={workers.map((w) => ({
            id: w.id,
            name: w.name,
            empNo: w.empNo,
            siteName: siteNameById.get(w.siteId) ?? "",
            teamName: w.team?.name ?? null,
            needsVerify: needsVerify(w, now),
          }))}
          remembered={
            rememberedWorker
              ? { id: rememberedWorker.id, name: rememberedWorker.name }
              : null
          }
          alreadyToday={alreadyToday}
          lateAfter={minuteLabel(refSite.lateAfterMinute)}
          isLateNow={window.late}
        />
      )}

      <p className="mt-auto pt-8 text-center text-xs text-slate-400">
        출석 기록은 오늘의 TBM 실시 기록에 자동으로 반영됩니다.
      </p>
    </main>
  );
}
