import Link from "next/link";
import { prisma } from "@/lib/db";
import { isApprover, requireRole, siteScope } from "@/lib/authz";
import {
  PERIOD_KEYS,
  PERIOD_LABEL,
  dateLabel,
  dateTimeLabel,
  isPeriodKey,
  resolvePeriod,
} from "@/lib/kst";
import { describeFlags, hasAnyFlag } from "@/lib/tbm";
import BatchApprove, { type PendingItem } from "@/components/tbm/BatchApprove";
import PatrolBatchApprove, {
  type PendingPatrol,
} from "@/components/patrol/PatrolBatchApprove";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  // 승인은 법인 대표가 하고, 본사는 대표를 대신해 결재할 수 있다(대결).
  const user = await requireRole("CEO", "SITE_MANAGER", "HQ_ADMIN");

  const { period: requested } = await searchParams;
  // 대표가 월·분기 단위로 몰아서 결재하는 것이 기본 사용법이라 이번 달로 시작한다.
  const period = resolvePeriod(
    requested && isPeriodKey(requested) ? requested : "this-month",
  );

  const pending = await prisma.tbm.findMany({
    where: {
      ...siteScope(user),
      status: "SUBMITTED",
      ...(period.from && period.to
        ? { workDate: { gte: period.from, lte: period.to } }
        : {}),
    },
    include: {
      team: { select: { name: true } },
      site: { select: { name: true, dueMinute: true } },
      author: { select: { name: true } },
      _count: { select: { photos: true, attendances: true } },
    },
    orderBy: [{ workDate: "asc" }, { submittedAt: "asc" }],
  });

  // 순찰일지도 같은 결재선을 탄다. 대표가 한자리에서 둘 다 넘길 수 있어야 한다.
  const pendingPatrols = await prisma.patrol.findMany({
    where: {
      ...siteScope(user),
      status: "SUBMITTED",
      ...(period.from && period.to
        ? { patrolDate: { gte: period.from, lte: period.to } }
        : {}),
    },
    include: {
      site: { select: { name: true } },
      author: { select: { name: true } },
      checks: { select: { state: true } },
      _count: { select: { rounds: true } },
    },
    orderBy: [{ patrolDate: "asc" }, { submittedAt: "asc" }],
  });

  const patrolItems: PendingPatrol[] = pendingPatrols.map((p) => ({
    id: p.id,
    siteName: p.site.name,
    patrolDateLabel: dateLabel(p.patrolDate),
    submittedLabel: p.submittedAt ? dateTimeLabel(p.submittedAt) : "",
    patrollerName: p.patrollerName,
    authorName: p.author?.name ?? "작성자 미상",
    rounds: p._count.rounds,
    bad: p.checks.filter((c) => c.state === "BAD").length,
  }));

  // 기간 밖에 남아 있는 건이 있으면 알려 준다. 필터 때문에 놓치는 일을 막는다.
  const outside =
    period.from && period.to
      ? await prisma.tbm.count({
          where: {
            ...siteScope(user),
            status: "SUBMITTED",
            OR: [{ workDate: { lt: period.from } }, { workDate: { gt: period.to } }],
          },
        })
      : 0;

  const items: PendingItem[] = pending.map((tbm) => ({
    id: tbm.id,
    teamName: tbm.team.name,
    siteName: tbm.site.name,
    workDateLabel: dateLabel(tbm.workDate),
    submittedLabel: tbm.submittedAt ? dateTimeLabel(tbm.submittedAt) : "",
    authorName: tbm.author?.name ?? "작성자 미상",
    photos: tbm._count.photos,
    attendances: tbm._count.attendances,
    flagged: hasAnyFlag(tbm),
    flagLabels: describeFlags(tbm, tbm.site).map((f) => f.label),
  }));

  // 안전관리자는 진행 상황만 본다. 승인은 대표(또는 대결하는 본사)가 한다.
  const approver = isApprover(user);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold text-slate-900">결재함</h1>
        <p className="text-sm text-slate-500">
          {period.label} · 대기 {pending.length + patrolItems.length}건
        </p>
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {PERIOD_KEYS.map((key) => (
          <Link
            key={key}
            href={`/approvals?period=${key}`}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
              key === period.key
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {PERIOD_LABEL[key]}
          </Link>
        ))}
      </nav>

      {user.role === "SITE_MANAGER" && pending.length > 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200">
          승인은 법인 대표(또는 대결하는 본사)가 합니다. 여기서는 진행 상황만 보입니다.
        </p>
      )}

      {outside > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
          이 기간 밖에 결재 대기 {outside}건이 더 있습니다.{" "}
          <Link href="/approvals?period=all" className="underline">
            전체 보기
          </Link>
        </p>
      )}

      {pending.length === 0 && patrolItems.length === 0 ? (
        <p className="card text-sm text-slate-500">
          {period.label}에 결재할 건이 없습니다.
        </p>
      ) : (
        <>
          {/*
            TBM과 순찰일지는 결재선이 같지만 문서가 다르다. 일괄 승인은 문서별로
            따로 눌러야 무엇을 넘겼는지가 분명해진다.
          */}
          {pending.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="font-bold text-slate-900">TBM {pending.length}건</h2>
              <BatchApprove items={items} canApprove={approver} />
            </section>
          )}

          {patrolItems.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="pt-2 font-bold text-slate-900">
                안전(순찰)일지 {patrolItems.length}건
              </h2>
              <PatrolBatchApprove items={patrolItems} canApprove={approver} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
