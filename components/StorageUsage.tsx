import { capacityLabel, daysLeft, formatBytes, percent, readUsage } from "@/lib/usage";
import { pruneCutoff, ymdUtc } from "@/lib/photoRetention";

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = percent(used, limit);
  // 색으로 먼저 알아채게 한다. 숫자를 읽기 전에 손을 써야 할 때가 있다.
  const tone =
    pct >= 80 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${tone} transition-all`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
    </div>
  );
}

function Row({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: number;
  limit: number;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-sm tabular-nums text-slate-600">
          <span className="font-semibold text-slate-900">{formatBytes(used)}</span>
          <span className="text-slate-400"> / {formatBytes(limit)}</span>
          <span className="ml-1.5 text-xs text-slate-500">({percent(used, limit)}%)</span>
        </p>
      </div>
      <Bar used={used} limit={limit} />
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/**
 * 지금 무료 한도를 얼마나 쓰고 있는지.
 *
 * 어림잡지 않고 저장소에 직접 물어본다. 느릴 수 있어 Suspense 안에 두고,
 * 본사 계정에만 보여 준다 — 현장에서는 손쓸 수 있는 일이 아니다.
 */
export default async function StorageUsage() {
  const usage = await readUsage();
  const cutoff = pruneCutoff();

  const blobBytes = usage.blob.bytes;
  const left =
    blobBytes === null
      ? null
      : capacityLabel(daysLeft(blobBytes, usage.blob.limit, usage.blob.recentBytes));

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">저장 용량</h2>
        <p className="text-xs text-slate-500">무료 요금제 한도 기준</p>
      </div>

      <div className="space-y-4">
        <Row
          label="기록 (Neon)"
          used={usage.db.bytes}
          limit={usage.db.limit}
          note="TBM·순찰일지·명부·감사 로그. 하루 100KB쯤 늘어 몇 년을 둬도 넉넉합니다."
        />

        {blobBytes === null ? (
          <div>
            <p className="text-sm font-medium text-slate-800">사진 (Blob)</p>
            <p className="mt-1 text-xs text-slate-500">
              저장소 크기를 읽지 못했습니다. 사진 {usage.photos.live}장을 보관 중입니다.
            </p>
          </div>
        ) : (
          <Row
            label="사진 (Blob)"
            used={blobBytes}
            limit={usage.blob.limit}
            note={
              `사진 ${usage.photos.live}장` +
              (usage.photos.archived > 0 ? ` · 정리됨 ${usage.photos.archived}장` : "") +
              ` · 최근 30일 +${formatBytes(usage.blob.recentBytes)}` +
              (left ? ` · ${left}` : "")
            }
          />
        )}
      </div>

      {(usage.blob.orphanFiles > 0 || usage.blob.prunableFiles > 0) && (
        <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
          <p className="text-xs font-semibold text-slate-500">되찾을 수 있는 용량</p>

          {usage.blob.orphanFiles > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-sm font-medium text-slate-800">
                주인 없는 파일 {usage.blob.orphanFiles}개 ·{" "}
                {formatBytes(usage.blob.orphanBytes)}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                화면에서 지운 사진이 파일로만 남은 것입니다. 어느 기록도 이 파일을
                쓰지 않습니다.
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-2.5 py-2 text-xs text-slate-100">
                <code>npm run prune-orphans{"\n"}npm run prune-orphans -- --confirm</code>
              </pre>
            </div>
          )}

          {usage.blob.prunableFiles > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
              <p className="text-sm font-medium text-amber-900">
                보관 기간이 지난 사진 {usage.blob.prunableFiles}장 ·{" "}
                {formatBytes(usage.blob.prunableBytes)}
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                백업을 먼저 받으세요. 지운 사진은 되돌릴 수 없습니다. 관리 화면의
                “사진 보관”에 자세한 안내가 있습니다.
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-2.5 py-2 text-xs text-slate-100">
                <code>
                  npm run backup{"\n"}
                  npm run prune-photos -- --before {ymdUtc(cutoff)} --confirm
                </code>
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
