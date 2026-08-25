import { prisma } from "@/lib/db";
import {
  KEEP_MONTHS,
  approxMb,
  beforeLabel,
  pruneCutoff,
  ymdUtc,
} from "@/lib/photoRetention";

/**
 * 사진 정리 시점 안내.
 *
 * 자동으로 지우지 않는다. 백업이 실제로 되어 있는지는 시스템이 알 수 없고,
 * 한 번 지운 사진은 되돌릴 방법이 없기 때문이다. 언제 무엇을 지워야 하는지만
 * 알려 주고, 지우는 것은 사람이 명령으로 한다.
 */
export default async function PhotoRetentionNotice() {
  const cutoff = pruneCutoff();

  const [total, prunable, archived] = await Promise.all([
    prisma.tbmPhoto.count({ where: { archivedAt: null } }),
    prisma.tbmPhoto.count({
      where: { archivedAt: null, tbm: { workDate: { lt: cutoff } } },
    }),
    prisma.tbmPhoto.count({ where: { archivedAt: { not: null } } }),
  ]);

  if (total === 0 && archived === 0) return null;

  const cutoffYmd = ymdUtc(cutoff);
  const ready = prunable > 0;

  return (
    <section
      className={`card ${ready ? "border-l-4 border-l-amber-400" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">사진 보관</h2>
        <p className="text-xs text-slate-500">
          보관 중 {total}장 · 약 {approxMb(total)} MB
          {archived > 0 && ` · 정리됨 ${archived}장`}
        </p>
      </div>

      {ready ? (
        <>
          <p className="mt-2 text-sm font-medium text-amber-900">
            {beforeLabel(cutoff)} 사진 <strong>{prunable}장</strong>(약{" "}
            {approxMb(prunable)} MB)이 정리 대상입니다.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            사진만 지우고 TBM 본문·출석·점검 결과는 그대로 남습니다. 촬영 시각과
            위치 검증 기록도 남아 사후 확인이 됩니다.{" "}
            <strong className="text-rose-700">
              지운 사진은 되돌릴 수 없으니 백업을 먼저 받으세요.
            </strong>
          </p>

          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 text-xs leading-relaxed text-slate-100">
            <code>
              {`npm run backup\n`}
              {`npm run prune-photos -- --before ${cutoffYmd}\n`}
              {`npm run prune-photos -- --before ${cutoffYmd} --confirm`}
            </code>
          </pre>
          <p className="mt-1.5 text-xs text-slate-500">
            둘째 줄은 미리보기입니다. 무엇이 지워지는지 확인한 뒤 셋째 줄을
            실행하세요. 해당 기간 백업이 없으면 실행 자체가 거부됩니다.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          정리할 사진이 없습니다. 최근 {KEEP_MONTHS}개월치는 그대로 둡니다.
        </p>
      )}
    </section>
  );
}
