import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { dateLabel, dateTimeLabel, kstDateOnly, ymd } from "@/lib/kst";
import { BLANK_ROWS, EDU_PRESETS, countPages } from "@/lib/eduRoster";
import { ROWS_FIRST_PAGE, ROWS_LATER_PAGE } from "@/lib/eduRosterPdf";
import { minutesLabel, sessionPhase, tally } from "@/lib/legalEdu";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import SessionManager, { type SessionRow } from "@/components/legalEdu/SessionManager";

/** 공개 접속 주소. QR이 가리키는 곳과 같아야 한다. */
async function baseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const dynamic = "force-dynamic";

/**
 * 법정의무교육. 본사만 본다.
 *
 * TBM은 산업안전보건법 정기교육의 증빙이 된다(고용노동부가 2023-12부터 인정).
 * 그러나 성희롱 예방·장애인 인식개선처럼 다른 법에 걸린 교육은 따로 실시하고
 * 따로 기록해야 한다. 고용노동부는 자료를 배포·게시하거나 메일만 보내는 것을
 * 교육 실시로 보지 않으므로(상시 10인 이상), 결국 남아야 하는 것은 교육자료 ·
 * 참석자 서명 · 교육 사진 세 가지다. 그중 가운데를 받아 올 종이를 여기서 뽑는다.
 *
 * 사업장 안전관리자에게 열지 않는다. 연 1회 전사가 한 번에 치르는 일이고,
 * 법인마다 따로 움직이면 어느 법인이 빠졌는지 아무도 모르게 된다. 본사가 열 곳을
 * 한 화면에서 보고 돌리는 것이 이 일의 모양이다.
 *
 * 일부러 DB에 아무것도 쓰지 않는다. 교육 전에 뽑는 빈 서식이고, 실시 기록을
 * 시스템에 넣는 일은 그 자체로 결재선이 필요해 따로 다룰 일이다.
 */
export default async function LegalEduPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; kind?: string }>;
}) {
  await requireRole("HQ_ADMIN");
  const { site: requested, kind: requestedKind } = await searchParams;

  const preset = EDU_PRESETS.find((p) => p.kind === requestedKind) ?? EDU_PRESETS[0];

  const sites = await prisma.site.findMany({
    where: { active: true },
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { workers: { where: { active: true } } } },
    },
    orderBy: { code: "asc" },
  });

  if (sites.length === 0) {
    return <p className="card text-sm text-slate-500">사업장이 없습니다.</p>;
  }

  // 기본값은 코드가 가장 앞선 법인(F01 금문철강 진천)이다.
  const site = sites.find((s) => s.id === requested) ?? sites[0];

  const workers = await prisma.worker.findMany({
    where: { siteId: site.id, active: true },
    select: {
      id: true,
      empNo: true,
      name: true,
      team: { select: { name: true } },
    },
    // 서명을 받으러 돌 때 팀별로 모여 있는 쪽이 빠르다. 종이와 같은 차례다.
    orderBy: [{ team: { name: "asc" } }, { name: "asc" }],
  });

  const total = sites.reduce((a, s) => a + s._count.workers, 0);
  const totalPages = sites.reduce(
    (a, s) => a + countPages(s._count.workers, ROWS_FIRST_PAGE, ROWS_LATER_PAGE),
    0,
  );

  // 고른 법인·고른 교육의 QR 회차
  const [rawSessions, base] = await Promise.all([
    prisma.legalEduSession.findMany({
      where: { siteId: site.id, kind: preset.kind },
      select: {
        id: true,
        token: true,
        eduDate: true,
        place: true,
        instructor: true,
        openedAt: true,
        closedAt: true,
        scans: { select: { startedAt: true, endedAt: true } },
      },
      orderBy: { eduDate: "desc" },
    }),
    baseUrl(),
  ]);

  const sessionRows: SessionRow[] = rawSessions.map((s) => ({
    id: s.id,
    url: `${base}/e/${s.token}`,
    eduDateLabel: dateLabel(s.eduDate),
    openedLabel: s.openedAt ? dateTimeLabel(s.openedAt) : null,
    closedLabel: s.closedAt ? dateTimeLabel(s.closedAt) : null,
    phase: sessionPhase(s),
    place: s.place,
    instructor: s.instructor,
    tally: tally(workers.length, s.scans, preset.requiredMin),
    requiredLabel: preset.requiredMin ? minutesLabel(preset.requiredMin) : null,
  }));

  /** 회차에 찍힌 스캔이 하나라도 있으면 보관용 출력을 권할 수 있다. */
  const hasScans = sessionRows.some((s) => s.tally.started > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">법정의무교육</h1>
        <p className="text-sm text-slate-500">
          법인 {sites.length}곳 · 재직 {total}명
        </p>
      </div>

      <section className="card">
        <h2 className="font-bold text-slate-900">TBM으로는 안 되는 교육</h2>
        <p className="mt-2 text-sm text-slate-600">
          TBM은 <strong>산업안전보건법 정기교육</strong>의 증빙이 됩니다(고용노동부가
          2023년 12월부터 인정). 성희롱 예방·장애인 인식개선처럼 다른 법에 걸린
          교육은 따로 실시하고 따로 기록해야 합니다.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          자료를 배포·게시하거나 메일만 보내는 것은 교육 실시로{" "}
          <strong>인정되지 않습니다</strong>(상시 10인 이상). 남아야 하는 것은{" "}
          <strong>교육자료 · 참석자 서명 · 교육 사진</strong> 세 가지이고, 이 화면은
          그중 <strong>서명부</strong>를 인쇄합니다.
        </p>
      </section>

      {/*
        교육을 고르면 근거와 기본 교육내용이 바뀐다. 자바스크립트를 쓰지 않고
        주소로 고르게 해 두었다 — 한 해에 한 번 쓰는 화면이라 단순한 쪽이 낫다.
      */}
      <section className="card">
        <h2 className="mb-3 font-bold text-slate-900">교육 고르기</h2>
        <nav className="flex flex-wrap gap-2">
          {EDU_PRESETS.map((p) => {
            const on = p.kind === preset.kind;
            return (
              <a
                key={p.kind}
                href={`/legal-edu?site=${site.id}&kind=${p.kind}`}
                className={
                  on
                    ? "rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                    : "rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-200"
                }
              >
                {p.title}
                {!p.mandatory && " (권장)"}
              </a>
            );
          })}
        </nav>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div>
            <dt className="inline text-slate-500">근거 </dt>
            <dd className="inline text-slate-900">{preset.basis}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">참고 </dt>
            <dd className="inline text-slate-600">{preset.note}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">자료 </dt>
            <dd className="inline text-slate-600">{preset.source}</dd>
          </div>
        </dl>

        {!preset.mandatory && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            이 교육은 <strong>법정 의무가 아닙니다.</strong> 고용노동부 법령해석상
            취업규칙 기재 의무만 있고 교육은 연 1회 권장입니다. 안 했다고 과태료가
            붙지 않으니, 성희롱 예방교육에 붙여 함께 기록해 두면 충분합니다.
          </p>
        )}
      </section>

      {/* 열 곳을 한눈에. 어느 법인이 빠졌는지 보이지 않으면 연 1회 교육은 꼭 빠진다. */}
      <section className="card">
        <h2 className="font-bold text-slate-900">법인별 명부</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          {preset.title} 기준 · 전부 뽑으면 약 {totalPages}장
        </p>

        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          {sites.map((s) => {
            const on = s.id === site.id;
            const pages = countPages(
              s._count.workers,
              ROWS_FIRST_PAGE,
              ROWS_LATER_PAGE,
            );
            return (
              <li key={s.id}>
                <a
                  href={`/legal-edu?site=${s.id}&kind=${preset.kind}`}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 ${
                    on ? "bg-slate-50" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm ${
                        on ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                      }`}
                    >
                      {s.name}
                    </span>
                    <span className="text-xs text-slate-500">{s.code}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    <strong className="tabular-nums text-slate-900">
                      {s._count.workers}명
                    </strong>{" "}
                    · {pages}장
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 고른 법인의 명부 전체. 종이에 찍히는 차례와 내용이 그대로다. */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-bold text-slate-900">{site.name}</h2>
            <p className="text-xs text-slate-500">
              {site.code} · 재직 {workers.length}명 · 종이에 찍히는 차례 그대로입니다
            </p>
          </div>
          <SiteSwitcher
            sites={sites.map((s) => ({ id: s.id, name: s.name, code: s.code }))}
            currentId={site.id}
          />
        </div>

        {workers.length === 0 ? (
          <p className="text-sm text-slate-500">재직자가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* 종이와 같은 칸, 같은 차례, 같은 가운데 정렬로 둔다. */}
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-1.5 font-semibold">번호</th>
                  <th className="py-1.5 font-semibold">사번</th>
                  <th className="py-1.5 font-semibold">성명</th>
                  <th className="py-1.5 font-semibold">작업팀</th>
                  <th className="py-1.5 font-semibold">서명</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w, i) => (
                  <tr key={w.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 tabular-nums text-slate-500">{i + 1}</td>
                    <td className="py-1.5 tabular-nums text-slate-600">
                      {w.empNo ?? <span className="text-rose-600">없음</span>}
                    </td>
                    <td className="py-1.5 font-semibold text-slate-900">{w.name}</td>
                    <td className="py-1.5 text-slate-600">
                      {w.team?.name ?? <span className="text-rose-600">미배정</span>}
                    </td>
                    <td className="py-1.5 text-xs text-slate-300">종이에서 받습니다</td>
                  </tr>
                ))}
                {Array.from({ length: BLANK_ROWS }, (_, i) => (
                  <tr key={`blank-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 tabular-nums text-slate-400">
                      {workers.length + i + 1}
                    </td>
                    <td className="py-1.5 text-xs text-slate-400" colSpan={4}>
                      명부에 없는 참석자용 빈 줄
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500">
          빨간 글씨는 종이에도 빈칸으로 찍힙니다. 명부는{" "}
          <a href={`/admin/workers?site=${site.id}`} className="underline">
            작업자 명부
          </a>
          에서 고칩니다 — 뽑기 전에 퇴사·입사를 반영하세요.
        </p>
      </section>

      <SessionManager
        siteId={site.id}
        siteName={site.name}
        kind={preset.kind}
        eduTitle={preset.title}
        defaultContents={preset.contents}
        defaultEduDate={ymd(kstDateOnly())}
        sessions={sessionRows}
      />

      <form action="/api/print/roster" method="post" className="card space-y-4">
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="kind" value={preset.kind} />

        <div>
          <h2 className="font-bold text-slate-900">서명부 뽑기</h2>
          <p className="mt-1 text-xs text-slate-500">
            비워 두면 종이에 밑줄만 찍힙니다. 교육하는 자리에서 손으로 적으셔도
            됩니다.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="heldAt">
              일시
            </label>
            <input
              id="heldAt"
              name="heldAt"
              className="field"
              placeholder="2026-11-20 08:30 ~ 09:30"
            />
          </div>
          <div>
            <label className="label" htmlFor="duration">
              교육시간
            </label>
            <input id="duration" name="duration" className="field" placeholder="1시간" />
          </div>
          <div>
            <label className="label" htmlFor="place">
              장소
            </label>
            <input id="place" name="place" className="field" placeholder="진천공장 식당" />
          </div>
          <div>
            <label className="label" htmlFor="instructor">
              강사
            </label>
            <input
              id="instructor"
              name="instructor"
              className="field"
              placeholder="성명 / 직책"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="contents">
            교육 내용 (한 줄에 하나)
          </label>
          <textarea
            id="contents"
            name="contents"
            rows={preset.contents.length + 1}
            defaultValue={preset.contents.join("\n")}
            className="field font-normal"
          />
          <p className="mt-1 text-xs text-slate-500">
            시행령에 적힌 항목을 기본값으로 넣어 두었습니다.{" "}
            <strong>인쇄 전에 현행 조문과 한 번 맞춰 보세요</strong> — 개정되면 이
            기본값이 뒤처집니다.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="all" className="mt-0.5 size-4" />
          <span>
            법인 {sites.length}곳 전부를 한 번에 받기 (약 {totalPages}장)
            <span className="mt-0.5 block text-xs text-slate-500">
              법인마다 장이 갈려 나오므로 그대로 나눠 꽂으면 됩니다. 의무 주체가
              법인이라 서류는 법인별로 갈라져 있어야 합니다.
            </span>
          </span>
        </label>

        {/*
          교육 뒤 보관용. 시작·종료 시각과 체류시간이 칸에 채워져 나온다.
          이쪽에는 QR을 찍지 않는다 — 끝난 종이에 스캔 그림이 남아 있으면
          다음 해에 그걸 찍는 사람이 생긴다.
        */}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="withScanTimes"
            className="mt-0.5 size-4"
            defaultChecked={false}
          />
          <span>
            교육이 끝난 뒤 보관용으로 받기
            <span className="mt-0.5 block text-xs text-slate-500">
              시작·종료 스캔 시각과 교육시간이 채워집니다. QR은 찍지 않습니다.
              {!hasScans && " (아직 찍힌 기록이 없어 빈 칸으로 나옵니다)"}
            </span>
          </span>
        </label>

        <button type="submit" className="btn-primary w-full py-2.5">
          서명부 내려받기
        </button>
      </form>

      <section className="card">
        <h2 className="font-bold text-slate-900">교안 받는 곳</h2>
        <ul className="mt-2 space-y-2 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">성희롱 예방교육</strong> —{" "}
            <a
              href="https://www.moel.go.kr/policy/policydata/view.do?bbs_seq=20230200399"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              고용노동부 표준강의안(1시간용)
            </a>
            . <strong>강사 자격 요건이 없어</strong> 사업주나 소속 근로자가 직접 해도
            됩니다.
          </li>
          <li>
            <strong className="text-slate-900">장애인 인식개선교육</strong> —{" "}
            <a
              href="https://edu.kead.or.kr/aisd/main.do"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              교육포털 교육자료실
            </a>
            . 간이교육용 리플릿과 17개 언어 번역본이 있습니다(로그인 필요).
          </li>
          <li>
            <strong className="text-slate-900">개인정보 보호교육</strong> — 이
            화면에는 없습니다. 대상이 근로자가 아니라 명부·출석·사진을 다루는{" "}
            <strong>계정 15개</strong>(본사 1 + 안전관리자 14)이고, 각자 서울시
            평생학습포털에서 수강해 수료증으로 증빙합니다.{" "}
            <strong>수료증은 회사가 모아 보관하십시오</strong> — 감독관에게 내보일
            사람은 개인이 아니라 사업주입니다.
          </li>
          <li>
            <strong className="text-slate-900">외국인 근로자</strong> — 자료만 주고
            끝내지 마십시오. 모국어 번역본을 나눠 주고, 어느 언어로 무엇을 줬는지
            교육방법 칸에 적어 두는 것이 실제로 교육했다는 증거가 됩니다. 장애인
            인식개선은 17개 언어 리플릿이 있습니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
