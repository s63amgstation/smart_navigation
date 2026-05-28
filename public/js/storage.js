// 기기 영구 저장 (iOS Safari 포함 모든 모던 브라우저에서 도메인별로 유지)
window.Store = (function () {
  const HOME = 'sn.home'; // {name, lon, lat, address}

  return {
    getHome() {
      try {
        return JSON.parse(localStorage.getItem(HOME) || 'null');
      } catch {
        return null;
      }
    },
    setHome(place) {
      if (place && place.lon != null && place.lat != null) {
        localStorage.setItem(HOME, JSON.stringify(place));
      }
    },
    clearHome() {
      localStorage.removeItem(HOME);
    },
  };
})();
