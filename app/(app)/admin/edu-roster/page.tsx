import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { BLANK_ROWS, EDU_PRESETS, countPages } from "@/lib/eduRoster";
import { ROWS_FIRST_PAGE, ROWS_LATER_PAGE } from "@/lib/eduRosterPdf";
import SiteSwitcher from "@/components/admin/SiteSwitcher";

export const dynamic = "force-dynamic";

/**
 * 법정의무교육 교육대장(참석자 서명부)을 뽑는 화면.
 *
 * TBM은 산업안전보건법 정기교육의 증빙이 되지만, 성희롱 예방·장애인
 * 인식개선처럼 다른 법에 걸린 교육은 따로 하고 따로 기록해야 한다. 고용노동부는
 * 자료를 배포·게시하거나 메일만 보내는 것을 교육 실시로 보지 않으므로
 * (상시 10인 이상), 결국 남아야 하는 것은 교육자료·참석자 서명·사진 세 가지다.
 * 그중 가운데를 받아 올 종이를 여기서 인쇄한다.
 *
 * 일부러 DB에 아무것도 쓰지 않는다. 교육을 하기 전에 뽑는 빈 서식이고, 실시
 * 기록을 시스템에 넣는 일은 그 자체로 결재선이 필요해 따로 다룰 일이다.
 */
export default async function EduRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; kind?: string }>;
}) {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const { site: requested, kind: requestedKind } = await searchParams;
  const { sites, site } = await resolveAdminSite(user, requested);

  if (!site) {
    return <p className="card text-sm text-slate-500">관리할 사업장이 없습니다.</p>;
  }

  const preset =
    EDU_PRESETS.find((p) => p.kind === requestedKind) ?? EDU_PRESETS[0];

  const headcount = await prisma.worker.count({
    where: { siteId: site.id, active: true },
  });
  const pages = countPages(headcount, ROWS_FIRST_PAGE, ROWS_LATER_PAGE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">법정의무교육 서명부</h1>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      <section className="card">
        <h2 className="font-bold text-slate-900">무엇에 쓰는 종이인가</h2>
        <p className="mt-2 text-sm text-slate-600">
          TBM은 <strong>산업안전보건법 정기교육</strong>의 증빙이 됩니다(고용노동부가
          2023년 12월부터 인정). 성희롱 예방·장애인 인식개선처럼 다른 법에 걸린
          교육은 따로 실시하고 따로 기록해야 합니다.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          자료를 배포·게시하거나 메일만 보내는 것은 교육 실시로 인정되지
          않습니다(상시 10인 이상). 남아야 하는 것은 <strong>교육자료 · 참석자 서명 ·
          교육 사진</strong> 세 가지이고, 이 화면은 그중 <strong>서명부</strong>를
          인쇄합니다.
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
                href={`/admin/edu-roster?site=${site.id}&kind=${p.kind}`}
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

      <form action="/api/print/roster" method="post" className="card space-y-4">
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="kind" value={preset.kind} />

        <div>
          <h2 className="font-bold text-slate-900">미리 채울 값</h2>
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
            <input id="instructor" name="instructor" className="field" placeholder="성명 / 직책" />
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

        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <strong className="text-slate-900">{site.name}</strong> 재직 {headcount}명 ·
          빈 줄 {BLANK_ROWS}개 · 약 {pages}장
          <p className="mt-1 text-xs text-slate-500">
            명부에 없는 사람이 와서 들을 때를 위해 빈 줄을 둡니다. 다른 데 적어 두고
            나중에 옮기는 과정에서 가장 많이 빠집니다.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="all" className="mt-0.5 size-4" />
          <span>
            맡은 사업장 전부를 한 번에 받기
            <span className="mt-0.5 block text-xs text-slate-500">
              법인마다 장이 갈려 나오므로 그대로 나눠 꽂으면 됩니다. 의무 주체가
              법인이라 서류는 법인별로 갈라져 있어야 합니다.
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
            <strong className="text-slate-900">성희롱 예방교육</strong> — 고용노동부
            정책자료실. 표준강의안(1시간용) pptx와 자체교육용 영상이 있습니다.
            <strong> 강사 자격 요건이 없어</strong> 사업주나 소속 근로자가 직접 해도
            됩니다.
          </li>
          <li>
            <strong className="text-slate-900">장애인 인식개선교육</strong> — 직장 내
            장애인 인식개선 교육포털(edu.kead.or.kr) 교육자료실. 간이교육용 리플릿과
            17개 언어 번역본이 있습니다(로그인 필요).
          </li>
          <li>
            <strong className="text-slate-900">외국인 근로자</strong> — 자료만 주고
            끝내지 마십시오. 통역을 세우고, 그 사실을 교육방법 칸에 적어 두는 것이
            실제로 교육했다는 증거가 됩니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
