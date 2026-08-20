"use client";

import { useActionState, useState } from "react";
import { saveTeamAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export type LeaderOption = { id: string; name: string; username: string };

export default function TeamForm({
  siteId,
  leaders,
  team,
  mode,
}: {
  siteId: string;
  leaders: LeaderOption[];
  team?: { id: string; name: string; company: string; leaderId: string };
  mode: "create" | "edit";
}) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => saveTeamAction(fd),
    IDLE,
  );
  const [key, setKey] = useState(0);

  const isCreate = mode === "create";
  if (isCreate && state.ok && !state.error && key === 0) setKey(1);

  return (
    <form key={key} action={action} className={isCreate ? "card space-y-3" : "space-y-2"}>
      <input type="hidden" name="siteId" value={siteId} />
      {team?.id && <input type="hidden" name="teamId" value={team.id} />}

      {isCreate && <h2 className="font-bold text-slate-900">새 작업팀</h2>}

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          name="name"
          defaultValue={team?.name ?? ""}
          placeholder="팀 이름 (예: 조립1반)"
          className="field"
          required
        />
        <input
          name="company"
          defaultValue={team?.company ?? ""}
          placeholder="협력업체 (선택)"
          className="field"
        />
        <select name="leaderId" defaultValue={team?.leaderId ?? ""} className="field">
          <option value="">팀장 미지정</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.username})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={isCreate ? "btn-primary" : "btn-secondary py-1.5 text-sm"}
        >
          {pending ? "저장 중…" : isCreate ? "팀 만들기" : "저장"}
        </button>
        {state.error && (
          <span className="text-sm font-medium text-rose-700">{state.error}</span>
        )}
        {state.ok && !state.error && (
          <span className="text-sm font-medium text-emerald-700">저장됨</span>
        )}
      </div>
    </form>
  );
}
