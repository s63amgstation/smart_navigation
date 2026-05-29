// 기기 영구 저장 (iOS Safari 포함, 도메인별로 유지)
window.Store = (function () {
  const HOME = 'sn.home'; // 호환: 기존 집주소
  const FAVS = 'sn.favs'; // 즐겨찾기 배열 (최대 10)
  const MAX_FAVS = 10;

  // ── 저장소 폴백 체인 ─────────────────────────────────────
  // localStorage 가 막혀있어도(꽉참 / private 탭 / iOS 정책) 절대 throw 하지 않고
  // sessionStorage → in-memory 순으로 떨어진다. 즐겨찾기가 어떤 환경에서도
  // 한 군데에는 무조건 들어간다.
  const storage = (function pickStorage() {
    const tryStore = (s) => {
      try {
        const k = '__sn_probe__';
        s.setItem(k, '1');
        s.removeItem(k);
        return s;
      } catch { return null; }
    };
    return tryStore(window.localStorage) || tryStore(window.sessionStorage) || (function () {
      const mem = Object.create(null);
      return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem(k, v) { mem[k] = String(v); },
        removeItem(k) { delete mem[k]; },
      };
    })();
  })();
  // 다른 모듈에서 디버깅용으로 어느 저장소를 쓰는지 알 수 있게 노출
  try { window.__snStorageKind = storage === window.localStorage ? 'local' : storage === window.sessionStorage ? 'session' : 'memory'; } catch {}

  function readFavs() {
    try {
      return JSON.parse(storage.getItem(FAVS) || '[]');
    } catch {
      return [];
    }
  }
  function writeFavs(arr) {
    try { storage.setItem(FAVS, JSON.stringify(arr.slice(0, MAX_FAVS))); } catch {}
  }

  // 처음 한 번: 기존 home 항목이 있고 favs 가 비어있으면 favs 로 이주(label="집")
  (function migrate() {
    if (storage.getItem(FAVS)) return;
    try {
      const home = JSON.parse(storage.getItem(HOME) || 'null');
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
  };
})();
