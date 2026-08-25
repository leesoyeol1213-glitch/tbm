"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import {
  assignPlantsAction,
  changeUserRoleAction,
  createUserAction,
  resetPasswordAction,
  type ActionResult,
} from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export type SiteOption = { id: string; name: string };
export type DivisionOption = { id: string; name: string };

/** 소속 법인이 없는 자리. 법인이 아니라 그 위를 맡는다. */
const NO_SITE_ROLES: Role[] = ["HQ_ADMIN", "SAFETY_DIRECTOR", "DIVISION_HEAD"];

/** 사업부를 맡는 자리. 법인 대신 사업부에 배속된다. */
const DIVISION_ROLES: Role[] = ["SAFETY_DIRECTOR", "DIVISION_HEAD"];

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
  divisions,
  canPickRole,
  defaultSiteId,
}: {
  sites: SiteOption[];
  divisions: DivisionOption[];
  canPickRole: boolean;
  defaultSiteId: string;
}) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => createUserAction(fd),
    IDLE,
  );
  const [role, setRole] = useState<Role>("TEAM_LEAD");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  // 아이디를 직접 고친 뒤에는 이름을 바꿔도 따라가지 않는다.
  const [idTouched, setIdTouched] = useState(false);
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
          <input
            id="u-name"
            name="name"
            placeholder="예: 김안전"
            className="field"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // 아이디를 아직 손대지 않았으면 이름을 그대로 따라간다.
              if (!idTouched) setUsername(e.target.value.replace(/\s+/g, ""));
            }}
            required
          />
          <p className="mt-1 text-xs text-slate-500">결재 문서에 찍히는 이름입니다.</p>
        </div>
        <div>
          <label className="label" htmlFor="u-username">
            아이디 (로그인용)
          </label>
          <input
            id="u-username"
            name="username"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="예: 김안전"
            className="field"
            value={username}
            onChange={(e) => {
              setIdTouched(true);
              setUsername(e.target.value);
            }}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            같은 이름이 있으면 뒤에 구분을 붙이세요 (예: 김안전.진천).
          </p>
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
                <option value="SAFETY_DIRECTOR">
                  안전실장 — 전 사업장 조회·순찰일지 1차 결재
                </option>
                <option value="DIVISION_HEAD">
                  본부장 — 전 사업장 조회·순찰일지 최종 결재
                </option>
                <option value="HQ_ADMIN">본사 관리자 — 전 사업장 조회</option>
              </>
            )}
          </select>
          {!canPickRole && (
            <input type="hidden" name="role" value="TEAM_LEAD" />
          )}
        </div>

        {DIVISION_ROLES.includes(role) ? (
          <div>
            <label className="label" htmlFor="u-division">
              소속 사업부
            </label>
            <select id="u-division" name="divisionId" className="field">
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              법인이 아니라 사업부를 맡습니다. 그 사업부의 사업장·공장을 모두 봅니다.
            </p>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="u-site">
              소속 사업장
            </label>
            <select
              id="u-site"
              name="siteId"
              defaultValue={defaultSiteId}
              className="field"
              disabled={NO_SITE_ROLES.includes(role)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {NO_SITE_ROLES.includes(role) && (
              <p className="mt-1 text-xs text-slate-500">
                본사 계정은 소속이 없습니다.
              </p>
            )}
          </div>
        )}
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

/**
 * 역할 변경. 본사만 쓴다.
 *
 * 사람이 자리를 옮기는 일은 실제로 생긴다. 지우고 다시 만들면 그 사람이 지금까지
 * 작성·결재한 기록의 연결이 끊기므로, 계정은 그대로 두고 역할만 옮긴다.
 */
export function ChangeRole({
  userId,
  currentRole,
  currentSiteId,
  sites,
}: {
  userId: string;
  currentRole: Role;
  currentSiteId: string | null;
  sites: SiteOption[];
}) {
  const [state, action, pending] = useActionState(changeUserRoleAction, IDLE);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(currentRole);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setRole(currentRole);
          setOpen(true);
        }}
        className="text-xs font-semibold text-slate-500 hover:underline"
      >
        역할 변경
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 w-full rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <input type="hidden" name="userId" value={userId} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`role-${userId}`}>
            역할
          </label>
          <select
            id={`role-${userId}`}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="field"
          >
            <option value="TEAM_LEAD">작업팀장</option>
            <option value="SITE_MANAGER">안전관리자</option>
            <option value="CEO">법인 대표</option>
            <option value="SAFETY_DIRECTOR">안전실장</option>
            <option value="DIVISION_HEAD">본부장</option>
            <option value="HQ_ADMIN">본사 관리자</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`site-${userId}`}>
            소속 사업장
          </label>
          <select
            id={`site-${userId}`}
            name="siteId"
            defaultValue={currentSiteId ?? ""}
            className="field"
            disabled={NO_SITE_ROLES.includes(role)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {NO_SITE_ROLES.includes(role) && (
            <p className="mt-1 text-xs text-slate-500">
              회사 전체를 보는 자리라 소속이 없습니다.
            </p>
          )}
        </div>
      </div>

      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      {state.ok && !state.error && (
        <p className="mt-2 text-sm font-medium text-emerald-700">역할을 바꿨습니다.</p>
      )}

      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={pending} className="btn-secondary flex-1 py-1.5 text-sm">
          {pending ? "바꾸는 중…" : "변경"}
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

export type PlantOption = { id: string; name: string; managerId: string | null };

/**
 * 담당 공장 지정. 본사만 쓴다.
 *
 * 순찰일지를 쓸 수 있는지가 이 지정 하나로 갈린다. 사람 기준으로 보고 고칠 자리가
 * 없으면 "이 사람이 왜 못 쓰지"를 계정 화면에서 알 길이 없다.
 */
export function AssignPlants({
  userId,
  userName,
  plants,
}: {
  userId: string;
  userName: string;
  plants: PlantOption[];
}) {
  const [state, action, pending] = useActionState(assignPlantsAction, IDLE);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(
    plants.filter((p) => p.managerId === userId).map((p) => p.id),
  );

  const mine = plants.filter((p) => p.managerId === userId);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setPicked(mine.map((p) => p.id));
          setOpen(true);
        }}
        className="text-xs font-semibold text-slate-500 hover:underline"
      >
        담당 공장 {mine.length > 0 ? `(${mine.length})` : "지정"}
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-2 w-full rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200"
    >
      <input type="hidden" name="userId" value={userId} />

      <p className="text-sm font-bold text-slate-900">
        {userName} 님이 순찰일지를 쓸 공장
      </p>
      <p className="mt-1 mb-2 text-xs text-slate-500">
        고른 공장의 순찰일지를 쓸 수 있습니다. 공장 하나에 담당자는 한 명이라, 다른
        사람이 맡고 있던 공장을 고르면 담당이 넘어옵니다.
      </p>

      {plants.length === 0 ? (
        <p className="text-sm text-slate-500">
          등록된 공장이 없습니다. 관리 → 공장에서 먼저 만들어 주세요.
        </p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-auto">
          {plants.map((p) => {
            const other = p.managerId && p.managerId !== userId;
            return (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white">
                  <input
                    type="checkbox"
                    name="plantIds"
                    value={p.id}
                    checked={picked.includes(p.id)}
                    onChange={() =>
                      setPicked((prev) =>
                        prev.includes(p.id)
                          ? prev.filter((x) => x !== p.id)
                          : [...prev, p.id],
                      )
                    }
                    className="size-4 shrink-0 rounded border-slate-300 accent-slate-900"
                  />
                  <span className="min-w-0 text-sm text-slate-800">
                    {p.name}
                    {other && (
                      <span className="ml-1 text-xs text-amber-700">
                        (다른 사람이 담당 중)
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      {state.ok && !state.error && (
        <p className="mt-2 text-sm font-medium text-emerald-700">지정했습니다.</p>
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
