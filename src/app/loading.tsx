export default function Loading() {
  return (
    <div className="page">
      <section className="intro">
        <p className="eyebrow">同步中</p>
        <h1>正在读取 UFC 官网赛程和选手资料。</h1>
        <p className="lede">第一次打开会逐场抓取已确定对阵，并匹配 Polymarket 盘口。这通常需要一两分钟。</p>
      </section>
    </div>
  );
}
