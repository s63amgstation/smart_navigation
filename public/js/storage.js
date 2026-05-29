// 기기 영구 저장 (iOS Safari 포함, 도메인별로 유지)
window.Store = (function () {
  const HOME = 'sn.home'; // 호환: 기존 집주소
  const FAVS = 'sn.favs'; // 즐겨찾기 배열 (최대 10)
  const MAX_FAVS = 10;

  // ── 저장소 폴백 체인 ─────────────────────────────────────
  // localStorage 가 막혀있어도(꽉참 / private 탭 / iOS 정책) 절대 throw 하지 않고
  // sessionStorage → in-memory 순으로 떨어진다. 결과적으로 검색 기록이 어디든
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

    // ── 검색 기록 (최대 10개) ──────────────────────────
    histList() { return readHist(); },
    histAdd(entry) {
      // 어떤 경우에도 throw 하지 않는다 — 검색 버튼이 통째로 죽지 않게.
      try {
        const e = { ...entry, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now() };
        const k = histKey(e);
        if (!k) return e; // 신규 entry 가 유효하지 않으면 그냥 저장 건너뛰기
        const all = readHist().filter((x) => {
          const xk = histKey(x);
          return xk && xk !== k;
        });
        all.unshift(e);
        writeHist(all);
        return e;
      } catch (err) {
        try { console.warn('histAdd 실패 (무시)', err); } catch {}
        return entry;
      }
    },
    histRemove(id) {
      try { writeHist(readHist().filter((e) => e && e.id !== id)); } catch {}
    },
    histClear() {
      try { writeHist([]); } catch {}
    },
  };

  // 검색 기록 보조
  const HIST = 'sn.hist';
  const MAX_HIST = 10;
  // 유효한 좌표 객체인지 — 깨진 옛 엔트리(start/dest 가 null 등)를 솎아내기 위한 가드
  function validPt(p) {
    return p && typeof p === 'object' && p.lon != null && p.lat != null && !Number.isNaN(Number(p.lon)) && !Number.isNaN(Number(p.lat));
  }
  function validEntry(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.kind !== 'menu1' && e.kind !== 'menu2') return false;
    if (!validPt(e.start) || !validPt(e.dest)) return false;
    if (e.kind === 'menu2' && (!Array.isArray(e.waypoints) || !e.waypoints.every(validPt))) return false;
    return true;
  }
  function readHist() {
    try {
      const raw = JSON.parse(storage.getItem(HIST) || '[]');
      if (!Array.isArray(raw)) return [];
      // 깨진 엔트리는 조용히 버린다 — 다음 write 때 영구 청소됨
      return raw.filter(validEntry);
    } catch { return []; }
  }
  function writeHist(arr) {
    try { storage.setItem(HIST, JSON.stringify(arr.slice(0, MAX_HIST))); } catch {}
  }
  function histKey(e) {
    // 호출 시 throw 하지 않게 — 깨진 엔트리는 null 로 표시
    if (!validEntry(e)) return null;
    const c = (p) => `${Number(p.lon).toFixed(4)},${Number(p.lat).toFixed(4)}`;
    if (e.kind === 'menu1') return `m1|${c(e.start)}|${c(e.dest)}|${e.keyword || ''}`;
    const wp = (e.waypoints || []).map(c).sort().join(';');
    return `m2|${c(e.start)}|${c(e.dest)}|${wp}`;
  }
})();
