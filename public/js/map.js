// TMAP 지도 SDK 래퍼. SDK 는 appKey 가 클라이언트에 필요하므로
// /api/config 로 키를 받아 스크립트를 1회만 동적 로드한다.
window.MapView = (function () {
  let sdkPromise = null;

  // SDK 는 보통 HTML 의 <head> 에서 동기 로드된다(서버가 주입).
  // 이미 Tmapv2.Map 이 있으면 즉시 통과. 없으면(키 미주입 등) 동적 로드는 신뢰할 수 없으니 명시적으로 실패시킨다.
  function loadSdk(_mapKey) {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      if (window.Tmapv2 && window.Tmapv2.Map) return resolve();
      // 짧게 한 번 더 기다려본다(SDK 가 늦게 들어올 수 있어)
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (window.Tmapv2 && window.Tmapv2.Map) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > 4000) {
          clearInterval(iv);
          reject(new Error('TMAP 지도 SDK 가 로드되지 않았습니다. (서버에서 appKey 가 주입됐는지, 지도 API 가 구독돼 있는지 확인)'));
        }
      }, 100);
    });
    return sdkPromise;
  }

  const maps = {}; // divId -> Tmapv2.Map

  // 핀 SVG (라운드 사각 + 아래 화살촉) 를 라벨 길이에 맞춰 가변 폭으로 만든다.
  // 한글이 포함된 라벨("경유1", "출발")도 잘리지 않도록 폭/폰트 자동 조절.
  function pinIcon(text, color) {
    const t = String(text || '');
    const hasKor = /[가-힣]/.test(t);
    const fontSize = t.length <= 2 ? 13 : 11;
    const charW = hasKor ? 12 : 7;
    const w = Math.max(36, Math.round(t.length * charW + 16));
    const rectH = 28;
    const tipH = 10;
    const h = rectH + tipH;
    const cx = w / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="1" y="1" width="${w - 2}" height="${rectH - 1}" rx="${(rectH - 1) / 2}" fill="${color}" stroke="white" stroke-width="2"/>
      <path d="M${cx - 7} ${rectH - 2} L${cx} ${h - 1} L${cx + 7} ${rectH - 2} Z" fill="${color}" stroke="white" stroke-width="2"/>
      <rect x="${cx - 7}" y="${rectH - 3}" width="14" height="3" fill="${color}"/>
      <text x="${cx}" y="${rectH / 2 + fontSize / 3 + 1}" text-anchor="middle" fill="white" font-size="${fontSize}" font-weight="700" font-family="-apple-system,sans-serif">${t}</text>
    </svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), w, h };
  }
  const ROLE_COLOR = { start: '#15803d', via: '#f59e0b', end: '#dc2626' };

  // path: [[lon,lat], ...]
  // markers: [{lon,lat,label,role:'start'|'via'|'end'}]
  async function draw(divId, { path = [], markers = [], mapKey }) {
    await loadSdk(mapKey);
    const el = document.getElementById(divId);
    el.hidden = false;
    el.innerHTML = '';

    const first = (markers[0] && [markers[0].lon, markers[0].lat]) || path[0] || [126.9784, 37.566];
    // Tmapv2.Map 은 width/height 옵션을 inline style 로 컨테이너에 박는다.
    // '100%' 를 주면 부모에 명시 높이가 없는 한 4px 로 깔리므로,
    // 컨테이너가 CSS 로 가진 실제 픽셀 크기를 측정해서 명시적으로 넘긴다.
    const rect = el.getBoundingClientRect();
    const w = Math.max(200, rect.width || el.clientWidth || 320);
    const h = Math.max(200, rect.height || el.clientHeight || 320);
    const map = new Tmapv2.Map(divId, {
      center: new Tmapv2.LatLng(first[1], first[0]),
      width: w + 'px',
      height: h + 'px',
      zoom: 13,
    });
    maps[divId] = map;

    const bounds = new Tmapv2.LatLngBounds();

    if (path.length) {
      const latlngs = path.map((c) => new Tmapv2.LatLng(c[1], c[0]));
      new Tmapv2.Polyline({ path: latlngs, strokeColor: '#1f6feb', strokeWeight: 6, strokeOpacity: 0.85, map });
      latlngs.forEach((ll) => bounds.extend(ll));
    }

    markers.forEach((m) => {
      const ll = new Tmapv2.LatLng(m.lat, m.lon);
      const color = ROLE_COLOR[m.role] || ROLE_COLOR.via;
      const ic = pinIcon(m.label || '', color);
      new Tmapv2.Marker({
        position: ll,
        map,
        icon: ic.url,
        iconSize: new Tmapv2.Size(ic.w, ic.h),
      });
      bounds.extend(ll);
    });

    // 항상 모든 점이 보이도록 fit (한 점뿐이면 zoom 유지)
    try {
      if (path.length || markers.length > 1) map.fitBounds(bounds);
    } catch {
      /* fitBounds 미지원 시 무시 */
    }
  }

  return { draw };
})();
