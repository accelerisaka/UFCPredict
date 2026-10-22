import Link from "next/link";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/auth";

export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="mark" aria-hidden="true" />
        <span>UFCPredict</span>
      </Link>
      <nav className="nav">
        <Link href="/">赛程</Link>
        <Link href="/me">我的</Link>
      </nav>
      <div className="account">
        {user ? (
          <>
            <Link href="/me" className="user-chip">
              {user.username}
            </Link>
            <form action={logoutAction}>
              <button className="text-button" type="submit">
                退出
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login">登录</Link>
            <Link href="/register" className="button solid small">
              注册
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
