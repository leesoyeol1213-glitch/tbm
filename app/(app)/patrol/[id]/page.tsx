import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  canAccessSite,
  canApprove,
  isDelegatedApproval,
  requireUser,
} from "@/lib/authz";
import { dateLabel, dateTimeLabel, timeLabel } from "@/lib/kst";
import {
  canEditPatrol,
  DEFAULT_PATROL_FROM,
  DEFAULT_PATROL_UNTIL,
  PATROL_STATE_LABEL,
  PATROL_STATE_STYLE,
} from "@/lib/patrol";
import { StatusBadge } from "@/components/badges";
import PatrolForm from "@/components/patrol/PatrolForm";
import {
  PatrolApprovePanel,
  PatrolSubmitPanel,
} from "@/components/patrol/PatrolApprovalPanel";

export const dynamic = "force-dynamic";

export default async function PatrolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const patrol = await prisma.patrol.findUnique({
    where: { id },
    include: {
      site: true,
      author: { select: { name: true } },
      approver: { select: { name: true } },
      onBehalfOf: { select: { name: true } },
      rounds: { orderBy: { sort: "asc" } },
      checks: { orderBy: { sort: "asc" } },
      logs: {
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });

  if (!patrol) notFound();
  if (!canAccessSite(user, patrol.siteId)) notFound();

  const editable = canEditPatrol(user, patrol);
  const approvable = canApprove(user, patrol);

  // 본사가 결재하면 그 법인 대표를 대신한 대결이 된다. 누구를 대신하는지 미리 보여 준다.
  const delegateFor =
    approvable && isDelegatedApproval(user)
      ? (
          await prisma.user.findFirst({
            where: { role: "CEO", siteId: patrol.siteId, active: true },
            select: { name: true },
            orderBy: { createdAt: "asc" },
          })
        )?.name ?? null
      : null;

  const badCount = patrol.checks.filter((c) => c.state === "BAD").length;

  return (
    <div className="space-y-5">
      {/* --- 헤더 --- */}
      <header className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">안전(순찰)일지</h1>
            <p className="mt-1 text-sm text-slate-500">
              {patrol.site.name} · {dateLabel(patrol.patrolDate)}
              {patrol.startedAt &&
                ` · ${timeLabel(patrol.startedAt)}${
                  patrol.endedAt ? `~${timeLabel(patrol.endedAt)}` : "~"
                }`}
            </p>
          </div>
          <StatusBadge status={patrol.status} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">순찰자</dt>
            <dd className="font-medium text-slate-900">
              {patrol.patrollerName || "미기재"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">작성</dt>
            <dd className="font-medium text-slate-900">
              {patrol.author?.name ?? "—"}
              {patrol.submittedAt && (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  상신 {dateTimeLabel(patrol.submittedAt)}
                </span>
              )}
            </dd>
          </div>
          {patrol.approvedAt && (
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">결재</dt>
              <dd className="font-medium text-slate-900">
                {patrol.onBehalfOf?.name ?? patrol.approver?.name ?? "—"}
                {patrol.onBehalfOf && (
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    (대결 {patrol.approver?.name})
                  </span>
                )}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  · {dateTimeLabel(patrol.approvedAt)}
                </span>
              </dd>
            </div>
          )}
        </dl>

        {patrol.correctedAt && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            승인 후 정정됨 · {dateTimeLabel(patrol.correctedAt)}
          </p>
        )}
        {patrol.status === "REJECTED" && patrol.rejectReason && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
            반려 사유: {patrol.rejectReason}
          </p>
        )}

        <div className="mt-3 border-t border-slate-100 pt-3">
          <a
            href={`/api/patrol/${patrol.id}/pdf`}
            className="text-sm font-semibold text-slate-700 hover:underline"
          >
            PDF 내려받기 →
          </a>
        </div>
      </header>

      {/* --- 본문 --- */}
      {editable ? (
        <PatrolForm
          patrolId={patrol.id}
          patrollerName={patrol.patrollerName || user.name}
          weather={patrol.weather ?? ""}
          startedAt={patrol.startedAt ? timeLabel(patrol.startedAt) : DEFAULT_PATROL_FROM}
          endedAt={patrol.endedAt ? timeLabel(patrol.endedAt) : DEFAULT_PATROL_UNTIL}
          remarks={patrol.remarks ?? ""}
          rounds={patrol.rounds.map((r) => ({
            place: r.place,
            content: r.content,
            state: r.state,
            note: r.note ?? "",
          }))}
          checks={patrol.checks.map((c) => ({
            id: c.id,
            content: c.content,
            state: c.state,
            action: c.action ?? "",
          }))}
        />
      ) : (
        <ReadOnlyBody patrol={patrol} badCount={badCount} />
      )}

      {/* --- 결재 --- */}
      {approvable ? (
        <PatrolApprovePanel patrolId={patrol.id} delegateFor={delegateFor} />
      ) : (
        editable &&
        patrol.status !== "APPROVED" && (
          <PatrolSubmitPanel
            patrolId={patrol.id}
            rejected={patrol.status === "REJECTED"}
          />
        )
      )}

      {/* --- 이력 --- */}
      {patrol.logs.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-bold text-slate-900">처리 이력</h2>
          <ul className="space-y-1 text-xs text-slate-600">
            {patrol.logs.map((l) => (
              <li key={l.id}>
                {dateTimeLabel(l.createdAt)} · {l.actor?.name ?? "시스템"} · {l.action}
                {l.detail && ` · ${l.detail}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/patrol" className="block text-center text-sm text-slate-500 hover:underline">
        ← 순찰일지 목록
      </Link>
    </div>
  );
}

type PatrolWithBody = {
  weather: string | null;
  remarks: string | null;
  rounds: { id: string; place: string; content: string; state: keyof typeof PATROL_STATE_LABEL; note: string | null }[];
  checks: { id: string; content: string; state: keyof typeof PATROL_STATE_LABEL; action: string | null }[];
};

function StateChip({ state }: { state: keyof typeof PATROL_STATE_LABEL }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${PATROL_STATE_STYLE[state]}`}
    >
      {PATROL_STATE_LABEL[state]}
    </span>
  );
}

function ReadOnlyBody({
  patrol,
  badCount,
}: {
  patrol: PatrolWithBody;
  badCount: number;
}) {
  return (
    <div className="space-y-5">
      <section className="card">
        <h2 className="mb-2 font-bold text-slate-900">1. 순찰사항</h2>
        {patrol.rounds.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          <ul className="space-y-2">
            {patrol.rounds.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <StateChip state={r.state} />
                <span className="min-w-0">
                  <strong className="text-slate-900">{r.place || "—"}</strong>
                  <span className="text-slate-700"> · {r.content || "—"}</span>
                  {r.note && (
                    <span className="block text-xs text-slate-500">비고: {r.note}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {patrol.weather && (
          <p className="mt-3 text-xs text-slate-500">날씨: {patrol.weather}</p>
        )}
      </section>

      <section className="card">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold text-slate-900">2. 안전점검사항</h2>
          {badCount > 0 && (
            <p className="text-sm font-semibold text-rose-700">불량 {badCount}건</p>
          )}
        </div>
        {patrol.checks.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          <ul className="space-y-2">
            {patrol.checks.map((c, i) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <StateChip state={c.state} />
                <span className="min-w-0">
                  <span className="text-slate-800">
                    {i + 1}. {c.content}
                  </span>
                  {c.action && (
                    <span className="block text-xs text-slate-600">
                      조치: {c.action}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="mb-2 font-bold text-slate-900">3. 기타건의 및 특이사항</h2>
        <p className="text-sm whitespace-pre-wrap text-slate-700">
          {patrol.remarks || "—"}
        </p>
      </section>
    </div>
  );
}
