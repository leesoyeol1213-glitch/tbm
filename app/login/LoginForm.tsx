"use client";

import { useActionState } from "react";
import { loginAction } from "@/actions/auth";

export default function LoginForm() {
  const [error, formAction, pending] = useActionState<string | null, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={formAction} className="card space-y-4">
      <div>
        <label className="label" htmlFor="username">
          아이디
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="field"
          placeholder="관리자에게 받은 아이디"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
