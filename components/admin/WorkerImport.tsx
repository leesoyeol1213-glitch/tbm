"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportResponse } from "@/app/api/admin/workers/import/route";

export default function WorkerImport({
  siteId,
  hasTeams,
}: {
  siteId: string;
  hasTeams: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [createTeams, setCreateTeams] = useState(!hasTeams);
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("siteId", siteId);
      body.append("createTeams", createTeams ? "1" : "0");
      body.append("deactivateMissing", deactivateMissing ? "1" : "0");
      body.append("dryRun", dryRun ? "1" : "0");

      const res = await fetch("/api/admin/workers/import", { method: "POST", body });
      const data: ImportResponse & { error?: string } = await res.json();

      if (!res.ok) {
        setError(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      setPreview(data);

      if (data.applied) {
        const { create, update, deactivate } = data.summary;
        setDone(
          `신규 ${create}명 등록, ${update}명 수정${deactivate > 0 ? `, ${deactivate}명 비활성화` : ""} 완료했습니다.`,
        );
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("네트워크 오류로 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPreview(null);
    setDone(null);
    setError(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const s = preview?.summary;
  const canApply = preview && !preview.applied && !preview.fatal && s && s.create + s.update > 0;

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-bold text-slate-900">엑셀로 일괄 등록</h2>
        <p className="mt-1 text-xs text-slate-500">
          양식을 내려받아 채운 뒤 올리면, 먼저 결과를 보여 드리고 확인 후에 반영합니다.
        </p>
      </div>

      <a
        href={`/api/admin/workers/template?site=${siteId}`}
        className="btn-secondary w-full sm:w-auto"
      >
        ① 엑셀 양식 내려받기
      </a>

      <div>
        <label className="label" htmlFor="worker-file">
          ② 채운 파일 올리기
        </label>
        <input
          ref={fileRef}
          id="worker-file"
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setDone(null);
            setError(null);
          }}
          className="field file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
      </div>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={createTeams}
            onChange={(e) => setCreateTeams(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-slate-900"
          />
          <span className="text-sm text-slate-700">
            없는 팀은 자동으로 만들기
            <span className="block text-xs text-slate-500">
              끄면 등록되지 않은 팀 이름은 오류로 표시됩니다.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={deactivateMissing}
            onChange={(e) => setDeactivateMissing(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-slate-900"
          />
          <span className="text-sm text-slate-700">
            파일에 없는 인원은 비활성화하기
            <span className="block text-xs text-slate-500">
              전체 명부를 통째로 갱신할 때만 켜세요. 과거 출석 기록은 남습니다.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      {done && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          {done}
        </p>
      )}

      {!preview && (
        <button
          type="button"
          disabled={!file || busy}
          onClick={() => send(true)}
          className="btn-primary w-full"
        >
          {busy ? "확인 중…" : "③ 내용 확인하기"}
        </button>
      )}

      {preview?.fatal && (
        <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-sm font-semibold text-rose-900">파일을 읽지 못했습니다</p>
          <p className="mt-1 text-sm text-rose-800">{preview.fatal}</p>
        </div>
      )}

      {preview && !preview.fatal && s && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3">
            <Num label="신규 등록" value={s.create} tone="ok" />
            <Num label="기존 수정" value={s.update} />
            <Num label="오류" value={s.error} tone={s.error > 0 ? "warn" : undefined} />
          </div>

          {s.newTeams.length > 0 && (
            <p className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-900 ring-1 ring-sky-200">
              새로 만들 팀 {s.newTeams.length}개: {s.newTeams.join(", ")}
            </p>
          )}
          {s.deactivate > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
              파일에 없는 {s.deactivate}명이 비활성화됩니다.
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2 font-semibold">줄</th>
                  <th className="px-2 py-2 font-semibold">이름</th>
                  <th className="px-2 py-2 font-semibold">사번</th>
                  <th className="px-2 py-2 font-semibold">팀</th>
                  <th className="px-2 py-2 font-semibold">결과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.action === "error" ? "bg-rose-50" : ""}>
                    <td className="px-2 py-1.5 tabular-nums text-slate-400">{r.line}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-900">{r.name || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.empNo || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.teamName || "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.action === "error" ? (
                        <span className="text-xs font-medium text-rose-700">
                          {r.errors.join(" / ")}
                        </span>
                      ) : (
                        <span
                          className={`text-xs font-semibold ${r.action === "create" ? "text-emerald-700" : "text-slate-500"}`}
                        >
                          {r.action === "create" ? "신규" : "수정"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {s.error > 0 && !preview.applied && (
            <p className="text-sm text-slate-600">
              오류가 있는 {s.error}줄은 건너뛰고 나머지만 반영합니다. 전부 넣으려면
              파일을 고쳐 다시 올리세요.
            </p>
          )}

          <div className="flex gap-2">
            {canApply && (
              <button
                type="button"
                disabled={busy}
                onClick={() => send(false)}
                className="btn-primary flex-1"
              >
                {busy ? "반영 중…" : `④ ${s.create + s.update}명 반영하기`}
              </button>
            )}
            <button type="button" onClick={reset} className="btn-secondary flex-1">
              {preview.applied ? "닫기" : "취소"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Num({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-rose-600" : "text-slate-900";
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
