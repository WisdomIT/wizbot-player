# Wizbot Player

Electron + React 플레이어로, 방송 중 시청자 신청곡을 관리하고 백그라운드에서 유튜브 영상을 재생합니다.

## 주요 기능

- **이중 윈도우 구조**: 포그라운드 UI에서 재생목록과 컨트롤을 제공하고, 백그라운드 윈도우가 숨겨진 상태로 유튜브 영상을 재생합니다.
- **실시간 재생목록 관리**: 요청 곡 목록 조회, 순서 변경, 삭제, 바로 재생을 지원합니다.
- **트레이 & 전역 단축키**: 트레이 아이콘 툴팁에 현재 재생 곡을 표시하고, `Cmd/Ctrl + Shift + (P|S|N)` 단축키로 재생/정지/다음 곡을 제어합니다.
- **wizbot:// 프로토콜 로그인**: 외부 브라우저에서 로그인한 뒤 `wizbot://` 콜백으로 전달된 토큰을 수신하여 API 호출에 사용합니다.
- **자동 API 폴링**: 인증 이후 주기적으로 리스트를 동기화하며, 로컬에 토큰을 암호화하지 않고 JSON 형태로 캐시합니다.

## 개발 환경 실행

```bash
yarn install
yarn start
```

- `yarn start` 는 React 개발 서버와 Electron을 함께 기동합니다.
- React 개발 서버는 `http://localhost:3000#/` (메인 UI)과 `#/player` (백그라운드 플레이어) 두 경로를 사용합니다.

## 환경 변수

| 변수                   | 설명                              | 기본값                                    |
| ---------------------- | --------------------------------- | ----------------------------------------- |
| `WIZBOT_API_BASE`      | 신청곡 큐를 조회할 API 엔드포인트 | `https://bot.wisdomit.co.kr/player/queue` |
| `WIZBOT_POLL_INTERVAL` | 재생목록 동기화 주기(ms)          | `10000`                                   |
| `WIZBOT_LOGIN_URL`     | 외부 로그인 페이지 URL            | `https://bot.wisdomit.co.kr/player/login` |

`.env` 혹은 시스템 환경 변수로 설정하면 Electron 메인 프로세스에서 사용됩니다. 값 변경 후에는 앱을 재시작해 반영하세요.

## 로그인 흐름

1. 포그라운드 UI에서 `외부 브라우저 로그인` 버튼을 클릭하면 기본 브라우저가 `WIZBOT_LOGIN_URL` 로 이동합니다.
2. 로그인 완료 후 서비스가 `wizbot://` 스킴으로 발급 토큰을 전달합니다. (예: `wizbot://callback?token=...&refresh_token=...`).
3. Electron 메인 프로세스가 토큰을 수신해 `~/Library/Application Support/wizbot-player/wizbot-auth.json`(플랫폼별) 위치에 저장하고, 이후 API 요청 시 자동으로 Authorization 헤더를 구성합니다.

## 재생 컨트롤

- **UI 버튼**: 재생, 일시정지/재개, 정지, 다음 곡
- **전역 단축키**:
  - `Cmd/Ctrl + Shift + P` 재생/일시정지 토글
  - `Cmd/Ctrl + Shift + S` 정지
  - `Cmd/Ctrl + Shift + N` 다음 곡
- **트레이 메뉴**: 재생/일시정지, 정지, 다음 곡, 종료

## 백그라운드 플레이어

백그라운드 창은 0x0 크기의 YouTube IFrame Player API를 사용해 오디오만 재생합니다. 메인 프로세스와 IPC로 통신하여 재생 상태를 주고받고, 곡 종료 시 자동으로 다음 곡을 요청합니다.

## 테스트 & 배포

- React 유닛 테스트: `yarn react-test`
- 프로덕션 빌드: `yarn build`
- Electron 패키징/배포: `yarn release`

> 참고: 실제 wizbot API 스키마에 맞춰 `public/electron.js` 내 `refreshPlaylist` 함수의 매핑 로직을 조정할 수 있습니다.
