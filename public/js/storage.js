// 기기 영구 저장 (iOS Safari 포함, 도메인별로 유지)
window.Store = (function () {
  const HOME = 'sn.home'; // 호환: 기존 집주소
  const FAVS = 'sn.favs'; // 즐겨찾기 배열 (최대 10)
  const MAX_FAVS = 10;

  function readFavs() {
    try {
      return JSON.parse(localStorage.getItem(FAVS) || '[]');
    } catch {
      return [];
    }
  }
  function writeFavs(arr) {
    localStorage.setItem(FAVS, JSON.stringify(arr.slice(0, MAX_FAVS)));
  }

  // 처음 한 번: 기존 home 항목이 있고 favs 가 비어있으면 favs 로 이주(label="집")
  (function migrate() {
    if (localStorage.getItem(FAVS)) return;
    try {
      const home = JSON.parse(localStorage.getItem(HOME) || 'null');
      if (home && home.lon != null && home.lat != null) {
        writeFavs([{ id: 'home0', label: '집', name: home.name, lon: home.lon, lat: home.lat, address: home.address || '' }]);
      }
    } catch {
      /* noop */
    }
  })();

  return {
    MAX_FAVS,
    list() {
      return readFavs();
    },
    add({ label, name, lon, lat, address = '' }) {
      const all = readFavs();
      if (all.length >= MAX_FAVS) return { ok: false, error: `즐겨찾기는 최대 ${MAX_FAVS}개까지` };
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        label: String(label || '즐겨찾기').slice(0, 20),
        name,
        lon: Number(lon),
        lat: Number(lat),
        address,
      };
      all.push(item);
      writeFavs(all);
      return { ok: true, item };
    },
    update(id, updates) {
      const all = readFavs();
      const i = all.findIndex((f) => f.id === id);
      if (i < 0) return false;
      if (updates.label != null) updates.label = String(updates.label).slice(0, 20);
      all[i] = { ...all[i], ...updates };
      writeFavs(all);
      return true;
    },
    remove(id) {
      writeFavs(readFavs().filter((f) => f.id !== id));
    },
    findByCoord(lon, lat) {
      return readFavs().find((f) => Math.abs(f.lon - lon) < 1e-4 && Math.abs(f.lat - lat) < 1e-4);
    },
    // 첫 번째 즐겨찾기를 자동 출발지 기본값으로 사용 (보통 "집")
    defaultStart() {
      const all = readFavs();
      return all.find((f) => f.label === '집') || all[0] || null;
    },

    // ── 검색 기록 (최대 10개) ──────────────────────────
    histList() { return readHist(); },
    histAdd(entry) {
      const e = { ...entry, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now() };
      const k = histKey(e);
      const all = readHist().filter((x) => histKey(x) !== k);
      all.unshift(e);
      writeHist(all);
      return e;
    },
    histRemove(id) { writeHist(readHist().filter((e) => e.id !== id)); },
    histClear() { writeHist([]); },
  };

  // 검색 기록 보조
  const HIST = 'sn.hist';
  const MAX_HIST = 10;
  function readHist() {
    try { return JSON.parse(localStorage.getItem(HIST) || '[]'); } catch { return []; }
  }
  function writeHist(arr) { localStorage.setItem(HIST, JSON.stringify(arr.slice(0, MAX_HIST))); }
  function histKey(e) {
    const c = (p) => `${Number(p.lon).toFixed(4)},${Number(p.lat).toFixed(4)}`;
    if (e.kind === 'menu1') return `m1|${c(e.start)}|${c(e.dest)}|${e.keyword || ''}`;
    const wp = (e.waypoints || []).map(c).sort().join(';');
    return `m2|${c(e.start)}|${c(e.dest)}|${wp}`;
  }
})();
