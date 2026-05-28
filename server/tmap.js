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

// 본문이 비었거나 손상된 인코딩일 때 사람이 읽을 수 있는 메시지로 대체
function safeBody(text) {
  if (!text) return '(빈 응답)';
  if (text.charCodeAt(0) === 0x1f) return '(TMAP gzip 손상 본문)';
  if (text.includes('�')) return '(TMAP 본문 인코딩 손상)';
  return text.slice(0, 300);
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
    if (radius) params.set('radius', String(radius)); // km
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

// ── 예측(타임머신) 경로 ───────────────────────────────────────────
// 주의: TMAP routes/prediction 은 경유지 파라미터를 무시한다(실측 확인).
// 그래서 경유지가 있으면 구간(leg)별로 나눠 호출하고 합산한다.
// - predictionType='departure': 출발시각이 주어짐. 각 leg 도착시각을 다음 leg 출발시각으로 체이닝.
// - predictionType='arrival':   도착시각이 주어짐. 역방향으로 leg 출발시각을 거슬러 올라가며 체이닝.
export async function predictRoute({ start, dest, waypoints = [], time, predictionType = 'departure' }) {
  const pts = [start, ...waypoints.slice(0, 5), dest];
  const legs = [];

  if (predictionType === 'arrival') {
    let curArr = time;
    for (let i = pts.length - 1; i >= 1; i--) {
      const leg = await predictLeg(pts[i - 1], pts[i], curArr, 'arrival');
      legs.unshift(leg);
      curArr = leg.departureTime || curArr;
    }
  } else {
    let curDep = time;
    for (let i = 1; i < pts.length; i++) {
      const leg = await predictLeg(pts[i - 1], pts[i], curDep, 'departure');
      legs.push(leg);
      curDep = leg.arrivalTime || curDep;
    }
  }

  return {
    totalTime: legs.reduce((s, l) => s + (l.totalTime || 0), 0),
    totalDistance: legs.reduce((s, l) => s + (l.totalDistance || 0), 0),
    totalFare: legs.reduce((s, l) => s + (l.totalFare || 0), 0) || null,
    path: legs.flatMap((l) => l.path),
    legs: legs.map((l) => ({ totalTime: l.totalTime, totalDistance: l.totalDistance })),
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
