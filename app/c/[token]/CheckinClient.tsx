"use client";

import { useActionState, useMemo, useState } from "react";
import { checkinAction, forgetWorkerAction, type CheckinResult } from "@/actions/checkin";

type WorkerOption = {
  id: string;
  name: string;
  empNo: string | null;
  siteName: string;
  teamName: string | null;
  hasPhone: boolean;
};

export default function CheckinClient({
  token,
  workers,
  remembered,
  alreadyToday,
  lateAfter,
  isLateNow,
  multiSite,
}: {
  token: string;
  workers: WorkerOption[];
  remembered: { id: string; name: string } | null;
  alreadyToday: boolean;
  lateAfter: string;
  isLateNow: boolean;
  multiSite: boolean;
}) {
  const [state, formAction, pending] = useActionState<CheckinResult, FormData>(
    checkinAction,
    { status: "idle" },
  );

  // 기기에 기억된 사람이 있으면 곧바로 그 사람으로 시작한다.
  const [selectedId, setSelectedId] = useState<string | null>(remembered?.id ?? null);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => workers.find((w) => w.id === selectedId) ?? null,
    [workers, selectedId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.empNo ?? "").toLowerCase().includes(q) ||
        (w.teamName ?? "").toLowerCase().includes(q) ||
        w.siteName.toLowerCase().includes(q),
    );
  }, [workers, query]);

  if (state.status === "done") {
    return (
      <div className="card border-l-4 border-l-emerald-500 text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
          ✓
        </div>
        <p className="text-xl font-bold text-slate-900">
          {state.workerName} 님 {state.already ? "이미 출석 완료" : "출석 완료"}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {multiSite && <span className="text-slate-500">{state.siteName} · </span>}
          {state.teamName} · {state.at}
          {state.late && <span className="ml-1 font-semibold text-amber-600">(지각)</span>}
        </p>
        <p className="mt-4 text-sm text-slate-500">안전한 하루 되세요.</p>
      </div>
    );
  }

  // --- 기억된 사람: 버튼 한 번으로 끝 -------------------------------------
  if (remembered && selectedId === remembered.id) {
    return (
      <div className="space-y-3">
        {alreadyToday && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
            오늘은 이미 출석 처리되었습니다.
          </div>
        )}
        {isLateNow && !alreadyToday && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
            {lateAfter} 이후 체크인은 지각으로 기록됩니다.
          </div>
        )}

        <form action={formAction} className="card text-center">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="workerId" value={remembered.id} />

          <p className="text-sm text-slate-500">본인이 맞습니까?</p>
          <p className="mt-1 mb-5 text-3xl font-bold text-slate-900">{remembered.name}</p>

          <button type="submit" disabled={pending} className="btn-primary w-full py-4 text-lg">
            {pending ? "처리 중…" : alreadyToday ? "다시 확인" : "출석하기"}
          </button>
        </form>

        {state.status === "error" && <ErrorBox message={state.message} />}

        <div className="flex justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="text-slate-500 underline underline-offset-2"
          >
            다른 사람입니다
          </button>
          <form action={forgetWorkerAction}>
            <button type="submit" className="text-slate-500 underline underline-offset-2">
              이 기기 기억 지우기
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- 본인 선택 후 확인 ---------------------------------------------------
  if (selected) {
    return (
      <div className="space-y-3">
        <form action={formAction} className="card">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="workerId" value={selected.id} />

          <p className="text-sm text-slate-500">
            {multiSite && `${selected.siteName} · `}
            {selected.teamName ?? "팀 미지정"}
          </p>
          <p className="mt-0.5 mb-4 text-2xl font-bold text-slate-900">{selected.name}</p>

          <label className="label" htmlFor="verify">
            {selected.hasPhone ? "휴대폰 뒤 4자리" : "사번"}
          </label>
          <input
            id="verify"
            name="verify"
            inputMode={selected.hasPhone ? "numeric" : "text"}
            autoComplete="off"
            maxLength={selected.hasPhone ? 4 : 20}
            placeholder={selected.hasPhone ? "예: 1234" : selected.empNo ?? ""}
            className="field text-center text-2xl tracking-widest"
            required
          />
          <p className="mt-2 text-xs text-slate-500">
            처음 한 번만 확인합니다. 다음부터는 버튼만 누르면 됩니다.
          </p>

          <button type="submit" disabled={pending} className="btn-primary mt-4 w-full py-4 text-lg">
            {pending ? "처리 중…" : "출석하기"}
          </button>
        </form>

        {state.status === "error" && <ErrorBox message={state.message} />}

        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="w-full text-center text-sm text-slate-500 underline underline-offset-2"
        >
          다시 선택
        </button>
      </div>
    );
  }

  // --- 명단에서 본인 찾기 --------------------------------------------------
  return (
    <div className="space-y-3">
      {state.status === "error" && <ErrorBox message={state.message} />}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 · 사번 · 팀으로 검색"
        className="field"
        autoFocus
      />

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            일치하는 작업자가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(w.id)}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-900">{w.name}</span>
                    {multiSite && (
                      <span className="block truncate text-xs text-slate-400">
                        {w.siteName}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-sm text-slate-500">
                    {w.teamName ?? "팀 미지정"}
                    {w.empNo && <span className="block text-xs text-slate-400">{w.empNo}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
      {message}
    </div>
  );
}
