"use client";

import { useActionState, useState } from "react";
import {
  approveTbmAction,
  rejectTbmAction,
  submitTbmAction,
  type ActionResult,
} from "@/actions/tbm";

const IDLE: ActionResult = { error: null };

export function SubmitPanel({
  tbmId,
  rejected,
}: {
  tbmId: string;
  rejected: boolean;
}) {
  const [state, action, pending] = useActionState(submitTbmAction, IDLE);

  return (
    <div className="card">
      <h2 className="font-bold text-slate-900">결재 상신</h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        {rejected
          ? "반려된 내용을 수정한 뒤 다시 상신하세요."
          : "사진과 출석이 모두 기록되었는지 확인한 뒤 상신하세요."}
      </p>

      {state.error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="tbmId" value={tbmId} />
        <button type="submit" disabled={pending} className="btn-primary w-full py-3">
          {pending ? "상신 중…" : "결재 상신"}
        </button>
      </form>
    </div>
  );
}

export function ApprovePanel({ tbmId }: { tbmId: string }) {
  const [approveState, approve, approving] = useActionState(approveTbmAction, IDLE);
  const [rejectState, reject, rejecting] = useActionState(rejectTbmAction, IDLE);
  const [showReject, setShowReject] = useState(false);

  const error = approveState.error ?? rejectState.error;

  return (
    <div className="card">
      <h2 className="font-bold text-slate-900">결재</h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        내용과 증빙 사진을 확인한 뒤 승인하거나 반려하세요.
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {!showReject ? (
        <div className="flex gap-2">
          <form action={approve} className="flex-1">
            <input type="hidden" name="tbmId" value={tbmId} />
            <button
              type="submit"
              disabled={approving}
              className="btn w-full bg-emerald-600 py-3 text-white hover:bg-emerald-500"
            >
              {approving ? "처리 중…" : "승인"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            className="btn-secondary flex-1 py-3"
          >
            반려
          </button>
        </div>
      ) : (
        <form action={reject} className="space-y-3">
          <input type="hidden" name="tbmId" value={tbmId} />
          <div>
            <label className="label" htmlFor="rejectReason">
              반려 사유
            </label>
            <textarea
              id="rejectReason"
              name="rejectReason"
              rows={3}
              required
              className="field resize-y"
              placeholder="어느 부분을 어떻게 보완해야 하는지 구체적으로 적어 주세요."
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={rejecting} className="btn-danger flex-1 py-3">
              {rejecting ? "처리 중…" : "반려하기"}
            </button>
            <button
              type="button"
              onClick={() => setShowReject(false)}
              className="btn-secondary flex-1 py-3"
            >
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
