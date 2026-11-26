# manage-bot 푸시·풀 기록

| 날짜 | 작업 | 브랜치 | 커밋 | 내용 | 배포 |
|---|---|---|---|---|---|
| 2026-11-24 | push | claude/slack-session-2xbykq | c3bc844 | 채널 진행 보고("2번 완결")로 보드 상태 변경, 중복 재추출 방지, @멘션 즉시 반영(/api/slack/events) | Vercel 자동 배포(manage-bot-tb2j). @멘션은 SLACK_SIGNING_SECRET·Event Subscriptions 설정 후 동작 |
| 2026-11-26 | push | claude/slack-session-2xbykq | 3328182 | 기한 지난 항목(기한+3일)·중복 항목 아침 자동 정리, 각주에 정리 건수, 인용 번호 삭제 요청을 archive로 처리 | Vercel 자동 배포(manage-bot-tb2j), 다음 아침 보드부터 적용 |
