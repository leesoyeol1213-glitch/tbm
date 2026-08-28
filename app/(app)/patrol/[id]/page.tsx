import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { dateLabel, dateTimeLabel, timeLabel } from "@/lib/kst";
import {
  canApprovePatrol,
  canEditPatrol,
  canViewPatrols,
  DEFAULT_PATROL_FROM,
  DEFAULT_PATROL_UNTIL,
  delegateTarget,
  isPatrolDelegated,
  managedPlantIds,
  PATROL_STATE_LABEL,
  PATROL_STATE_STYLE,
  pickPatrolTemplate,
} from "@/lib/patrol";
import PatrolForm from "@/components/patrol/PatrolForm";
import ReloadTemplateButton from "@/components/patrol/ReloadTemplateButton";
import { PatrolStatusBadge } from "@/components/patrol/PatrolStatusBadge";
import {
  PatrolDecisionPanel,
} from "@/components/patrol/PatrolApprovalPanel";

export const dynamic = "force-dynamic";

export default async function PatrolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canViewPatrols(user)) notFound();

  const patrol = await prisma.patrol.findUnique({
    where: { id },
    include: {
      plant: true,
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

  const editable = canEditPatrol(user, patrol, await managedPlantIds(user));
  const approvable = canApprovePatrol(user, patrol);

  // 본사가 누른 결재는 대결이다. 누구를 대신하는지 미리 보여 준다.
  let delegateFor: string | null = null;
  if (approvable && isPatrolDelegated(user)) {
    const targetId = await delegateTarget("SAFETY_DIRECTOR");
    delegateFor = targetId
      ? (await prisma.user.findUnique({ where: { id: targetId }, select: { name: true } }))
          ?.name ?? null
      : null;
  }

  const badCount = patrol.checks.filter((c) => c.state === "BAD").length;

  // 점검표는 일지를 열 때 한 번 복사된다. 그 뒤 점검표가 바뀌었을 수 있으므로
  // 상신 전이면 다시 불러올 길을 열어 둔다.
  const template =
    editable && (patrol.status === "DRAFT" || patrol.status === "REJECTED")
      ? await pickPatrolTemplate(patrol.plantId)
      : null;

  return (
    <div className="space-y-5">
      {/* --- 헤더 --- */}
      <header className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">안전(순찰)일지</h1>
            <p className="mt-1 text-sm text-slate-500">
              {patrol.plant.name} · {dateLabel(patrol.patrolDate)}
              {patrol.startedAt &&
                ` · ${timeLabel(patrol.startedAt)} ~ ${
                  patrol.endedAt ? timeLabel(patrol.endedAt) : ""
                }`}
            </p>
          </div>
          <PatrolStatusBadge status={patrol.status} />
        </div>

        <dl className="mt-4 grid gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">작성 (순찰자)</dt>
            <dd className="font-medium text-slate-900">
              {patrol.patrollerName || "미기재"}
              {patrol.submittedAt && (
                <span className="block text-xs font-normal text-slate-500">
                  상신 {dateTimeLabel(patrol.submittedAt)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">결재 (안전실장)</dt>
            <dd className="font-medium text-slate-900">
              {patrol.approvedAt
                ? (patrol.onBehalfOf?.name ?? patrol.approver?.name ?? "—")
                : "—"}
              {patrol.onBehalfOf && (
                <span className="block text-xs font-normal text-slate-500">
                  대결 {patrol.approver?.name}
                </span>
              )}
              {patrol.approvedAt && (
                <span className="block text-xs font-normal text-slate-500">
                  {dateTimeLabel(patrol.approvedAt)}
                </span>
              )}
            </dd>
          </div>
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

        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <a
            href={`/api/patrol/${patrol.id}/pdf`}
            className="block text-sm font-semibold text-slate-700 hover:underline"
          >
            PDF 내려받기 →
          </a>
          {template && (
            <ReloadTemplateButton
              patrolId={patrol.id}
              templateName={template.name}
            />
          )}
        </div>
      </header>

      {/* --- 본문 --- */}
      {editable ? (
        <PatrolForm
          patrolId={patrol.id}
          canSubmit={patrol.status === "DRAFT" || patrol.status === "REJECTED"}
          plantName={patrol.plant.name}
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
        <ReadOnlyBody patrol={patrol} badCount={badCount} plantName={patrol.plant.name} />
      )}

      {/*
        결재. 상신은 작성 폼의 버튼이 겸한다 — 따로 두었더니 저장을 안 누른 채
        상신해 적은 내용이 사라지는 일이 있었다.
      */}
      {approvable && (
        <PatrolDecisionPanel patrolId={patrol.id} delegateFor={delegateFor} />
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
  rounds: {
    id: string;
    place: string;
    content: string;
    state: keyof typeof PATROL_STATE_LABEL;
    note: string | null;
  }[];
  checks: {
    id: string;
    content: string;
    state: keyof typeof PATROL_STATE_LABEL;
    action: string | null;
  }[];
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
  plantName,
}: {
  patrol: PatrolWithBody;
  badCount: number;
  plantName: string;
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
          <p className="text-xs text-slate-500">
            점검상태 · {plantName}
            {badCount > 0 && (
              <span className="ml-2 font-semibold text-rose-700">불량 {badCount}건</span>
            )}
          </p>
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
                    <span className="block text-xs text-slate-600">조치: {c.action}</span>
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
