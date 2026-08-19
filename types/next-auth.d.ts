import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    siteId: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      siteId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    siteId: string | null;
  }
}

// next-auth v5는 콜백에서 @auth/core의 JWT 타입을 그대로 노출한다.
declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
    siteId: string | null;
  }
}
