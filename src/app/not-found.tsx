import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page narrow">
      <section className="intro">
        <p className="eyebrow">404</p>
        <h1>没有找到这场比赛或这位选手。</h1>
        <p className="lede">
          <Link href="/">回到赛程</Link>
        </p>
      </section>
    </div>
  );
}
