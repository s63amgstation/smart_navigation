// 메인 화면 상단 카드의 날짜/날씨/현위치 + 배경 애니메이션.
// 공개 API(Open-Meteo, 키 불필요) 만 사용. 위치 권한 없으면 서울로 폴백.
window.WeatherView = (function () {
  // Open-Meteo WMO weather code → 우리 씬 분류
  function classify(code, hour) {
    const isNight = hour < 6 || hour >= 19;
    if (code == null) return isNight ? 'clear-night' : 'sunny';
    if ([95, 96, 99].includes(code)) return 'storm';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
      return isNight ? 'rain-night' : 'rain';
    if ([45, 48].includes(code)) return isNight ? 'cloudy-night' : 'cloudy';
    if (code === 2 || code === 3) return isNight ? 'cloudy-night' : 'cloudy';
    return isNight ? 'clear-night' : 'sunny';
  }

  // 인사말: 시간대별
  function greeting(hour) {
    if (hour < 5) return '늦은 밤이네요';
    if (hour < 12) return '좋은 아침이에요';
    if (hour < 18) return '좋은 오후예요';
    if (hour < 22) return '좋은 저녁이에요';
    return '늦은 시간이네요';
  }

  function shortDate() {
    const d = new Date();
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  function getPosition() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => res(null),
        { timeout: 5000, maximumAge: 5 * 60_000 },
      );
    });
  }

  async function fetchWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('weather ' + r.status);
    return r.json();
  }

  // Open-Meteo geocoding(역지오 없음) 대신, 좌표 → 한국 행정구역 변환은 안 함.
  // 깔끔하게 "현재 위치" 또는 "서울" 표기.
  function popUiBackground(bgEl, scene) {
    bgEl.className = 'weather-bg ' + scene;
    bgEl.innerHTML = '';
    // 풀스크린이라 입자 수를 넉넉히
    const N = scene === 'rain' || scene === 'rain-night' || scene === 'storm' ? 70 : scene === 'snow' ? 50 : 0;
    if (N > 0) {
      const cls = scene === 'snow' ? 'flake' : 'drop';
      for (let i = 0; i < N; i++) {
        const d = document.createElement('div');
        d.className = cls;
        d.style.left = Math.random() * 100 + '%';
        d.style.animationDelay = Math.random() * 4 + 's';
        d.style.animationDuration = (cls === 'flake' ? 5 + Math.random() * 5 : 1.4 + Math.random() * 1.2) + 's';
        if (cls === 'flake') d.textContent = '❄';
        bgEl.appendChild(d);
      }
    }
    if (scene === 'sunny') {
      const sun = document.createElement('div');
      sun.className = 'sun';
      bgEl.appendChild(sun);
    }
    if (scene === 'cloudy' || scene === 'cloudy-night') {
      for (let i = 0; i < 5; i++) {
        const c = document.createElement('div');
        c.className = 'cloud';
        c.style.top = 8 + i * 14 + '%';
        c.style.animationDuration = 38 + i * 8 + 's';
        c.style.animationDelay = -i * 10 + 's';
        bgEl.appendChild(c);
      }
    }
    if (scene === 'clear-night' || scene === 'cloudy-night' || scene === 'rain-night') {
      const moon = document.createElement('div');
      moon.className = 'moon';
      bgEl.appendChild(moon);
      const starCount = scene === 'clear-night' ? 80 : 35;
      for (let i = 0; i < starCount; i++) {
        const s = document.createElement('div');
        s.className = 'star';
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 85 + '%';
        s.style.animationDelay = Math.random() * 2 + 's';
        s.style.opacity = 0.4 + Math.random() * 0.6;
        bgEl.appendChild(s);
      }
    }
  }

  async function load(bgEl, infoEl, greetEl) {
    const hour = new Date().getHours();
    // 즉시 인사/날짜는 보여주고, 위치/날씨는 비동기로
    if (greetEl) greetEl.textContent = greeting(hour) + '!';
    if (infoEl) infoEl.innerHTML = `<span class="w-date">${shortDate()}</span>`;

    let lat = 37.5665, lon = 126.978, locLabel = '서울';
    const pos = await getPosition();
    if (pos) {
      lat = pos.lat;
      lon = pos.lon;
      locLabel = '현재 위치';
    }

    let scene = hour < 6 || hour >= 19 ? 'clear-night' : 'sunny';
    let temp = null;
    try {
      const w = await fetchWeather(lat, lon);
      temp = w?.current?.temperature_2m;
      scene = classify(w?.current?.weather_code, hour);
    } catch (e) {
      /* offline / blocked — 기본 씬 유지 */
    }
    popUiBackground(bgEl, scene);
    if (infoEl) {
      const tempStr = temp != null ? `${Math.round(temp)}°` : '';
      infoEl.innerHTML = `
        <span class="w-date">${shortDate()}</span>
        <span class="w-dot">·</span>
        <span class="w-loc">${locLabel}</span>
        ${tempStr ? `<span class="w-dot">·</span><span class="w-temp">${tempStr}</span>` : ''}
      `;
    }
  }

  return { load };
})();
