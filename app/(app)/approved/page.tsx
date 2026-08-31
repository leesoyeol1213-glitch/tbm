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
import {
  APPROVED_CAP,
  PAPER_STATES,
  PAPER_STATE_LABEL,
  type PaperState,
  countFor,
  isPaperState,
  paperFilter,
} from "@/lib/approved";
import ApprovedBox, { type ApprovedDoc } from "@/components/ApprovedBox";

export const dynamic = "force-dynamic";

export default async function ApprovedPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; state?: string }>;
}) {
  const user = await requireRole(
    "CEO",
    "SITE_MANAGER",
    "SAFETY_DIRECTOR",
    "DIVISION_HEAD",
    "HQ_ADMIN",
  );

  const { period: requested, state: requestedState } = await searchParams;
  const period = resolvePeriod(
    requested && isPeriodKey(requested) ? requested : "this-month",
  );
  // 남은 일을 기본으로 보여준다. 끝난 건은 "보관 완료" 칸으로 치운다.
  const paper: PaperState =
    requestedState && isPaperState(requestedState) ? requestedState : "waiting";

  const showPatrols = canViewPatrols(user);

  const tbmWhere = {
    ...siteScope(user),
    status: "APPROVED" as const,
    ...(period.from && period.to
      ? { workDate: { gte: period.from, lte: period.to } }
      : {}),
  };
  const patrolWhere = {
    status: "APPROVED" as const,
    ...(period.from && period.to
      ? { patrolDate: { gte: period.from, lte: period.to } }
      : {}),
  };

  // 건수는 목록과 따로 센다. 목록은 상한에서 잘리지만 "몇 건인지"와 "수기결재가
  // 몇 건 남았는지"는 잘린 것까지 포함한 진짜 숫자여야 한다.
  const [tbms, tbmTotal, tbmWaiting, patrols, patrolTotal, patrolWaiting] =
    await Promise.all([
      prisma.tbm.findMany({
        where: { ...tbmWhere, ...paperFilter(paper) },
        include: {
          team: { select: { name: true } },
          site: { select: { name: true } },
          // 묶음 크기를 사진 장수로 가늠한다. 사진이 든 문서는 세 배까지 커진다.
          // 문서에 실리는 것만 센다 — 참고용으로 붙어 있는 사진은 PDF에 없다.
          _count: { select: { photos: { where: { included: true } } } },
        },
        orderBy: [{ workDate: "desc" }, { site: { code: "asc" } }],
        take: APPROVED_CAP,
      }),
      prisma.tbm.count({ where: tbmWhere }),
      prisma.tbm.count({ where: { ...tbmWhere, paperSignedAt: null } }),
      showPatrols
        ? prisma.patrol.findMany({
            where: { ...patrolWhere, ...paperFilter(paper) },
            include: { plant: { select: { name: true } } },
            orderBy: [{ patrolDate: "desc" }, { plant: { sort: "asc" } }],
            take: APPROVED_CAP,
          })
        : Promise.resolve([]),
      showPatrols ? prisma.patrol.count({ where: patrolWhere }) : Promise.resolve(0),
      showPatrols
        ? prisma.patrol.count({ where: { ...patrolWhere, paperSignedAt: null } })
        : Promise.resolve(0),
    ]);

  const tbmDocs: ApprovedDoc[] = tbms.map((t) => ({
    id: t.id,
    kind: "tbm",
    title: `${t.site.name} ${t.team.name}`,
    dateLabel: dateLabel(t.workDate),
    approvedLabel: t.approvedAt ? dateTimeLabel(t.approvedAt) : "—",
    paperLabel: t.paperSignedAt ? dateTimeLabel(t.paperSignedAt) : null,
    photoCount: t._count.photos,
  }));

  const patrolDocs: ApprovedDoc[] = patrols.map((p) => ({
    id: p.id,
    kind: "patrol",
    title: p.plant.name,
    dateLabel: dateLabel(p.patrolDate),
    approvedLabel: p.approvedAt ? dateTimeLabel(p.approvedAt) : "—",
    paperLabel: p.paperSignedAt ? dateTimeLabel(p.paperSignedAt) : null,
    photoCount: 0,
  }));

  const tbmCount = countFor(paper, tbmTotal, tbmWaiting);
  const patrolCount = countFor(paper, patrolTotal, patrolWaiting);
  const shown = tbmCount + patrolCount;
  const hidden = shown - (tbmDocs.length + patrolDocs.length);
  const isHq = user.role === "HQ_ADMIN";

  const stateCount = (s: PaperState) =>
    countFor(s, tbmTotal, tbmWaiting) + countFor(s, patrolTotal, patrolWaiting);
  const href = (next: Partial<{ period: string; state: PaperState }>) =>
    `/approved?period=${next.period ?? period.key}&state=${next.state ?? paper}`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold text-slate-900">결재완료함</h1>
        <p className="text-sm text-slate-500">
          {period.label} · {shown}건
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
            href={href({ period: k })}
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

      {/*
        끝난 것과 안 끝난 것을 갈라 둔다. 한 목록에 섞여 있으면 월말에 남은
        일을 세려고 수백 장을 눈으로 훑게 된다.
      */}
      <nav className="flex flex-wrap gap-1.5">
        {PAPER_STATES.map((s) => (
          <Link
            key={s}
            href={href({ state: s })}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
              s === paper
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {PAPER_STATE_LABEL[s]} {stateCount(s)}
          </Link>
        ))}
      </nav>

      {/*
        상한에 걸려 잘린 것을 숨기지 않는다. 잘린 줄 모르고 "전체 선택"을 누르면
        받지 못한 문서가 생기는데, 화면에는 다 받은 것처럼 보인다.
      */}
      {hidden > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
          {shown}건 가운데 최근 {APPROVED_CAP}건까지만 화면에 있습니다. 나머지{" "}
          <strong>{hidden}건</strong>을 보려면 기간을 좁혀 주세요.
        </p>
      )}

      {shown === 0 ? (
        <p className="card text-sm text-slate-500">
          {paper === "waiting" && stateCount("all") > 0
            ? `${period.label} 문서는 모두 수기결재까지 끝났습니다.`
            : paper === "done"
              ? `${period.label}에 수기결재로 표시된 문서가 없습니다.`
              : `${period.label}에 결재가 완료된 문서가 없습니다.`}
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
                TBM 실시 기록 {tbmCount}건
              </h2>
              <ApprovedBox docs={tbmDocs} canMarkPaper={isHq} />
            </section>
          )}

          {patrolDocs.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="pt-2 font-bold text-slate-900">
                안전(순찰)일지 {patrolCount}건
              </h2>
              <ApprovedBox docs={patrolDocs} canMarkPaper={isHq} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
