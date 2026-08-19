"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

export async function loginAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    // redirect: false 로 두고 이동은 아래에서 직접 한다.
    //
    // redirectTo를 넘기면 Auth.js가 콜백 주소로 303을 걸고 브라우저가 GET으로
    // 따라가는데, credentials 콜백은 GET을 받지 않아 500이 난다. 프록시 뒤(Vercel)
    // 에서 특히 잘 재현된다. 직접 이동시키면 이 경로 자체가 사라진다.
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    }
    throw error;
  }

  // redirect()는 NEXT_REDIRECT를 던지므로 반드시 try 바깥에서 호출한다.
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
