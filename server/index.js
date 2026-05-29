import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchPois, predictRoute, optimizeRoute, fmtMinutes } from './tmap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const hasKey = !!(process.env.TMAP_APP_KEY && !process.env.TMAP_APP_KEY.includes('여기에'));

// 정적 자산 캐시버스터: 서버가 부팅할 때마다 새 값.
// iOS Safari 가 옛 JS/CSS 를 끌어안고 안 놓는 문제 차단용.
const ASSET_VER = String(Date.now());

// 비동기 라우트 에러를 한 곳에서 처리하기 위한 래퍼
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(502).json({ error: err.message });
  });

// 프론트가 지도 SDK 로드에 쓸 키와 키 설정 여부를 알려준다.
// (지도 SDK 는 클라이언트에서 appKey 가 필요하므로 이 값은 노출된다 — 프로토타입 한정)
app.get('/api/config', (_req, res) => {
  res.json({ hasKey, mapKey: process.env.TMAP_APP_KEY || '' });
});

// 장소 자동완성/검색
app.get(
  '/api/pois',
  wrap(async (req, res) => {
    const { keyword, centerLon, centerLat, radius } = req.query;
    if (!keyword) return res.json({ pois: [] });
    const pois = await searchPois({ keyword, centerLon, centerLat, radius: Number(radius) || 0 });
    res.json({ pois });
  }),
);

// 단일 경로 예측 (시작/도착/경유지 + 시간)
app.post(
  '/api/route',
  wrap(async (req, res) => {
    const r = await predictRoute(req.body);
    res.json({ ...r, timeText: fmtMinutes(r.totalTime) });
  }),
);

// 두 좌표 사이 직선거리(미터). 후보를 prediction 호출 전에 싸게 선별하기 위해 사용.
function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const dLat = lat2 - lat1;
  const dLon = toRad(Number(b.lon) - Number(a.lon));
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── 메뉴 1: 최소 경유지 찾기 ───────────────────────────────────────
// body: { start, dest, keyword, time, predictionType, maxCandidates, anchor }
//   anchor: 'start' (출발지 중심) | 'dest' (도착지 중심).  기본 'start'.
//
// 전략: 사용자가 고른 anchor 한쪽에서만 검색하되 반경을 단계적으로 늘림.
//   Tier 1 — 선택한 anchor, 반경 = D × 20%
//   Tier 2 — 같은 anchor, 반경 = D × 40%
//   Tier 3 — 반대편 anchor, 반경 = D × 60% (응답에 안내문 첨부)
// 각 tier 에서 결과가 나오는 즉시 그 단계로 확정. 후보는 "직선 우회거리"로
// 미리 정렬해 상위 maxCandidates 개만 진짜 예측 API 를 돌린다.
app.post(
  '/api/min-waypoint',
  wrap(async (req, res) => {
    const {
      start, dest, keyword, time,
      predictionType = 'departure',
      maxCandidates = 5,
      anchor = 'start',
    } = req.body;
    if (!start || !dest || !keyword) {
      return res.status(400).json({ error: 'start, dest, keyword 가 필요합니다.' });
    }

    const anchorPole = anchor === 'dest' ? 'dest' : 'start';
    const oppositePole = anchorPole === 'start' ? 'dest' : 'start';
    const directM = haversine(start, dest);
    const directKm = directM / 1000;

    // 반경(km)을 TMAP 한도 [1, 33] 으로 클램프. 정수 km 만 허용되므로 반드시 반올림.
    const clampKm = (km) => Math.min(33, Math.max(1, Math.round(km)));

    // 단계 정의
    const tiers = [
      { tier: 1, pole: anchorPole,   pct: 0.2 },
      { tier: 2, pole: anchorPole,   pct: 0.4 },
      { tier: 3, pole: oppositePole, pct: 0.6 },
    ];

    // 단계적으로 첫 결과가 나올 때까지 시도
    let chosen = null;
    let pois = [];
    let radius = 0;
    for (const t of tiers) {
      radius = clampKm(directKm * t.pct);
      const center = t.pole === 'start' ? start : dest;
      const found = await searchPois({
        keyword,
        centerLon: center.lon,
        centerLat: center.lat,
        radius,
        count: 20,
      });
      if (found.length) {
        chosen = t;
        pois = found;
        break;
      }
    }

    if (!chosen) {
      return res.json({
        results: [],
        best: null,
        poolSize: 0,
        anchor: anchorPole,
        tier: 0,
        note: '어느 반경으로 늘려도 후보를 찾지 못했어요. 키워드를 바꿔보세요.',
      });
    }

    // 후보 풀: 직선 우회거리(|S→P|+|P→D|-|S→D|) 작은 순으로 사전 정렬해 상위만 진짜 예측
    const seen = new Set();
    const pool = [];
    for (const p of pois) {
      const k = `${p.name}|${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const detour = haversine(start, p) + haversine(p, dest) - directM;
      pool.push({ ...p, detourM: Math.round(detour) });
    }
    pool.sort((a, b) => a.detourM - b.detourM);
    const candidates = pool.slice(0, maxCandidates);

    // 베이스라인(경유 없음) — "이만큼 더 걸린다" 비교용
    let baseline = null;
    try {
      const b = await predictRoute({ start, dest, waypoints: [], time, predictionType });
      baseline = { totalTime: b.totalTime, totalDistance: b.totalDistance, path: b.path, timeText: fmtMinutes(b.totalTime) };
    } catch (e) {
      baseline = { error: e.message };
    }

    const results = [];
    for (const c of candidates) {
      try {
        const r = await predictRoute({ start, dest, waypoints: [c], time, predictionType });
        const extra = baseline?.totalTime != null && r.totalTime != null ? r.totalTime - baseline.totalTime : null;
        results.push({
          poi: c,
          totalTime: r.totalTime,
          totalDistance: r.totalDistance,
          path: r.path,
          extraSeconds: extra,
        });
      } catch (e) {
        results.push({ poi: c, error: e.message });
      }
    }
    results.sort((a, b) => (a.totalTime ?? Infinity) - (b.totalTime ?? Infinity));
    const best = results.find((r) => r.totalTime != null) || null;

    // Tier 3 (반대편 폴백) 일 때만 안내문을 만들어 함께 내려준다.
    // 예: anchor=start, 결과 없음 → dest 60% 에서 찾음
    //     "출발지 부근에는 없어요. 가장 가까운 경유 경로는 '스타벅스 대전역점' 입니다."
    let note = null;
    if (chosen.tier === 3 && best && best.poi) {
      const anchorLabel = anchorPole === 'start' ? '출발지' : '도착지';
      const oppLabel = oppositePole === 'start' ? '출발지' : '도착지';
      note = `${anchorLabel} 부근에는 없어요. ${oppLabel} 부근에서 가장 가까운 경유 경로는 '${best.poi.name}' 입니다.`;
    }

    res.json({
      poolSize: pool.length,
      searchRadiusKm: radius,
      anchor: anchorPole,
      tier: chosen.tier,
      note,
      baseline,
      // extraSeconds 부호 처리는 프론트가 함 (음수일 수도 있음).
      results: results.map((r) => ({ ...r, timeText: fmtMinutes(r.totalTime) })),
      best: best ? { ...best, timeText: fmtMinutes(best.totalTime) } : null,
    });
  }),
);

// ── 메뉴 2: 멀티 경유지 순서 최적화 ────────────────────────────────
// body: { start, dest, waypoints:[...], time, predictionType }
// TMAP routes/routeOptimization10 을 1회 호출해 TMAP 가 직접 계산한 최적 순서를 받는다.
// (이전: 5! = 120회 브루트포스 → 현재: 1회 호출)
app.post(
  '/api/optimize-waypoints',
  wrap(async (req, res) => {
    const { start, dest, waypoints = [], time } = req.body;
    if (!start || !dest || waypoints.length < 1) {
      return res.status(400).json({ error: 'start, dest, 그리고 1개 이상의 waypoints 가 필요합니다.' });
    }
    if (waypoints.length > 10) {
      return res.status(400).json({ error: '경유지는 최대 10개까지 지원합니다.' });
    }

    const opt = await optimizeRoute({ start, dest, waypoints, time });
    const result = {
      order: opt.order,
      totalTime: opt.totalTime,
      totalDistance: opt.totalDistance,
      path: opt.path,
      timeText: fmtMinutes(opt.totalTime),
    };
    // 프론트가 results[] 와 best 를 같이 읽으므로 동일 객체로 채워 호환 유지.
    // combinations 는 표시용으로만 의미가 있는데, 최적화 1회 호출이므로 1.
    res.json({ best: result, results: [result], combinations: 1 });
  }),
);

// index.html 은 직접 다뤄 TMAP appKey 를 SDK 스크립트 태그로 주입한다.
// (TMAP SDK 는 HTML 파싱 단계의 document.write 로 실제 SDK 를 가져오기 때문에
//  동적으로 <script> 를 붙이면 SDK 가 끝까지 로드되지 않는다.)
const INDEX_PATH = path.join(__dirname, '..', 'public', 'index.html');
async function serveIndex(_req, res) {
  try {
    const html = await fs.readFile(INDEX_PATH, 'utf-8');
    res
      // 페이지 자체는 절대 캐시하지 않는다 — 안에 박힌 자산 버전이 새로 와야 하므로.
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        html
          .replaceAll('__TMAP_KEY__', hasKey ? process.env.TMAP_APP_KEY : '')
          .replaceAll('__ASSET_VER__', ASSET_VER),
      );
  } catch (e) {
    res.status(500).send(e.message);
  }
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

// 정적 프론트 서빙 (그 외 파일).
// JS/CSS 는 항상 재검증하도록 강제 (?v= 쿼리로 cache-busting 도 같이 걸려있음).
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (/\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Smart Navigation 서버 실행: http://localhost:${PORT}`);
  if (!hasKey) {
    console.log('  ⚠️  TMAP_APP_KEY 미설정 — .env 파일에 키를 넣어야 호출이 동작합니다.\n');
  } else {
    console.log('  ✅ TMAP_APP_KEY 감지됨\n');
  }
});
