"use client";

import { useActionState, useState } from "react";
import { setPointCoverageAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export type CoverageSite = { id: string; code: string; name: string; address: string | null };

/**
 * 이 QR이 출석을 받아 줄 사업장 목록을 고른다.
 * 공용 지문인식기처럼 한 장소에 여러 법인이 있을 때 쓴다.
 */
export default function PointCoverage({
  pointId,
  ownerSiteId,
  allSites,
  selectedIds,
  sameAddressIds,
}: {
  pointId: string;
  ownerSiteId: string;
  allSites: CoverageSite[];
  selectedIds: string[];
  sameAddressIds: string[];
}) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => setPointCoverageAction(fd),
    IDLE,
  );
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(selectedIds);

  const covered = allSites.filter((s) => selectedIds.includes(s.id));

  if (!open) {
    return (
      <div className="print:hidden">
        <p className="text-xs text-slate-500">
          받는 사업장 {covered.length}곳
          {covered.length > 1 && " (공용)"}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {covered.map((s) => s.code).join(", ")}
        </p>
        <button
          type="button"
          onClick={() => {
            setPicked(selectedIds);
            setOpen(true);
          }}
          className="mt-1 text-xs font-semibold text-slate-600 hover:underline"
        >
          담당 사업장 바꾸기
        </button>
      </div>
    );
  }

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <form action={action} className="mt-2 rounded-lg bg-slate-50 p-3 text-left ring-1 ring-slate-200 print:hidden">
      <input type="hidden" name="pointId" value={pointId} />

      <p className="text-sm font-bold text-slate-900">이 QR로 출석할 사업장</p>
      <p className="mt-1 text-xs text-slate-500">
        같은 지문인식기를 쓰는 법인을 모두 고르세요. 출결 마감·지각 기준은 각자
        자기 사업장 설정을 따릅니다.
      </p>

      {sameAddressIds.length > 1 && (
        <button
          type="button"
          onClick={() => setPicked(sameAddressIds)}
          className="mt-2 text-xs font-semibold text-sky-700 hover:underline"
        >
          같은 주소 사업장 {sameAddressIds.length}곳 모두 선택
        </button>
      )}

      <ul className="mt-2 max-h-60 space-y-0.5 overflow-auto">
        {allSites.map((s) => {
          const isOwner = s.id === ownerSiteId;
          const checked = isOwner || picked.includes(s.id);
          return (
            <li key={s.id}>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-white ${isOwner ? "opacity-70" : ""}`}
              >
                <input
                  type="checkbox"
                  name="siteIds"
                  value={s.id}
                  checked={checked}
                  disabled={isOwner}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-slate-900"
                />
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-slate-800">
                    <span className="mr-1.5 font-mono text-xs text-slate-500">{s.code}</span>
                    {s.name}
                  </span>
                  {isOwner && (
                    <span className="ml-1 text-xs text-slate-400">(관리 주체, 항상 포함)</span>
                  )}
                  <span className="block truncate text-xs text-slate-400">
                    {s.address ?? "주소 없음"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* 관리 주체는 disabled라 전송되지 않으므로 따로 넣어 준다 */}
      <input type="hidden" name="siteIds" value={ownerSiteId} />

      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      {state.ok && !state.error && (
        <p className="mt-2 text-sm font-medium text-emerald-700">저장했습니다.</p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-secondary flex-1 py-1.5 text-sm">
          {pending ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary flex-1 py-1.5 text-sm"
        >
          닫기
        </button>
      </div>
    </form>
  );
}
