"use client";

import { useActionState, useState } from "react";
import { saveTemplateAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

type Pair = { a: string; b: string };

export default function TemplateEditor({
  templateId,
  name,
  workDescription,
  eduItems: initialEdu,
  hazards: initialHazards,
  readOnly,
}: {
  templateId: string;
  name: string;
  workDescription: string;
  eduItems: string[];
  hazards: { hazard: string; control: string }[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => saveTemplateAction(formData),
    IDLE,
  );

  const [edu, setEdu] = useState<Pair[]>(
    initialEdu.length > 0 ? initialEdu.map((a) => ({ a, b: "" })) : [{ a: "", b: "" }],
  );
  const [hazards, setHazards] = useState<Pair[]>(
    initialHazards.length > 0
      ? initialHazards.map((h) => ({ a: h.hazard, b: h.control }))
      : [{ a: "", b: "" }],
  );

  if (readOnly) {
    return (
      <div className="card">
        <p className="text-sm text-slate-600">
          전사 공통 템플릿은 본사 관리자만 수정할 수 있습니다. 이 사업장만의 내용이
          필요하면 위에서 전용 양식을 만드세요.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="eduItems" value={JSON.stringify(edu)} />
      <input type="hidden" name="hazards" value={JSON.stringify(hazards)} />

      <div className="card">
        <div className="mb-3">
          <label className="label" htmlFor="name">
            템플릿 이름
          </label>
          <input id="name" name="name" defaultValue={name} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="workDescription">
            기본 작업 내용
          </label>
          <textarea
            id="workDescription"
            name="workDescription"
            defaultValue={workDescription}
            rows={2}
            className="field resize-y"
            placeholder="매일 TBM에 자동으로 채워질 문구"
          />
        </div>
      </div>

      {/* --- 교육 항목 --- */}
      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">매일 교육할 항목</h2>
          <button
            type="button"
            onClick={() => setEdu((p) => [...p, { a: "", b: "" }])}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            + 추가
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          여기에 넣은 항목이 매일 TBM에 자동으로 들어갑니다.
        </p>

        <ul className="space-y-2">
          {edu.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-3 w-5 shrink-0 text-right text-xs font-bold text-slate-400">
                {i + 1}
              </span>
              <textarea
                value={item.a}
                onChange={(e) =>
                  setEdu((p) => p.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))
                }
                rows={2}
                className="field flex-1 resize-y"
                placeholder="교육 항목"
              />
              {edu.length > 1 && (
                <button
                  type="button"
                  onClick={() => setEdu((p) => p.filter((_, j) => j !== i))}
                  className="mt-2 shrink-0 text-xs font-semibold text-rose-600 hover:underline"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* --- 상시 위험요인 --- */}
      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">상시 위험요인 및 안전대책</h2>
          <button
            type="button"
            onClick={() => setHazards((p) => [...p, { a: "", b: "" }])}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            + 추가
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          위험성평가 결과 중 매일 공유해야 하는 항목을 넣어 두세요.
        </p>

        <ul className="space-y-3">
          {hazards.map((h, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">{i + 1}</span>
                {hazards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setHazards((p) => p.filter((_, j) => j !== i))}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                value={h.a}
                onChange={(e) =>
                  setHazards((p) =>
                    p.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)),
                  )
                }
                placeholder="위험요인"
                className="field mb-2"
              />
              <input
                value={h.b}
                onChange={(e) =>
                  setHazards((p) =>
                    p.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)),
                  )
                }
                placeholder="안전대책"
                className="field"
              />
            </li>
          ))}
        </ul>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          저장되었습니다. 내일 TBM부터 반영됩니다.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? "저장 중…" : "템플릿 저장"}
      </button>
    </form>
  );
}
