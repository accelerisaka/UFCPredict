"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page narrow">
      <section className="intro">
        <p className="eyebrow">出错了</p>
        <h1>这一页没有加载完。</h1>
        <p className="lede">{error.message}</p>
        <button className="button solid" type="button" onClick={reset}>
          再试一次
        </button>
      </section>
    </div>
  );
}
