"use client";

import { useActionState, useMemo, useState } from "react";
import { forgetWorkerAction } from "@/actions/checkin";
import { legalEduScanAction, type ScanResult } from "@/actions/legalEduScan";
import type { ScanStep } from "@/lib/legalEdu";

type WorkerOption = {
  id: string;
  name: string;
  empNo: string | null;
  /** 지금 생년월일을 물어야 하는지. 반기 안에 확인을 마쳤으면 묻지 않는다. */
  needsVerify: boolean;
  /** 지금 이 사람이 찍을 차례 */
  step: ScanStep;
};

const STEP_BUTTON: Record<ScanStep, string> = {
  START: "교육 시작 찍기",
  END: "교육 끝 찍기",
  DONE: "다 찍었습니다",
};

/**
 * 법정의무교육 스캔.
 *
 * 시작과 끝을 따로 찍는다. 첫 스캔을 시작으로, 다음을 끝으로 **자동 판정하지
 * 않는다** — 교육 중에 실수로 한 번 더 찍으면 그 시각이 퇴장으로 남아 체류시간이
 * 몇 분으로 줄어 버린다. 지금 찍을 차례를 화면이 보여 주고, 사람이 그 단추를
 * 눌러서 찍는다.
 */
export default function ScanClient({
  token,
  workers,
  rememberedId,
}: {
  token: string;
  workers: WorkerOption[];
  rememberedId: string | null;
}) {
  const [state, formAction, pending] = useActionState<ScanResult, FormData>(
    legalEduScanAction,
    { status: "idle" },
  );

  const remembered = workers.find((w) => w.id === rememberedId) ?? null;
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
        (w.empNo ?? "").toLowerCase().includes(q),
    );
  }, [workers, query]);

  // --- 찍은 뒤 ------------------------------------------------------------
  if (state.status === "done") {
    const isEnd = state.step === "END";
    return (
      <div className="card border-l-4 border-l-emerald-500 text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
          ✓
        </div>
        <p className="text-xl font-bold text-slate-900">
          {state.workerName} 님{" "}
          {state.already ? "이미 다 찍으셨습니다" : isEnd ? "교육 끝" : "교육 시작"}
        </p>
        <p className="mt-1 text-sm text-slate-600">{state.at}</p>

        {isEnd ? (
          <>
            {state.stayLabel && (
              <p className="mt-3 text-sm text-slate-700">
                교육 시간 <strong className="text-slate-900">{state.stayLabel}</strong>
              </p>
            )}
            <p className="mt-4 text-sm text-slate-500">수고하셨습니다.</p>
          </>
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
            교육이 끝나면 <strong>한 번 더</strong> 찍어 주세요.
          </p>
        )}
      </div>
    );
  }

  // --- 기억된 사람: 단추 한 번 -------------------------------------------
  if (remembered && selectedId === remembered.id) {
    const done = remembered.step === "DONE";
    return (
      <div className="space-y-3">
        {remembered.step === "END" && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
            시작은 찍으셨습니다. 교육이 끝났으면 아래를 눌러 주세요.
          </div>
        )}
        {done && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
            시작과 끝을 모두 찍으셨습니다.
          </div>
        )}

        <form action={formAction} className="card text-center">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="workerId" value={remembered.id} />
          <input type="hidden" name="step" value={remembered.step} />

          <p className="text-sm text-slate-500">본인이 맞습니까?</p>
          <p className="mt-1 mb-5 text-3xl font-bold text-slate-900">{remembered.name}</p>

          <button
            type="submit"
            disabled={pending || done}
            className="btn-primary w-full py-4 text-lg disabled:opacity-50"
          >
            {pending ? "처리 중…" : STEP_BUTTON[remembered.step]}
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

  // --- 고른 사람: 필요하면 생년월일 ---------------------------------------
  if (selected) {
    const done = selected.step === "DONE";
    return (
      <div className="space-y-3">
        <form action={formAction} className="card">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="workerId" value={selected.id} />
          <input type="hidden" name="step" value={selected.step} />

          <p className="text-sm text-slate-500">이 분이 맞습니까?</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {selected.name}
            {selected.empNo && (
              <span className="ml-2 text-base font-normal text-slate-400">
                {selected.empNo}
              </span>
            )}
          </p>

          {selected.step === "END" && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              시작은 찍혀 있습니다. 이번에는 끝을 찍습니다.
            </p>
          )}
          {done && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
              시작과 끝을 모두 찍으셨습니다.
            </p>
          )}

          {selected.needsVerify && !done && (
            <div className="mt-4">
              <label className="label" htmlFor="verify">
                태어난 월일 네 자리
              </label>
              <input
                id="verify"
                name="verify"
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 0315"
                className="field text-center text-lg tracking-widest"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                처음 한 번만 확인합니다. 다음부터는 묻지 않습니다.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={pending || done}
            className="btn-primary mt-4 w-full py-4 text-lg disabled:opacity-50"
          >
            {pending ? "처리 중…" : STEP_BUTTON[selected.step]}
          </button>
        </form>

        {state.status === "error" && <ErrorBox message={state.message} />}

        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="block w-full text-center text-sm text-slate-500 underline underline-offset-2"
        >
          다른 사람 고르기
        </button>
      </div>
    );
  }

  // --- 사람 고르기 --------------------------------------------------------
  return (
    <div className="space-y-3">
      {state.status === "error" && <ErrorBox message={state.message} />}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 또는 사번으로 찾기"
        className="field"
        aria-label="작업자 찾기"
      />

      {filtered.length === 0 ? (
        <p className="card text-sm text-slate-500">찾는 사람이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {filtered.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => setSelectedId(w.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">
                    {w.name}
                  </span>
                  {w.empNo && (
                    <span className="text-xs text-slate-500">{w.empNo}</span>
                  )}
                </span>
                {/* 누가 아직 안 찍었는지 본인도 보이게 해 둔다. */}
                {w.step === "DONE" ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    완료
                  </span>
                ) : w.step === "END" ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    끝 남음
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">미기록</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
      {message}
    </p>
  );
}
