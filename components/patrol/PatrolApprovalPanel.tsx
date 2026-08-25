"use client";

import { useActionState, useState } from "react";
import {
  approvePatrolAction,
  rejectPatrolAction,
  submitPatrolAction,
  type ActionResult,
} from "@/actions/patrol";

const IDLE: ActionResult = { error: null };

export function PatrolSubmitPanel({
  patrolId,
  rejected,
}: {
  patrolId: string;
  rejected: boolean;
}) {
  const [state, action, pending] = useActionState(submitPatrolAction, IDLE);

  return (
    <div className="card">
      <h2 className="font-bold text-slate-900">결재 상신</h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        {rejected
          ? "반려된 내용을 수정한 뒤 다시 상신하세요."
          : "불량 항목의 조치사항까지 채웠는지 확인한 뒤 상신하세요."}
      </p>

      {state.error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="patrolId" value={patrolId} />
        <button type="submit" disabled={pending} className="btn-primary w-full py-3">
          {pending ? "상신 중…" : "결재 상신"}
        </button>
      </form>
    </div>
  );
}

export function PatrolApprovePanel({
  patrolId,
  delegateFor,
}: {
  patrolId: string;
  /** 대결이면 대신 결재받을 법인 대표 이름. 직접 결재면 null. */
  delegateFor?: string | null;
}) {
  const [approveState, approve, approving] = useActionState(approvePatrolAction, IDLE);
  const [rejectState, reject, rejecting] = useActionState(rejectPatrolAction, IDLE);
  const [showReject, setShowReject] = useState(false);

  const error = approveState.error ?? rejectState.error;

  return (
    <div className="card">
      <h2 className="font-bold text-slate-900">결재</h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        순찰사항과 점검 결과를 확인한 뒤 승인하거나 반려하세요.
      </p>

      {delegateFor && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
          <strong>{delegateFor}</strong> 대표를 대신해 결재합니다(대결). 문서에는 대표
          명의로 남고, 실제로 결재한 사람도 함께 표시됩니다.
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {!showReject ? (
        <div className="flex gap-2">
          <form action={approve} className="flex-1">
            <input type="hidden" name="patrolId" value={patrolId} />
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
          <input type="hidden" name="patrolId" value={patrolId} />
          <div>
            <label className="label" htmlFor="patrolRejectReason">
              반려 사유
            </label>
            <textarea
              id="patrolRejectReason"
              name="reason"
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
