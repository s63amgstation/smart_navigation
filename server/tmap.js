// TMAP Open API 호출을 한 곳에 모은 모듈.
// 요청 포맷(엔드포인트/파라미터/바디)을 여기서만 바꾸면 되도록 격리해 둠.
// 모든 호출은 서버에서만 일어나고, appKey 는 .env 의 TMAP_APP_KEY 를 사용한다.
// (브라우저에서 직접 부르면 CORS 가 막히므로 반드시 이 프록시를 거친다.)

const BASE = 'https://apis.openapi.sk.com/tmap';

function appKey() {
  const key = process.env.TMAP_APP_KEY;
  if (!key || key.includes('여기에')) {
    throw new Error('TMAP_APP_KEY 가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
  return key;
}

// TMAP 예측(타임머신) API 가 요구하는 시간 형식: yyyy-MM-ddTHH:mm:ss+0900
export function toTmapTime(isoLocal) {
  const d = isoLocal ? new Date(isoLocal) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+0900`
  );
}

// 다중경유지 API 의 시간 형식: yyyyMMddHHmm (초·타임존 없음)
export function toTmapStartTime(isoLocal) {
  const d = isoLocal ? new Date(isoLocal) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

// 본문이 비었거나 손상된 인코딩일 때 사람이 읽을 수 있는 메시지로 대체
function safeBody(text) {
  if (!text) return '(빈 응답)';
  if (text.charCodeAt(0) === 0x1f) return '(TMAP gzip 손상 본문)';
  if (text.includes('�')) return '(TMAP 본문 인코딩 손상)';
  return text.slice(0, 300);
}

// ── 역지오코딩 (좌표 → 시·구 행정구역) ──────────────────────────
// 메인화면 "현재 위치" 자리에 "서울특별시 강서구" 형태로 보이도록.
// 실패하면 null 반환 — 프론트는 표기를 그냥 숨김.
export async function reverseGeocode({ lat, lon }) {
  const params = new URLSearchParams({
    version: '1',
    lat: String(lat),
    lon: String(lon),
    coordType: 'WGS84GEO',
    addressType: 'A10', // 행정구역 우선
  });
  const res = await fetch(`${BASE}/geo/reversegeocoding?${params.toString()}`, {
    headers: { appKey: appKey(), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) return null;
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { return null; }
  const info = data?.addressInfo;
  if (!info) return null;
  // city_do = "서울특별시", gu_gun = "강서구". 둘 다 있을 때만 보여줌.
  const city = info.city_do || '';
  const gu = info.gu_gun || '';
  if (!city || !gu) return null;
  return `${city} ${gu}`;
}

// ── 경로 반경 검색 (findPoiRoute) ────────────────────────────────
// 출발→도착 경로 corridor 따라 POI 검색.
// 점 반경(searchPois with center+radius)을 두 번 호출하던 것보다 더 자연스러운
// "가는 길 위 후보" 들을 한 번에 받음.
// 응답 shape 는 POI 통합검색과 동일 가정 (searchPoiInfo.pois.poi).
export async function findPoiRoute({ keyword, start, dest, count = 20, page = 1 }) {
  const params = new URLSearchParams({
    version: '1',
    searchKeyword: keyword,
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    startX: String(start.lon),
    startY: String(start.lat),
    endX: String(dest.lon),
    endY: String(dest.lat),
    count: String(count),
    page: String(page),
  });
  const res = await fetch(`${BASE}/poi/findPoiRoute?${params.toString()}`, {
    headers: { appKey: appKey(), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`경로 POI 검색 실패 (${res.status}): ${safeBody(text)}`);
  }
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return [];
  }
  const pois = data?.searchPoiInfo?.pois?.poi ?? [];
  return pois.map((p) => {
    const lon = parseFloat(p.frontLon || p.noorLon);
    const lat = parseFloat(p.frontLat || p.noorLat);
    const addr = [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.detailAddrName]
      .filter(Boolean)
      .join(' ');
    const road = p.newAddressList?.newAddress?.[0]?.fullAddressRoad;
    return { name: p.name, lon, lat, address: road || addr };
  });
}

// ── POI 통합검색 (자동완성/장소검색) ─────────────────────────────
// keyword 로 장소를 찾는다. center(lon/lat)+radius 를 주면 그 주변을 우선한다.
export async function searchPois({ keyword, centerLon, centerLat, radius = 0, count = 12 }) {
  const params = new URLSearchParams({
    version: '1',
    searchKeyword: keyword,
    resCoordType: 'WGS84GEO',
    reqCoordType: 'WGS84GEO',
    count: String(count),
    page: '1',
  });
  if (centerLon && centerLat) {
    params.set('centerLon', String(centerLon));
    params.set('centerLat', String(centerLat));
    // TMAP radius 는 1~33 사이 "정수 km" — 소수로 보내면 400.
    // 호출자가 이미 정수로 주면 그대로, 소수가 흘러들어와도 여기서 한 번 더 굳혀준다.
    if (radius) {
      const r = Math.min(33, Math.max(1, Math.round(Number(radius))));
      params.set('radius', String(r));
    }
    params.set('searchtypCd', 'R'); // R: 중심좌표 주변 검색
  }

  const res = await fetch(`${BASE}/pois?${params.toString()}`, {
    headers: { appKey: appKey(), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POI 검색 실패 (${res.status}): ${safeBody(text)}`);
  }
  // TMAP 은 결과 0건이면 빈 본문을 주는 경우가 있어 빈 텍스트는 [] 로 취급
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return [];
  }
  const pois = data?.searchPoiInfo?.pois?.poi ?? [];
  return pois.map((p) => {
    const lon = parseFloat(p.frontLon || p.noorLon);
    const lat = parseFloat(p.frontLat || p.noorLat);
    const addr = [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.detailAddrName]
      .filter(Boolean)
      .join(' ');
    const road = p.newAddressList?.newAddress?.[0]?.fullAddressRoad;
    return { name: p.name, lon, lat, address: road || addr };
  });
}

// ── 경로 조회 디스패처 ───────────────────────────────────────────
// mode 에 따라 두 TMAP API 를 갈라 호출하지만 호출자에게 같은 shape 를 돌려준다.
//   mode='now'    → routes (실시간 교통, passList 로 경유지 네이티브 지원) — 1회 호출
//   mode='future' → routes/prediction (타임머신, 미래시각 startTime)
//
// 'future' + 경유지 의 경우 routes/prediction 자체가 경유지를 무시하므로 leg-split 우회.
export async function predictRoute({ start, dest, waypoints = [], time, mode = 'now' }) {
  if (mode === 'now') {
    return routeNow({ start, dest, waypoints });
  }
  return predictRouteLegSplit({ start, dest, waypoints, time });
}

// ── 지금(실시간) 자동차 경로안내 — TMAP routes ─────────────────────
// 한 번의 호출로 출발→경유1→...→도착 전체 경로/시간/거리를 받는다.
// passList: "lon1,lat1_lon2,lat2_..." (언더스코어 구분)
export async function routeNow({ start, dest, waypoints = [], searchOption = '0' }) {
  const body = {
    startName: start.name || '출발',
    startX: String(start.lon),
    startY: String(start.lat),
    endName: dest.name || '도착',
    endX: String(dest.lon),
    endY: String(dest.lat),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    searchOption, // 0:교통최적+추천(기본) / 1:무료우선 / 2:최소시간 / 3:초보
    carType: 0,
    sort: 'index',
  };
  if (waypoints.length) {
    body.passList = waypoints.map((w) => `${w.lon},${w.lat}`).join('_');
  }

  const res = await fetch(`${BASE}/routes?version=1`, {
    method: 'POST',
    headers: {
      appKey: appKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`경로 조회 실패 (${res.status}): ${safeBody(text)}`);
  }
  if (!text) {
    const empty = parseRoute({});
    return { ...empty, legs: [] };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('경로 조회 응답 파싱 실패 (본문이 JSON 이 아님)');
  }
  const r = parseRoute(json);
  return {
    totalTime: r.totalTime,
    totalDistance: r.totalDistance,
    totalFare: r.totalFare,
    path: r.path,
    legs: [],
  };
}

// ── 예측(타임머신) 경로 — leg-split ───────────────────────────────
// TMAP routes/prediction 이 경유지를 무시하므로 구간별로 쪼개 합산.
// 출발시각만 지원 (도착시각 모드는 제거됨).
async function predictRouteLegSplit({ start, dest, waypoints, time }) {
  const pts = [start, ...waypoints.slice(0, 5), dest];
  const legs = [];
  let curDep = time;
  for (let i = 1; i < pts.length; i++) {
    const leg = await predictLeg(pts[i - 1], pts[i], curDep, 'departure');
    legs.push(leg);
    curDep = leg.arrivalTime || curDep;
  }
  return {
    totalTime: legs.reduce((s, l) => s + (l.totalTime || 0), 0),
    totalDistance: legs.reduce((s, l) => s + (l.totalDistance || 0), 0),
    totalFare: legs.reduce((s, l) => s + (l.totalFare || 0), 0) || null,
    path: legs.flatMap((l) => l.path),
    legs: legs.map((l) => ({ totalTime: l.totalTime, totalDistance: l.totalDistance })),
  };
}

// ── 경유지 순서 최적화 10 (TMAP routes/routeOptimization10) ───────
// 입력 viaPoints 의 순서와 관계없이 TMAP 가 최적 순서를 직접 계산해 돌려준다.
// 응답 features 의 properties.index 가 최적 순서, properties.viaPointId 로 원본 매핑.
// 한 번의 호출로 끝나서 메뉴2(멀티 경유지 최적화)에 사용.
export async function optimizeRoute({
  start, dest, waypoints = [], time, searchOption = '0',
}) {
  if (!waypoints.length) {
    // 경유지 없으면 최적화할 게 없음 — 직접 경로로 폴백
    const leg = await predictLeg(start, dest, time, 'departure');
    return {
      order: [],
      totalTime: leg.totalTime,
      totalDistance: leg.totalDistance,
      totalFare: leg.totalFare,
      path: leg.path,
    };
  }

  const body = {
    startName: start.name || '출발',
    startX: String(start.lon),
    startY: String(start.lat),
    endName: dest.name || '도착',
    endX: String(dest.lon),
    endY: String(dest.lat),
    startTime: toTmapStartTime(time),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    searchOption,
    carType: 0,
    viaPoints: waypoints.slice(0, 10).map((w, i) => ({
      viaPointId: `vp${i}`,
      viaPointName: (w.name || `경유${i + 1}`).slice(0, 50),
      viaX: String(w.lon),
      viaY: String(w.lat),
    })),
  };

  const res = await fetch(`${BASE}/routes/routeOptimization10?version=1`, {
    method: 'POST',
    headers: {
      appKey: appKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`경유지 순서 최적화 실패 (${res.status}): ${safeBody(text)}`);
  }
  if (!text) throw new Error('경유지 순서 최적화 응답이 비어있음');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('경유지 순서 최적화 응답 파싱 실패');
  }

  // 응답에서 최적화된 viaPointId 순서를 뽑아 원본 waypoint 로 되짚는다.
  // Point 피처들 중 우리가 부여한 vpN ID 가 properties.viaPointId 에 들어있는 것만 골라
  // properties.index 로 정렬 → 그 순서가 곧 TMAP 이 추천하는 방문 순서.
  const features = Array.isArray(json?.features) ? json.features : [];
  const orderedIds = features
    .filter((f) => f?.geometry?.type === 'Point' && typeof f?.properties?.viaPointId === 'string')
    .filter((f) => /^vp\d+$/.test(f.properties.viaPointId))
    .sort((a, b) => (Number(a.properties.index) || 0) - (Number(b.properties.index) || 0))
    .map((f) => f.properties.viaPointId);
  const seen = new Set();
  const order = orderedIds
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .map((id) => waypoints[Number(id.slice(2))])
    .filter(Boolean);

  const r = parseRoute(json);
  return {
    // 매핑이 완전치 않으면 입력 순서로 폴백 (시간/거리는 어쨌든 정답이므로 보여줌)
    order: order.length === waypoints.length ? order : waypoints,
    totalTime: r.totalTime,
    totalDistance: r.totalDistance,
    totalFare: r.totalFare,
    path: r.path,
  };
}

// ── 다중 경유지 안내 30 (TMAP routes/routeSequential30) ──────────
// 경유지 최대 30개, startTime(yyyyMMddHHmm) 으로 미래 출발시각 반영, 한 번에 응답.
// docs: https://tmap-skopenapi.readme.io/reference/다중-경유지-안내-10
export async function sequentialRoute({
  start, dest, waypoints = [], time, searchOption = '0',
}) {
  const body = {
    startName: start.name || '출발',
    startX: String(start.lon),
    startY: String(start.lat),
    endName: dest.name || '도착',
    endX: String(dest.lon),
    endY: String(dest.lat),
    startTime: toTmapStartTime(time),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    searchOption, // 0:교통최적+추천(기본) / 1:무료우선 / 2:최소시간 / 3:초보
    viaPoints: waypoints.slice(0, 30).map((w, i) => ({
      viaPointId: `vp${i}`,
      viaPointName: (w.name || `경유${i + 1}`).slice(0, 50),
      viaX: String(w.lon),
      viaY: String(w.lat),
    })),
  };

  const res = await fetch(`${BASE}/routes/routeSequential30?version=1`, {
    method: 'POST',
    headers: {
      appKey: appKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`다중 경유 경로 실패 (${res.status}): ${safeBody(text)}`);
  }
  if (!text) {
    const empty = parseRoute({});
    return { ...empty, legs: [] };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('다중 경유 경로 응답 파싱 실패 (본문이 JSON 이 아님)');
  }
  const r = parseRoute(json);
  return {
    totalTime: r.totalTime,
    totalDistance: r.totalDistance,
    totalFare: r.totalFare,
    path: r.path,
    // 경유지별 구간 시간/거리는 응답 features 의 properties.pointIndex/index 로도 잡히지만,
    // 화면에서 합계만 쓰므로 일단 빈 배열.
    legs: [],
  };
}

// 한 구간(시작→도착, 경유지 없음)을 prediction 으로 호출
async function predictLeg(a, b, time, predictionType) {
  const routesInfo = {
    departure: { name: a.name || '출발', lon: String(a.lon), lat: String(a.lat) },
    destination: { name: b.name || '도착', lon: String(b.lon), lat: String(b.lat) },
    predictionType,
    predictionTime: toTmapTime(time),
    searchOption: '00',
    carType: 0,
  };

  const res = await fetch(
    `${BASE}/routes/prediction?version=1&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&sort=index`,
    {
      method: 'POST',
      headers: { appKey: appKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ routesInfo }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`예측 경로 실패 (${res.status}): ${safeBody(text)}`);
  }
  if (!text) return parseRoute({});
  try {
    return parseRoute(JSON.parse(text));
  } catch {
    throw new Error('예측 경로 응답 파싱 실패 (본문이 JSON 이 아님)');
  }
}

// FeatureCollection 응답에서 요약(시간/거리/시각)과 경로 좌표를 뽑아낸다.
function parseRoute(geojson) {
  const features = geojson?.features ?? [];
  let totalTime = null;
  let totalDistance = null;
  let totalFare = null;
  let departureTime = null;
  let arrivalTime = null;
  const path = []; // [[lon,lat], ...]

  for (const f of features) {
    const props = f.properties || {};
    if (props.totalTime != null && totalTime == null) {
      totalTime = Number(props.totalTime); // 초
      totalDistance = Number(props.totalDistance); // m
      totalFare = props.totalFare != null ? Number(props.totalFare) : null;
      departureTime = props.departureTime || null;
      arrivalTime = props.arrivalTime || null;
    }
    if (f.geometry?.type === 'LineString') {
      for (const c of f.geometry.coordinates) path.push([c[0], c[1]]);
    }
  }
  return { totalTime, totalDistance, totalFare, departureTime, arrivalTime, path };
}

// 사람이 읽기 좋은 형태
export function fmtMinutes(seconds) {
  if (seconds == null) return '-';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
