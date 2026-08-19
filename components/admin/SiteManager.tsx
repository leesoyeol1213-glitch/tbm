"use client";

import { useActionState, useState } from "react";
import { createSiteAction, deleteSiteAction, type ActionResult } from "@/actions/admin";
import AddressFields from "@/components/admin/AddressFields";

const IDLE: ActionResult = { error: null };

export type SiteSummary = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  hasCoords: boolean;
  teams: number;
  workers: number;
  tbms: number;
};

export function NewSiteForm() {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => createSiteAction(fd),
    IDLE,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        + 사업장 추가
      </button>
    );
  }

  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-bold text-slate-900">새 사업장</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="code">
            사업장 코드
          </label>
          <input
            id="code"
            name="code"
            placeholder="예: F01"
            className="field uppercase"
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            영문 대문자·숫자·하이픈. 나중에 바꿀 수 없습니다.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="name">
            사업장 이름
          </label>
          <input id="name" name="name" placeholder="예: 화성공장" className="field" required />
        </div>
      </div>

      <AddressFields />

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary flex-1">
          {pending ? "만드는 중…" : "사업장 만들기"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">
          취소
        </button>
      </div>
    </form>
  );
}

export function DeleteSite({ site }: { site: SiteSummary }) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => deleteSiteAction(fd),
    IDLE,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-rose-600 hover:underline"
      >
        사업장 삭제
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
      <input type="hidden" name="siteId" value={site.id} />
      <p className="text-sm font-bold text-rose-900">정말 삭제하시겠습니까?</p>
      <p className="mt-1 text-sm text-rose-800">
        팀 {site.teams}개, 작업자 {site.workers}명, TBM 기록 {site.tbms}건, 소속 계정과
        출석 QR이 <strong>모두 함께 사라집니다.</strong> 되돌릴 수 없습니다.
      </p>

      <label className="label mt-3" htmlFor={`confirm-${site.id}`}>
        확인을 위해 <strong>{site.name}</strong> 을 입력하세요
      </label>
      <input
        id={`confirm-${site.id}`}
        name="confirmName"
        className="field"
        autoComplete="off"
        required
      />

      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-800">{state.error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-danger flex-1">
          {pending ? "삭제 중…" : "영구 삭제"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">
          취소
        </button>
      </div>
    </form>
  );
}
