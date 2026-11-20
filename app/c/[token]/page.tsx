import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { dateLabel, kstDateOnly, minuteLabel } from "@/lib/kst";
import { checkinWindowState } from "@/lib/tbm";
import { loadPointByToken } from "@/lib/checkinPoint";
import { needsVerify } from "@/lib/workerVerify";
import { rememberedWorkerId } from "@/actions/checkin";
import { emergencyBoard } from "@/lib/emergency";
import { loadDailyDigest } from "@/lib/dailyDigestData";
import { loadNoticesFor } from "@/lib/noticeData";
import EmergencyCard from "@/components/EmergencyCard";
import DigestCard from "@/components/DigestCard";
import NoticeBoard from "@/components/NoticeBoard";
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

  /*
    비상연락망.

    생산직 근로자는 계정이 없어 이 화면이 회사 시스템에서 여는 유일한 곳이다.
    아침마다 전사 예순 명 넘게 자기 휴대폰으로 연다 — 번호를 둘 자리로 여기만
    한 데가 없다. 지금 종이 연락망은 경비실 벽에만 붙어 있다.

    체크인 시간대 밖에서도 보이게 바깥에 둔다. 사고는 아침 여덟 시에만 나지
    않는데, 체크인 창이 닫혔다고 번호까지 사라지면 들고 다니는 뜻이 없다.

    기준은 QR이 붙어 있는 장소, 곧 관리 주체 사업장이다. 공용 QR에 여러 법인이
    묶여 있어도 같은 공장 안이라 연락망은 하나다.
  */
  const emergency = emergencyBoard(point.site);

  /*
    전일 공유.

    근로자가 자기 폰으로 여는 유일한 화면이라 여기에 올린다. 팀장이 아침에
    읽어 주는 것과 별개로, 본인이 한 번 더 눈으로 보는 자리다.

    공장(주소) 단위로 모은다 — 같은 공장 옆 법인에서 난 사고도 같은 건물
    일이다. 체크인 시간대 밖에서도 보이게 바깥에 둔다.
  */
  const digest = await loadDailyDigest(point.site, now);

  const rememberedWorker = workers.find((w) => w.id === remembered) ?? null;

  /*
    공지사항.

    본인이 식별되면 그 사람 법인 것만 본다. 아직이면 이 QR이 덮는 법인을 다
    넣는다 — 진천 게이트 QR 하나가 법인 넷의 명부를 받고 있어서, 체크인 전에는
    보는 사람이 어느 법인인지 알 수 없다. 옆 법인 공지가 섞여 보이는 쪽이 자기
    법인 공지를 못 보는 쪽보다 낫다.
  */
  const notices = await loadNoticesFor(
    rememberedWorker ? [rememberedWorker.siteId] : siteIds,
    rememberedWorker?.id ?? null,
    now,
  );

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

      {/* 연락망보다 먼저 둔다. 오늘 아침 읽어야 하는 것은 이쪽이다. */}
      {digest && (
        <div className="mt-6">
          <DigestCard digest={digest} />
        </div>
      )}

      {/* 요약본 아래, 연락망 위. 어제 난 일을 먼저 읽고 공지를 본다. */}
      {notices.length > 0 && (
        <div className="mt-6">
          <NoticeBoard
            notices={notices}
            canAck
            identified={rememberedWorker !== null}
          />
        </div>
      )}

      {emergency && (
        <div className="mt-6">
          <EmergencyCard board={emergency} />
        </div>
      )}

      <p className="mt-auto pt-8 text-center text-xs text-slate-400">
        출석 기록은 오늘의 TBM 실시 기록에 자동으로 반영됩니다.
      </p>
    </main>
  );
}
