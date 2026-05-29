// 백엔드(/api/*) 호출 래퍼. TMAP 직접 호출이 아니라 우리 서버 프록시를 부른다.
window.Api = (function () {
  async function get(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    return data;
  }
  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    return data;
  }

  return {
    config: () => get('/api/config'),
    reverseGeocode: (lat, lon) => get(`/api/reverse-geocode?lat=${lat}&lon=${lon}`),
    pois: (keyword, center) => {
      const p = new URLSearchParams({ keyword });
      if (center) {
        p.set('centerLon', center.lon);
        p.set('centerLat', center.lat);
        p.set('radius', center.radius || 5);
      }
      return get('/api/pois?' + p.toString());
    },
    route: (body) => post('/api/route', body),
    minWaypoint: (body) => post('/api/min-waypoint', body),
    optimize: (body) => post('/api/optimize-waypoints', body),
  };
})();
