// 메인 화면 상단의 날짜/시간/현위치 표기.
// 날씨/온도/파티클은 모두 제거됨 — 배경은 CSS 그라데이션이 자체로 움직임.
// 위치는 TMAP 역지오코딩 (시·구 레벨). 권한 거부/오류면 그냥 표기 생략.
window.WeatherView = (function () {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function greeting(hour) {
    if (hour < 5) return '늦은 밤이네요';
    if (hour < 12) return '좋은 아침이에요';
    if (hour < 18) return '좋은 오후예요';
    if (hour < 22) return '좋은 저녁이에요';
    return '늦은 시간이네요';
  }

  function fmtDateTime() {
    const d = new Date();
    const dateStr = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
    const h = d.getHours();
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h % 12 || 12;
    const timeStr = `${ampm} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { dateStr, timeStr };
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

  function renderInfo(infoEl, region) {
    if (!infoEl) return;
    const { dateStr, timeStr } = fmtDateTime();
    const regionHtml = region ? `<span class="w-dot">·</span><span class="w-loc">${region}</span>` : '';
    infoEl.innerHTML = `
      <span class="w-date">${dateStr}</span>
      <span class="w-dot">·</span>
      <span class="w-time">${timeStr}</span>
      ${regionHtml}
    `;
  }

  async function load(_bgEl, infoEl, greetEl) {
    // 즉시 인사/날짜/시간은 보여주고, 위치는 비동기로 채움
    const hour = new Date().getHours();
    if (greetEl) greetEl.textContent = greeting(hour) + '!';
    renderInfo(infoEl, null);

    // 1분마다 시계 갱신 — 자정 넘어가도 날짜 자동 업데이트
    setInterval(() => {
      // region 은 이번 세션에서 한 번 잡으면 유지 (위치 다시 안 부름)
      const cur = infoEl?.querySelector('.w-loc')?.textContent || null;
      renderInfo(infoEl, cur);
    }, 60_000);

    // 위치는 권한 받을 수 있으면만 — 실패해도 조용히 통과
    const pos = await getPosition();
    if (!pos) return;
    try {
      const { region } = await Api.reverseGeocode(pos.lat, pos.lon);
      if (region) renderInfo(infoEl, region);
    } catch {
      /* 실패 — 그냥 표기 생략 */
    }
  }

  return { load };
})();
