"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/actions";

export function AuthForm({
  action,
  mode,
  nextPath,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  mode: "login" | "register";
  nextPath: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const register = mode === "register";

  return (
    <form action={formAction} className="auth-form">
      <input type="hidden" name="next" value={nextPath} />
      <label>
        用户名
        <input name="username" autoComplete="username" required minLength={2} maxLength={20} />
      </label>
      <label>
        密码
        <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={6} />
      </label>
      {register ? (
        <label>
          再输入一次密码
          <input name="confirm" type="password" autoComplete="new-password" required minLength={6} />
        </label>
      ) : null}
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button className="button solid" type="submit" disabled={pending}>
        {pending ? "提交中…" : register ? "注册并进入" : "登录"}
      </button>
    </form>
  );
}
