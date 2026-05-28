import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchPois, predictRoute, fmtMinutes } from './tmap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const hasKey = !!(process.env.TMAP_APP_KEY && !process.env.TMAP_APP_KEY.includes('여기에'));

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
// body: { start, dest, keyword, time, predictionType, maxCandidates }
//
// 전략: 출발지·도착지 양쪽에서 넓게 POI 를 수집하고(=도착지 옆/출발지 옆도 누락 없이 잡힘),
// "직선 우회거리"(|S→P|+|P→D|-|S→D|)로 싸게 정렬한 뒤
// 상위 N개에만 비싼 예측 API 를 돌린다.
app.post(
  '/api/min-waypoint',
  wrap(async (req, res) => {
    const { start, dest, keyword, time, predictionType = 'departure', maxCandidates = 5 } = req.body;
    if (!start || !dest || !keyword) {
      return res.status(400).json({ error: 'start, dest, keyword 가 필요합니다.' });
    }

    // 1) 양쪽에서 넓게 검색 (TMAP radius 는 km, 1~33)
    const directM = haversine(start, dest);
    const radius = Math.min(33, Math.max(5, Math.round(directM / 2000 + 3))); // 경로 절반 + 여유
    const [nearStart, nearDest] = await Promise.all([
      searchPois({ keyword, centerLon: start.lon, centerLat: start.lat, radius, count: 20 }),
      searchPois({ keyword, centerLon: dest.lon, centerLat: dest.lat, radius, count: 20 }),
    ]);

    // 2) 중복 제거 + 직선 우회거리 계산
    const seen = new Set();
    const pool = [];
    for (const p of [...nearStart, ...nearDest]) {
      const k = `${p.name}|${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const detour = haversine(start, p) + haversine(p, dest) - directM;
      pool.push({ ...p, detourM: Math.round(detour) });
    }
    if (!pool.length) return res.json({ results: [], best: null, poolSize: 0 });

    // 3) 직선 우회거리 작은 순 상위 N개만 진짜 예측
    pool.sort((a, b) => a.detourM - b.detourM);
    const candidates = pool.slice(0, maxCandidates);

    // 베이스라인(경유 없음) 1회 계산 — "이만큼 더 걸린다"를 보여주기 위함
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
    res.json({
      poolSize: pool.length,
      searchRadiusKm: radius,
      baseline,
      results: results.map((r) => ({
        ...r,
        timeText: fmtMinutes(r.totalTime),
        extraText: r.extraSeconds != null ? `+${fmtMinutes(r.extraSeconds)}` : null,
      })),
      best: best ? { ...best, timeText: fmtMinutes(best.totalTime) } : null,
    });
  }),
);

// ── 메뉴 2: 멀티 경유지 순서 최적화 ────────────────────────────────
// body: { start, dest, waypoints:[...], time, predictionType }
// 경유지 순서 모든 조합(브루트포스, 최대 5개=120조합)을 예측해 최소 시간 순서를 찾는다.
app.post(
  '/api/optimize-waypoints',
  wrap(async (req, res) => {
    const { start, dest, waypoints = [], time, predictionType = 'departure' } = req.body;
    if (!start || !dest || waypoints.length < 1) {
      return res.status(400).json({ error: 'start, dest, 그리고 1개 이상의 waypoints 가 필요합니다.' });
    }
    if (waypoints.length > 5) {
      return res.status(400).json({ error: '경유지는 최대 5개까지 지원합니다.' });
    }

    const orders = permutations(waypoints);
    const results = [];
    for (const order of orders) {
      try {
        const r = await predictRoute({ start, dest, waypoints: order, time, predictionType });
        results.push({ order, totalTime: r.totalTime, totalDistance: r.totalDistance, path: r.path });
      } catch (e) {
        results.push({ order, error: e.message });
      }
    }
    // 짧은 시간 순으로 정렬
    results.sort((a, b) => (a.totalTime ?? Infinity) - (b.totalTime ?? Infinity));
    const best = results.find((r) => !r.error && r.totalTime != null) || null;
    res.json({
      best: best ? { ...best, timeText: fmtMinutes(best.totalTime) } : null,
      results: results.map((r) => ({ ...r, timeText: fmtMinutes(r.totalTime) })),
      combinations: orders.length,
    });
  }),
);

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((item, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

// index.html 은 직접 다뤄 TMAP appKey 를 SDK 스크립트 태그로 주입한다.
// (TMAP SDK 는 HTML 파싱 단계의 document.write 로 실제 SDK 를 가져오기 때문에
//  동적으로 <script> 를 붙이면 SDK 가 끝까지 로드되지 않는다.)
const INDEX_PATH = path.join(__dirname, '..', 'public', 'index.html');
async function serveIndex(_req, res) {
  try {
    const html = await fs.readFile(INDEX_PATH, 'utf-8');
    res.type('html').send(html.replaceAll('__TMAP_KEY__', hasKey ? process.env.TMAP_APP_KEY : ''));
  } catch (e) {
    res.status(500).send(e.message);
  }
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

// 정적 프론트 서빙 (그 외 파일)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Smart Navigation 서버 실행: http://localhost:${PORT}`);
  if (!hasKey) {
    console.log('  ⚠️  TMAP_APP_KEY 미설정 — .env 파일에 키를 넣어야 호출이 동작합니다.\n');
  } else {
    console.log('  ✅ TMAP_APP_KEY 감지됨\n');
  }
});
