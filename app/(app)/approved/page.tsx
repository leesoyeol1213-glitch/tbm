import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, siteScope } from "@/lib/authz";
import {
  PERIOD_KEYS,
  PERIOD_LABEL,
  dateLabel,
  dateTimeLabel,
  isPeriodKey,
  resolvePeriod,
} from "@/lib/kst";
import { canViewPatrols } from "@/lib/patrolRules";
import ApprovedBox, { type ApprovedDoc } from "@/components/ApprovedBox";

export const dynamic = "force-dynamic";

export default async function ApprovedPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireRole(
    "CEO",
    "SITE_MANAGER",
    "SAFETY_DIRECTOR",
    "DIVISION_HEAD",
    "HQ_ADMIN",
  );

  const { period: requested } = await searchParams;
  const period = resolvePeriod(
    requested && isPeriodKey(requested) ? requested : "this-month",
  );

  const showPatrols = canViewPatrols(user);

  const [tbms, patrols] = await Promise.all([
    prisma.tbm.findMany({
      where: {
        ...siteScope(user),
        status: "APPROVED",
        ...(period.from && period.to
          ? { workDate: { gte: period.from, lte: period.to } }
          : {}),
      },
      include: {
        team: { select: { name: true } },
        site: { select: { name: true } },
      },
      orderBy: [{ workDate: "desc" }, { site: { code: "asc" } }],
      take: 200,
    }),
    showPatrols
      ? prisma.patrol.findMany({
          where: {
            status: "APPROVED",
            ...(period.from && period.to
              ? { patrolDate: { gte: period.from, lte: period.to } }
              : {}),
          },
          include: { plant: { select: { name: true } } },
          orderBy: [{ patrolDate: "desc" }, { plant: { sort: "asc" } }],
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  const tbmDocs: ApprovedDoc[] = tbms.map((t) => ({
    id: t.id,
    kind: "tbm",
    title: `${t.site.name} ${t.team.name}`,
    dateLabel: dateLabel(t.workDate),
    approvedLabel: t.approvedAt ? dateTimeLabel(t.approvedAt) : "—",
    paperLabel: t.paperSignedAt ? dateTimeLabel(t.paperSignedAt) : null,
  }));

  const patrolDocs: ApprovedDoc[] = patrols.map((p) => ({
    id: p.id,
    kind: "patrol",
    title: p.plant.name,
    dateLabel: dateLabel(p.patrolDate),
    approvedLabel: p.approvedAt ? dateTimeLabel(p.approvedAt) : "—",
    paperLabel: p.paperSignedAt ? dateTimeLabel(p.paperSignedAt) : null,
  }));

  const total = tbmDocs.length + patrolDocs.length;
  const waiting = [...tbmDocs, ...patrolDocs].filter((d) => !d.paperLabel).length;
  const isHq = user.role === "HQ_ADMIN";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold text-slate-900">결재완료함</h1>
        <p className="text-sm text-slate-500">
          {period.label} · {total}건
        </p>
      </div>

      <p className="text-xs text-slate-500">
        전자결재가 끝난 문서입니다. 골라서 한 개 PDF로 받아 출력하고, 최종결재자 서명을 받은 뒤 본사가 수기결재
        완료를 표시합니다.
      </p>

      <nav className="flex flex-wrap gap-1.5">
        {PERIOD_KEYS.map((k) => (
          <Link
            key={k}
            href={`/approved?period=${k}`}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
              k === period.key
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {PERIOD_LABEL[k]}
          </Link>
        ))}
      </nav>

      {waiting > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
          수기결재를 아직 받지 않은 문서가 <strong>{waiting}건</strong> 있습니다.
        </p>
      )}

      {total === 0 ? (
        <p className="card text-sm text-slate-500">
          {period.label}에 결재가 완료된 문서가 없습니다.
        </p>
      ) : (
        <>
          {/*
            양식도 다르고 묶어서 인쇄할 일도 없어서 종류별로 따로 둔다.
            선택과 내려받기도 구역마다 따로 돈다.
          */}
          {tbmDocs.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="font-bold text-slate-900">
                TBM 실시 기록 {tbmDocs.length}건
              </h2>
              <ApprovedBox docs={tbmDocs} canMarkPaper={isHq} />
            </section>
          )}

          {patrolDocs.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="pt-2 font-bold text-slate-900">
                안전(순찰)일지 {patrolDocs.length}건
              </h2>
              <ApprovedBox docs={patrolDocs} canMarkPaper={isHq} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
