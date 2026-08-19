import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        try {
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user || !user.active) return null;

          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            siteId: user.siteId,
          };
        } catch (e) {
          // DB에 못 붙으면 그냥 500이 나서 원인을 알 수 없다.
          // 배포 환경에서 바로 알아볼 수 있도록 종류를 남긴다.
          const err = e as { name?: string; code?: string; message?: string };
          console.error(
            `[auth] 로그인 처리 중 오류: ${err.name ?? "Error"}` +
              (err.code ? ` (code ${err.code})` : "") +
              ` — ${(err.message ?? "").split("\n")[0]}`,
          );
          // null을 돌려주면 "비밀번호 틀림"으로 보여 원인을 감춘다. 그대로 올린다.
          throw e;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      // authorize()가 돌려준 값만 로그인 직후 한 번 들어온다.
      if (user) {
        const u = user as { role: Role; siteId: string | null };
        token.role = u.role;
        token.siteId = u.siteId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role;
        session.user.siteId = token.siteId;
      }
      return session;
    },
  },
});
