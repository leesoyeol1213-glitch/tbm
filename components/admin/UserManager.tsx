"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import {
  createUserAction,
  resetPasswordAction,
  type ActionResult,
} from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export type SiteOption = { id: string; name: string };

function randomPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return out + "!";
}

export function NewUserForm({
  sites,
  canPickRole,
  defaultSiteId,
}: {
  sites: SiteOption[];
  canPickRole: boolean;
  defaultSiteId: string;
}) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => createUserAction(fd),
    IDLE,
  );
  const [role, setRole] = useState<Role>("TEAM_LEAD");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState(0);

  if (state.ok && !state.error && key === 0) setKey(1);

  return (
    <form key={key} action={action} className="card space-y-3">
      <div>
        <h2 className="font-bold text-slate-900">새 계정 만들기</h2>
        <p className="mt-1 text-xs text-slate-500">
          안전관리자·팀장이 TBM을 쓰고, 그 법인의 대표가 승인합니다.
          법인마다 대표 계정이 하나씩 있어야 결재가 됩니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="u-name">
            이름
          </label>
          <input id="u-name" name="name" placeholder="예: 김안전" className="field" required />
        </div>
        <div>
          <label className="label" htmlFor="u-email">
            이메일 (로그인 ID)
          </label>
          <input
            id="u-email"
            name="email"
            type="email"
            placeholder="name@company.com"
            className="field"
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="u-role">
            역할
          </label>
          <select
            id="u-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="field"
            disabled={!canPickRole}
          >
            <option value="TEAM_LEAD">작업팀장 — 담당 팀 TBM 작성</option>
            {canPickRole && (
              <>
                <option value="SITE_MANAGER">안전관리자 — TBM 작성·현장 관리</option>
                <option value="CEO">법인 대표 — 이 법인의 TBM 승인</option>
                <option value="HQ_ADMIN">본사 관리자 — 전 사업장 조회</option>
              </>
            )}
          </select>
          {!canPickRole && (
            <input type="hidden" name="role" value="TEAM_LEAD" />
          )}
        </div>

        <div>
          <label className="label" htmlFor="u-site">
            소속 사업장
          </label>
          <select
            id="u-site"
            name="siteId"
            defaultValue={defaultSiteId}
            className="field"
            disabled={role === "HQ_ADMIN"}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {role === "HQ_ADMIN" && (
            <p className="mt-1 text-xs text-slate-500">본사 계정은 소속이 없습니다.</p>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="u-password">
          초기 비밀번호
        </label>
        <div className="flex gap-2">
          <input
            id="u-password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            className="field flex-1 font-mono"
            placeholder="8자 이상"
            required
          />
          <button
            type="button"
            onClick={() => setPassword(randomPassword())}
            className="btn-secondary shrink-0"
          >
            자동 생성
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          이 화면을 벗어나면 다시 볼 수 없습니다. 본인에게 전달한 뒤 바꾸도록 안내하세요.
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          계정을 만들었습니다.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "만드는 중…" : "계정 만들기"}
      </button>
    </form>
  );
}

export function ResetPassword({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => resetPasswordAction(fd),
    IDLE,
  );
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setPassword(randomPassword());
          setOpen(true);
        }}
        className="text-xs font-semibold text-slate-500 hover:underline"
      >
        비밀번호 재설정
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <input type="hidden" name="userId" value={userId} />
      <label className="label" htmlFor={`pw-${userId}`}>
        새 비밀번호
      </label>
      <input
        id={`pw-${userId}`}
        name="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        className="field font-mono"
        required
      />
      {state.error && <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>}
      {state.ok && !state.error && (
        <p className="mt-2 text-sm font-medium text-emerald-700">
          변경했습니다. 위 비밀번호를 본인에게 전달하세요.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={pending} className="btn-secondary flex-1 py-1.5 text-sm">
          {pending ? "변경 중…" : "변경"}
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
