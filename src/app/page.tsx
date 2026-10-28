export default function Home() {
  return (
    <main className="container">
      <h1>Marketing PM Bot</h1>
      <p className="muted">
        마케팅 액션 아이템 보드를 하루 두 번 Slack에 발송하고, Slack 버튼과
        관리자 페이지에서 상태를 관리합니다.
      </p>
      <div className="card">
        <h2>바로가기</h2>
        <ul>
          <li>
            <a href="/admin/marketing">관리자 페이지 (/admin/marketing)</a> —
            ADMIN_TOKEN 필요
          </li>
        </ul>
      </div>
      <div className="card">
        <h2>Cron 엔드포인트</h2>
        <ul>
          <li>
            <code>GET /api/cron/marketing-morning?token=CRON_SECRET</code> — 오전
            발송 (09:00 KST)
          </li>
          <li>
            <code>GET /api/cron/marketing-evening?token=CRON_SECRET</code> — 저녁
            발송 (21:00 KST)
          </li>
        </ul>
        <p className="muted">
          설정 방법은 저장소의 <code>README.md</code> 를 참고하세요.
        </p>
      </div>
    </main>
  );
}
