import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { dateLabel } from "@/lib/kst";
import { PHASE_LABEL, scanStep, sessionPhase } from "@/lib/legalEdu";
import { needsVerify } from "@/lib/workerVerify";
import { rememberedWorkerId } from "@/actions/checkin";
import ScanClient from "./ScanClient";

// QR은 항상 최신 상태를 보여줘야 한다.
export const dynamic = "force-dynamic";

/**
 * 법정의무교육 QR 스캔 화면.
 *
 * TBM 출석(/c/[token])과 따로 둔다. 그쪽은 고정 QR이 지문인식기 옆에 붙어
 * 있고 출석이 곧 교육이지만, 이쪽은 회차마다 다른 QR이 서명부에 인쇄되어
 * 교육장으로 들어온다. 섞이면 어느 기록이 무엇인지 알 수 없게 된다.
 */
export default async function LegalEduScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await prisma.legalEduSession.findUnique({
    where: { token },
    select: {
      id: true,
      siteId: true,
      title: true,
      eduDate: true,
      place: true,
      openedAt: true,
      closedAt: true,
      site: { select: { name: true } },
    },
  });
  if (!session) notFound();

  const phase = sessionPhase(session);

  const [workers, remembered] = await Promise.all([
    prisma.worker.findMany({
      where: { siteId: session.siteId, active: true },
      select: { id: true, name: true, empNo: true, birthMmdd: true, verifiedAt: true },
      // 사번순. 사번이 없는 사람은 뒤로. TBM 체크인과 같은 차례다.
      orderBy: [{ empNo: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    }),
    rememberedWorkerId(),
  ]);

  const scans = await prisma.legalEduScan.findMany({
    where: { sessionId: session.id },
    select: { workerId: true, startedAt: true, endedAt: true },
  });
  const scanByWorker = new Map(scans.map((s) => [s.workerId, s]));
  const now = new Date();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-5">
        <p className="text-sm font-semibold text-slate-500">{session.site.name}</p>
        <h1 className="mt-0.5 text-xl font-bold text-slate-900">{session.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dateLabel(session.eduDate)}
          {session.place && ` · ${session.place}`}
        </p>
        <p
          className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            phase === "OPEN"
              ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
              : phase === "BEFORE"
                ? "bg-slate-100 text-slate-600 ring-slate-300"
                : "bg-slate-200 text-slate-700 ring-slate-400"
          }`}
        >
          {PHASE_LABEL[phase]}
        </p>
      </header>

      {phase === "BEFORE" && (
        <p className="card text-sm text-slate-600">
          아직 교육이 시작되지 않았습니다. 시작하면 찍을 수 있습니다.
        </p>
      )}
      {phase === "CLOSED" && (
        <p className="card text-sm text-slate-600">
          이 교육은 마감되었습니다. 못 찍으셨으면 관리자에게 알려 주세요.
        </p>
      )}
      {phase === "OPEN" && (
        <ScanClient
          token={token}
          workers={workers.map((w) => ({
            id: w.id,
            name: w.name,
            empNo: w.empNo,
            needsVerify: needsVerify(w, now),
            step: scanStep(scanByWorker.get(w.id) ?? null),
          }))}
          rememberedId={remembered}
        />
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        교육을 시작할 때와 끝날 때 각각 한 번 찍어 주세요.
      </p>
    </main>
  );
}
