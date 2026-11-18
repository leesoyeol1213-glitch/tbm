import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, siteScope } from "@/lib/authz";
import { dateLabel, isPeriodKey, PERIOD_KEYS, PERIOD_LABEL, resolvePeriod } from "@/lib/kst";
import {
  KIND_LABEL,
  THEME_LABEL,
  classifyNote,
  splitNote,
  tallyKinds,
  themeTrends,
  themesOf,
  type HazardEntry,
  type NoteKind,
  type ThemeKey,
} from "@/lib/hazardLog";

export const dynamic = "force-dynamic";

/**
 * 위험요인 모음.
 *
 * 새로 적게 하는 화면이 아니다. 이미 적힌 것을 모아 보는 화면이다 — TBM
 * 특이사항과 순찰 점검 불량에 쌓인 것을 한 줄씩 꺼내 종류와 주제로 나눈다.
 *
 * 만든 이유는 하나다. 같은 것이 반복해 올라오는데 그 사실이 아무 데서도
 * 보이지 않았다. 벨트슬링 파단품이 9월 3일 15개, 10월 2일 60개, 10월 16일
 * 2개로 세 번 올라왔지만 세 번 다 다른 문서에 있어, 읽는 사람은 매번 처음
 * 보는 일로 받았다. 되풀이되는 것은 그날의 일이 아니라 고쳐지지 않은 것이고,
 * 위험성평가에 올려야 하는 것은 그쪽이다.
 *
 * 사고를 맨 위에 따로 둔다. 산안법 제57조는 산업재해를 기록해 3년 보존하게
 * 하고 휴업 3일 이상이면 재해조사표를 내게 하는데, 실제 부상 기록이 일일
 * TBM 본문에 한 줄로 섞여 있으면 세어지지도 찾아지지도 않는다.
 */
const KIND_STYLE: Record<NoteKind, string> = {
  ACCIDENT: "bg-rose-100 text-rose-900 ring-rose-300",
  NEAR_MISS: "bg-amber-100 text-amber-900 ring-amber-300",
  HAZARD: "bg-slate-100 text-slate-700 ring-slate-300",
  SHARED: "bg-sky-50 text-sky-800 ring-sky-200",
  ADMIN: "bg-slate-50 text-slate-500 ring-slate-200",
};

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "alarm" | "warn";
}) {
  const ring =
    tone === "alarm"
      ? "ring-rose-300 bg-rose-50"
      : tone === "warn"
        ? "ring-amber-300 bg-amber-50"
        : "ring-slate-200 bg-white";
  return (
    <div className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${ring}`}>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

export default async function HazardsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; theme?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  // 분기를 기본으로 둔다. 되풀이를 보려면 한 달은 짧고, 전체는 옛일이 섞인다.
  const period = resolvePeriod(
    sp.period && isPeriodKey(sp.period) ? sp.period : "this-quarter",
  );
  const pickedTheme = (sp.theme ?? "") as ThemeKey | "";
  const pickedKind = (sp.kind ?? "") as NoteKind | "";

  const dateWhere =
    period.from && period.to ? { gte: period.from, lte: period.to } : undefined;

  // 순찰은 공장 단위라 법인 범위로 자를 수 없다. 팀장은 순찰을 쓰지도 결재하지도
  // 않으므로 순찰 지적은 보여 주지 않는다.
  const seesPatrol = user.role !== "TEAM_LEAD";

  const [tbms, patrolChecks, patrolRounds] = await Promise.all([
    prisma.tbm.findMany({
      where: {
        ...siteScope(user),
        remarks: { not: null },
        ...(dateWhere ? { workDate: dateWhere } : {}),
      },
      select: {
        id: true,
        workDate: true,
        remarks: true,
        site: { select: { name: true } },
        team: { select: { name: true } },
      },
      orderBy: { workDate: "desc" },
    }),
    seesPatrol
      ? prisma.patrolCheck.findMany({
          where: {
            state: { not: "GOOD" },
            ...(dateWhere ? { patrol: { patrolDate: dateWhere } } : {}),
          },
          select: {
            content: true,
            action: true,
            patrol: {
              select: {
                id: true,
                patrolDate: true,
                plant: { select: { name: true } },
              },
            },
          },
        })
      : [],
    seesPatrol
      ? prisma.patrolRound.findMany({
          where: {
            state: { not: "GOOD" },
            ...(dateWhere ? { patrol: { patrolDate: dateWhere } } : {}),
          },
          select: {
            place: true,
            content: true,
            note: true,
            patrol: {
              select: {
                id: true,
                patrolDate: true,
                plant: { select: { name: true } },
              },
            },
          },
        })
      : [],
  ]);

  const entries: HazardEntry[] = [];

  // 특이사항은 한 칸에 여러 건이 들어온다. 줄 단위로 쪼개야 사고 보고가
  // 인원 사정에 묻히지 않는다.
  for (const t of tbms) {
    for (const text of splitNote(t.remarks)) {
      entries.push({
        source: "TBM",
        docId: t.id,
        date: t.workDate,
        where: t.site.name,
        detail: t.team.name,
        text,
        kind: classifyNote(text),
        themes: themesOf(text),
      });
    }
  }

  // 순찰 점검은 조치사항이 본문이다. 점검 항목("크레인 사용 안전작업 시행여부")
  // 은 양식에서 온 말이라 그것만으로는 무엇이 있었는지 알 수 없다.
  for (const c of patrolChecks) {
    const text = c.action?.trim() || c.content.trim();
    entries.push({
      source: "PATROL",
      docId: c.patrol.id,
      date: c.patrol.patrolDate,
      where: c.patrol.plant.name,
      detail: c.content,
      text,
      kind: classifyNote(text),
      themes: themesOf(`${c.content} ${text}`),
    });
  }
  for (const r of patrolRounds) {
    const text = r.note?.trim() || r.content.trim();
    entries.push({
      source: "PATROL",
      docId: r.patrol.id,
      date: r.patrol.patrolDate,
      where: r.patrol.plant.name,
      detail: r.place,
      text,
      kind: classifyNote(text),
      themes: themesOf(`${r.place} ${r.content} ${text}`),
    });
  }

  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  // 인원·운영은 셈에서 뺀다. 위험요인이 아니라 사람 사정이고, 특이사항의
  // 절반 가까이를 차지해 섞으면 다른 숫자가 다 가려진다.
  const real = entries.filter((e) => e.kind !== "ADMIN");
  const kinds = tallyKinds(entries);
  const themes = themeTrends(real);

  const accidents = real.filter((e) => e.kind === "ACCIDENT");
  // 사고 하나가 일시·내용·조치로 여러 줄에 걸쳐 적힌다. 줄 수가 아니라
  // 문서 수를 세야 "몇 건 났는지"가 된다.
  const accidentDocs = [...new Set(accidents.map((e) => e.docId))];

  const shown = real.filter(
    (e) =>
      (!pickedTheme || e.themes.includes(pickedTheme)) &&
      (!pickedKind || e.kind === pickedKind),
  );

  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({
      period: period.key,
      ...(pickedTheme ? { theme: pickedTheme } : {}),
      ...(pickedKind ? { kind: pickedKind } : {}),
      ...patch,
    });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    return `/hazards?${q}`;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-bold text-slate-900">위험요인 모음</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          TBM 특이사항과 순찰 지적에 이미 적힌 것을 모았습니다. 새로 적을 것은
          없습니다.
        </p>
      </header>

      {/* --- 기간 --- */}
      <nav className="flex flex-wrap gap-1.5">
        {PERIOD_KEYS.map((k) => (
          <Link
            key={k}
            href={href({ period: k })}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ${
              period.key === k
                ? "bg-slate-800 text-white ring-slate-800"
                : "bg-white text-slate-700 ring-slate-300"
            }`}
          >
            {PERIOD_LABEL[k]}
          </Link>
        ))}
        <span className="self-center pl-1 text-xs text-slate-500">{period.label}</span>
      </nav>

      {/* --- 타일 --- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="사고 발생"
          value={accidentDocs.length}
          tone={accidentDocs.length > 0 ? "alarm" : undefined}
        />
        <Tile
          label="아차사고"
          value={kinds.NEAR_MISS}
          tone={kinds.NEAR_MISS > 0 ? "warn" : undefined}
        />
        <Tile label="위험요인" value={kinds.HAZARD} />
        <Tile label="순찰 지적" value={real.filter((e) => e.source === "PATROL").length} />
      </div>

      {/* --- 사고 --- */}
      {accidents.length > 0 && (
        <section className="card border-l-4 border-l-rose-500">
          <h2 className="font-bold text-slate-900">
            사고 발생 {accidentDocs.length}건
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            산업안전보건법 제57조는 산업재해를 기록해 3년간 보존하게 하고, 휴업
            3일 이상이면 재해조사표를 제출하게 합니다. 아래는 일일 기록 본문에서
            찾아낸 것이니, 따로 보존하고 있는지 확인해 주십시오.
          </p>
          <ul className="mt-3 space-y-3">
            {accidentDocs.map((docId) => {
              const group = accidents.filter((e) => e.docId === docId);
              const head = group[0];
              return (
                <li key={docId} className="rounded-lg bg-rose-50/60 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">
                      {dateLabel(head.date)} · {head.where}
                      {head.detail && (
                        <span className="ml-1.5 font-normal text-slate-600">
                          {head.detail}
                        </span>
                      )}
                    </p>
                    <Link
                      href={
                        head.source === "TBM" ? `/tbm/${docId}` : `/patrol/${docId}`
                      }
                      className="text-xs font-semibold text-slate-700 underline underline-offset-2"
                    >
                      원본 보기
                    </Link>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {group.map((e, i) => (
                      <li key={i} className="text-sm text-slate-800">
                        {e.text}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* --- 되풀이 주제 --- */}
      <section className="card">
        <h2 className="font-bold text-slate-900">주제별 집계</h2>
        <p className="mt-1 text-xs text-slate-600">
          달별 건수를 그대로 적습니다. 조치한 뒤에 줄었으면 위험성평가가 돌아간
          것이고, 내내 같은 수면 안 돌아간 것입니다. &ldquo;되풀이&rdquo;를 따로
          표시하지 않는 이유는 간단합니다 — 아래 주제가 거의 전부 매달 올라오고
          있어, 표시해도 가려지는 것이 없습니다.
        </p>
        {themes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">이 기간에 모인 것이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {themes.map((t) => {
              const max = themes[0].count;
              return (
                <li key={t.key}>
                  <Link
                    href={href({ theme: pickedTheme === t.key ? "" : t.key })}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={`w-24 shrink-0 text-sm ${
                        pickedTheme === t.key
                          ? "font-bold text-slate-900"
                          : "text-slate-700"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="h-3.5 flex-1 overflow-hidden rounded-sm bg-slate-100">
                      <span
                        className="block h-full bg-slate-600"
                        style={{ width: `${Math.round((t.count / max) * 100)}%` }}
                      />
                    </span>
                    {/*
                      달별 건수. 마지막 달이 첫 달보다 줄지 않았으면 숫자를
                      진하게 둔다 — 색이나 화살표로 "좋다/나쁘다"를 단정하지
                      않는다. 11월은 아직 안 끝났을 수 있다.
                    */}
                    <span className="hidden shrink-0 gap-1 text-xs text-slate-500 sm:flex">
                      {t.months.map((m) => (
                        <span key={m.label} className="w-10 text-right tabular-nums">
                          {m.label} {m.count}
                        </span>
                      ))}
                    </span>
                    <span
                      className={`w-8 shrink-0 text-right text-sm tabular-nums ${
                        t.rising ? "font-bold text-slate-900" : "text-slate-600"
                      }`}
                    >
                      {t.count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          마지막 달이 첫 달보다 줄지 않은 주제는 합계를 진하게 적었습니다. 달이
          덜 지난 기간에는 그 숫자가 작게 나올 수 있으니 기간을 바꿔 보십시오.
        </p>
      </section>

      {/* --- 목록 --- */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 className="font-bold text-slate-900">
            기록 {shown.length}건
            {(pickedTheme || pickedKind) && (
              <Link
                href={href({ theme: "", kind: "" })}
                className="ml-2 text-xs font-normal text-slate-600 underline underline-offset-2"
              >
                필터 해제
              </Link>
            )}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {(["ACCIDENT", "NEAR_MISS", "HAZARD", "SHARED"] as NoteKind[]).map((k) => (
              <Link
                key={k}
                href={href({ kind: pickedKind === k ? "" : k })}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                  pickedKind === k
                    ? "bg-slate-800 text-white ring-slate-800"
                    : KIND_STYLE[k]
                }`}
              >
                {KIND_LABEL[k]} {kinds[k]}
              </Link>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="card text-sm text-slate-500">
            조건에 맞는 기록이 없습니다.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((e, i) => (
              <li key={`${e.docId}-${i}`} className="card py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${KIND_STYLE[e.kind]}`}
                  >
                    {KIND_LABEL[e.kind]}
                  </span>
                  <span className="text-xs text-slate-500">
                    {dateLabel(e.date)} · {e.where}
                    {e.detail && ` · ${e.detail}`}
                  </span>
                  <span className="text-xs text-slate-400">
                    {e.source === "TBM" ? "TBM" : "순찰"}
                  </span>
                  <Link
                    href={e.source === "TBM" ? `/tbm/${e.docId}` : `/patrol/${e.docId}`}
                    className="ml-auto text-xs text-slate-600 underline underline-offset-2"
                  >
                    원본
                  </Link>
                </div>
                <p className="mt-1 text-sm text-slate-800">{e.text}</p>
                {e.themes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.themes.map((t) => (
                      <Link
                        key={t}
                        href={href({ theme: pickedTheme === t ? "" : t })}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                      >
                        {THEME_LABEL[t]}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        인원·연락 기록 {kinds.ADMIN}건은 위험요인이 아니라 셈에서 뺐습니다. TBM의
        위험요인 칸은 매일 양식에서 복사되어 손으로 고친 것이 없으므로 여기 모으지
        않습니다 — 모으려면 그 칸을 그날 실제로 고쳐 적어야 합니다.
      </p>
    </div>
  );
}
