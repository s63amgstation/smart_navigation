(function () {
  let cfg = { hasKey: false, mapKey: '' };
  const views = [...document.querySelectorAll('.view')];
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('backBtn');
  const TITLES = { home: '스마트 길찾기', menu1: '최소 경유지 찾기', menu2: '멀티 경유지 최적화' };

  // ── 라우팅 ──────────────────────────────────────────────
  function showView(name) {
    views.forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    titleEl.textContent = TITLES[name] || '스마트 길찾기';
    backBtn.hidden = name === 'home';
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.go)),
  );
  backBtn.addEventListener('click', () => showView('home'));

  // ── 토스트 ──────────────────────────────────────────────
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ── 시간 입력 기본값 = 지금 ──────────────────────────────
  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  document.getElementById('m1-time').value = nowLocal();
  document.getElementById('m2-time').value = nowLocal();

  // ── 현재 위치 가져오기 ─────────────────────────────────
  function useCurrentLocation(placeInput) {
    if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않습니다');
    toast('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        placeInput.setValue({ name: '📍 내 현재 위치', lon, lat, address: '' });
      },
      (err) => {
        const m = {
          1: '위치 권한이 거부됨. iPhone: 설정 > Safari > 위치 → 허용으로 바꿔주세요.',
          2: '현재 위치를 확인할 수 없습니다.',
          3: '위치 확인 시간 초과',
        };
        toast(m[err.code] || '위치 확인 실패: ' + err.message);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ── 출발지 칩(현위치/집/집으로 저장) ─────────────────────
  function attachStartHelpers(placeInput, holderEl) {
    const row = document.createElement('div');
    row.className = 'quick-fill';
    holderEl.parentElement.insertBefore(row, holderEl.nextSibling);

    function render() {
      row.innerHTML = '';
      // 📍 현위치
      addChip(row, '📍 현위치', () => useCurrentLocation(placeInput));
      // 🏠 집 (저장돼 있을 때만)
      const home = Store.getHome();
      if (home) {
        addChip(row, '🏠 집', () => placeInput.setValue(home), home.name);
        addChip(row, '✕', () => {
          if (confirm('저장된 집주소를 삭제할까요?')) {
            Store.clearHome();
            toast('집주소 삭제됨');
            allRenders.forEach((r) => r()); // 다른 입력의 칩도 동기화
          }
        }, '집주소 해제').classList.add('chip-mini');
      }
      // 💾 현재 출발지를 집으로 저장 (값이 있고, 저장된 집과 다를 때만)
      const cur = placeInput.getValue();
      if (cur && cur.lon != null && cur.lat != null) {
        const same = home && Math.abs(cur.lon - home.lon) < 1e-4 && Math.abs(cur.lat - home.lat) < 1e-4;
        if (!same) {
          addChip(row, '💾 이 위치를 집으로', () => {
            Store.setHome(cur);
            toast('집주소로 저장됨');
            allRenders.forEach((r) => r());
          }).classList.add('chip-save');
        }
      }
    }
    allRenders.push(render);
    return { render };
  }

  function addChip(parent, text, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  const allRenders = []; // 두 출발지 입력의 칩들을 동시에 갱신할 때 사용

  // ── 장소 입력 인스턴스 ──────────────────────────────────
  const PI = {};
  function makeStart(role, placeholder) {
    const holder = document.querySelector(`[data-role="${role}"]`);
    let helpers;
    const pi = PlaceInput.create(holder, { placeholder, onChange: () => helpers?.render() });
    helpers = attachStartHelpers(pi, holder);
    return pi;
  }
  PI.start = makeStart('start', '출발지 검색');
  PI.dest = PlaceInput.create(document.querySelector('[data-role="dest"]'), { placeholder: '도착지 검색' });
  PI.m2start = makeStart('m2start', '출발지 검색');
  PI.m2dest = PlaceInput.create(document.querySelector('[data-role="m2dest"]'), { placeholder: '도착지 검색' });

  // ── 카테고리 칩 (메뉴1) ─────────────────────────────────
  const m1kw = document.getElementById('m1-keyword');
  ['스타벅스', '카페', '주유소', '편의점', '약국', '주차장'].forEach((c) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = c;
    chip.addEventListener('click', () => (m1kw.value = c));
    document.getElementById('m1-chips').appendChild(chip);
  });

  // ── 공통: 거리/시간 포맷 ────────────────────────────────
  const km = (m) => (m == null ? '-' : (m / 1000).toFixed(1) + 'km');

  // 분 단위 절댓값 포맷 ("3분" / "1시간 5분")
  function fmtMinAbs(seconds) {
    const m = Math.round(Math.abs(seconds) / 60);
    if (m < 60) return `${m}분`;
    return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  }

  // 베이스라인 대비 추가 시간 표시.
  // 경유는 물리적으로 직접보다 빠를 수 없으므로(leg-split 예측 노이즈로 음수가 나와도)
  // 1분 미만 차이는 "거의 동일", 1분 이상 양수만 "+N분 추가" 로 보여준다.
  function extraBadgeHtml(extraSeconds) {
    if (extraSeconds == null) return '';
    const m = Math.round(extraSeconds / 60);
    if (m < 1) return `<span style="color:#6b7280;font-weight:600">  ≈ 거의 동일</span>`;
    return `<span style="color:#b45309;font-weight:600">  +${fmtMinAbs(extraSeconds)} 추가</span>`;
  }

  // ── 메뉴 1 실행 ─────────────────────────────────────────
  // 결과/입력값은 카드 클릭 시 지도를 다시 그리기 위해 모듈 스코프에 보관
  let m1State = { results: [], start: null, dest: null, selectedIdx: -1 };
  const m1ResultEl = document.getElementById('m1-result');
  const m1MapEl = document.getElementById('m1-map');
  const m1MapHome = m1MapEl.parentElement; // 원래 자리(섹션 안, 결과 박스 밖)

  // 지도 div 를 선택된 카드 바로 아래에 끼워넣는다
  function m1MoveMapUnder(card) {
    if (!card || !m1MapEl) return;
    if (card.nextElementSibling !== m1MapEl) card.after(m1MapEl);
  }

  function m1DrawSelected(idx) {
    const r = m1State.results[idx];
    if (!r || r.error || r.totalTime == null) return;
    m1State.selectedIdx = idx;
    const card = m1ResultEl.querySelector(`.res-card[data-idx="${idx}"]`);
    m1MoveMapUnder(card);
    m1ResultEl.querySelectorAll('.res-card[data-idx]').forEach((c) => {
      c.classList.toggle('selected', Number(c.dataset.idx) === idx);
    });
    MapView.draw('m1-map', {
      mapKey: cfg.mapKey,
      path: r.path,
      markers: [
        { lon: m1State.start.lon, lat: m1State.start.lat, label: '출발', role: 'start' },
        { lon: r.poi.lon, lat: r.poi.lat, label: '경유', role: 'via' },
        { lon: m1State.dest.lon, lat: m1State.dest.lat, label: '도착', role: 'end' },
      ],
    });
  }

  // 카드 클릭은 위임 리스너로 한 번만 부착
  m1ResultEl.addEventListener('click', (e) => {
    const card = e.target.closest('.res-card[data-idx]');
    if (!card) return;
    m1DrawSelected(Number(card.dataset.idx));
  });

  document.getElementById('m1-run').addEventListener('click', async () => {
    const start = PI.start.getValue();
    const dest = PI.dest.getValue();
    const keyword = m1kw.value.trim();
    if (!start || !dest) return toast('출발지와 도착지를 선택하세요');
    if (!keyword) return toast('찾을 장소를 입력하세요 (예: 스타벅스)');

    const btn = document.getElementById('m1-run');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>경유지별 시간 계산 중…';
    // 지난번 검색에서 지도를 결과 카드 사이로 옮겨놨다면, 결과 innerHTML 갱신 전에 원위치로 빼낸다
    if (m1MapEl.parentElement !== m1MapHome) m1MapHome.appendChild(m1MapEl);
    m1MapEl.hidden = true;
    m1ResultEl.innerHTML = '';
    try {
      const { results, best, baseline } = await Api.minWaypoint({
        start, dest, keyword,
        time: document.getElementById('m1-time').value,
        predictionType: document.getElementById('m1-ptype').value,
        maxCandidates: 5,
      });
      if (!results.length) {
        m1ResultEl.innerHTML = '<div class="hint">근처에서 후보를 찾지 못했어요. 키워드를 바꿔보세요.</div>';
        return;
      }
      if (!best) {
        const firstErr = results.find((r) => r.error)?.error || '경로 계산 실패';
        m1ResultEl.innerHTML = `<div class="hint">경로 계산이 모두 실패했어요. (${firstErr})</div>`;
        return;
      }
      m1State = { results, start, dest, selectedIdx: -1 };

      const baselineCard = baseline?.totalTime != null ? `
        <div class="res-card" style="border-style:dashed">
          <div class="res-rank" style="color:#6b7280">기준 (경유 없이 바로 이동)</div>
          <div class="res-time">${baseline.timeText} · ${km(baseline.totalDistance)}</div>
        </div>` : '';
      m1ResultEl.innerHTML = baselineCard + results
        .map((r, i) => {
          if (r.error) {
            return `<div class="res-card" data-idx="${i}" data-err="1">
              <div class="res-rank">${i + 1}순위</div>
              <div class="res-name">${r.poi.name}</div>
              <div class="res-meta">${r.poi.address || ''}</div>
              <div class="res-meta" style="color:#b91c1c">계산 실패: ${r.error}</div></div>`;
          }
          const isBest = best && r.poi.name === best.poi.name && r.totalTime === best.totalTime;
          const extra = extraBadgeHtml(r.extraSeconds);
          return `
            <div class="res-card clickable ${isBest ? 'best' : ''}" data-idx="${i}">
              <div class="res-rank">${i + 1}순위${isBest ? '<span class="badge">최단</span>' : ''}<span class="tap-hint">탭하면 지도</span></div>
              <div class="res-name">${r.poi.name}</div>
              <div class="res-meta">${r.poi.address || ''}</div>
              <div class="res-time">${r.timeText} · ${km(r.totalDistance)}${extra}</div>
            </div>`;
        })
        .join('');

      // 1순위(첫 유효 결과)를 기본 선택
      const initIdx = results.findIndex((r) => !r.error && r.totalTime != null);
      if (initIdx >= 0) m1DrawSelected(initIdx);
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '최적 경유지 찾기';
    }
  });

  // ── 메뉴 2: 경유지 동적 추가 ────────────────────────────
  const wpWrap = document.getElementById('m2-waypoints');
  const wpInputs = [];
  function addWaypoint() {
    if (wpInputs.length >= 5) return toast('경유지는 최대 5개입니다');
    const row = document.createElement('div');
    row.className = 'wp-row';
    const holder = document.createElement('div');
    holder.className = 'place-input';
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '✕';
    row.appendChild(holder);
    row.appendChild(del);
    wpWrap.appendChild(row);
    const pi = PlaceInput.create(holder, { placeholder: `경유지 ${wpInputs.length + 1}` });
    const ref = { pi, row };
    wpInputs.push(ref);
    del.addEventListener('click', () => {
      wpWrap.removeChild(row);
      const idx = wpInputs.indexOf(ref);
      if (idx >= 0) wpInputs.splice(idx, 1);
    });
  }
  document.getElementById('m2-add').addEventListener('click', addWaypoint);
  addWaypoint(); // 기본 1개

  // ── 메뉴 2 실행 ─────────────────────────────────────────
  let m2State = { results: [], start: null, dest: null, selectedIdx: -1 };
  const m2ResultEl = document.getElementById('m2-result');
  const m2MapEl = document.getElementById('m2-map');
  const m2MapHome = m2MapEl.parentElement;

  function m2MoveMapUnder(card) {
    if (!card || !m2MapEl) return;
    if (card.nextElementSibling !== m2MapEl) card.after(m2MapEl);
  }

  function m2DrawSelected(idx) {
    const r = m2State.results[idx];
    if (!r || r.error || r.totalTime == null) return;
    m2State.selectedIdx = idx;
    const card = m2ResultEl.querySelector(`.res-card[data-idx="${idx}"]`);
    m2MoveMapUnder(card);
    m2ResultEl.querySelectorAll('.res-card[data-idx]').forEach((c) => {
      c.classList.toggle('selected', Number(c.dataset.idx) === idx);
    });
    MapView.draw('m2-map', {
      mapKey: cfg.mapKey,
      path: r.path,
      markers: [
        { lon: m2State.start.lon, lat: m2State.start.lat, label: '출발', role: 'start' },
        ...r.order.map((w, i) => ({ lon: w.lon, lat: w.lat, label: `경유${i + 1}`, role: 'via' })),
        { lon: m2State.dest.lon, lat: m2State.dest.lat, label: '도착', role: 'end' },
      ],
    });
  }

  m2ResultEl.addEventListener('click', (e) => {
    const card = e.target.closest('.res-card[data-idx]');
    if (!card) return;
    m2DrawSelected(Number(card.dataset.idx));
  });

  function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }

  document.getElementById('m2-run').addEventListener('click', async () => {
    const start = PI.m2start.getValue();
    const dest = PI.m2dest.getValue();
    const waypoints = wpInputs.map((w) => w.pi.getValue()).filter(Boolean);
    if (!start || !dest) return toast('출발지와 도착지를 선택하세요');
    if (!waypoints.length) return toast('경유지를 1개 이상 선택하세요');

    const btn = document.getElementById('m2-run');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${factorial(waypoints.length)}가지 순서 비교 중…`;
    // 지도 원위치 복귀 후 결과 비우기
    if (m2MapEl.parentElement !== m2MapHome) m2MapHome.appendChild(m2MapEl);
    m2MapEl.hidden = true;
    m2ResultEl.innerHTML = '';
    try {
      const { results, best, combinations } = await Api.optimize({
        start, dest, waypoints,
        time: document.getElementById('m2-time').value,
        predictionType: document.getElementById('m2-ptype').value,
      });
      if (!results?.length || !best) {
        m2ResultEl.innerHTML = '<div class="hint">경로를 계산하지 못했어요.</div>';
        return;
      }
      m2State = { results, start, dest, selectedIdx: -1 };

      const header = `<div class="hint">${combinations}가지 순서를 모두 계산 — 시간 짧은 순으로 정렬. 카드를 탭하면 해당 순서의 지도가 펼쳐집니다.</div>`;
      m2ResultEl.innerHTML = header + results
        .map((r, i) => {
          // 시퀀스 표시: "출발 → 경유1 (카페A) → 경유2 (주유소B) → 도착"
          const seqParts = ['<b>출발</b>'];
          r.order.forEach((w, j) => seqParts.push(`<b>경유${j + 1}</b> <span style="color:#6b7280">(${escapeHtml(w.name)})</span>`));
          seqParts.push('<b>도착</b>');
          const seq = seqParts.join(' → ');

          if (r.error) {
            return `<div class="res-card" data-idx="${i}" data-err="1">
              <div class="res-rank">${i + 1}위</div>
              <div class="res-name" style="font-size:13px;font-weight:500">${seq}</div>
              <div class="res-meta" style="color:#b91c1c">계산 실패: ${escapeHtml(r.error)}</div></div>`;
          }
          const isBest = best && r.totalTime === best.totalTime;
          return `<div class="res-card clickable ${isBest ? 'best' : ''}" data-idx="${i}">
            <div class="res-rank">${i + 1}위${isBest ? '<span class="badge">최단</span>' : ''}<span class="tap-hint">탭하면 지도</span></div>
            <div class="res-name" style="font-size:13px;font-weight:500;line-height:1.5">${seq}</div>
            <div class="res-time">${r.timeText} · ${km(r.totalDistance)}</div>
          </div>`;
        })
        .join('');

      const initIdx = results.findIndex((r) => !r.error && r.totalTime != null);
      if (initIdx >= 0) m2DrawSelected(initIdx);
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '최적 순서 계산';
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── 부팅 ────────────────────────────────────────────────
  (async function boot() {
    try {
      cfg = await Api.config();
      if (!cfg.hasKey) toast('TMAP 키 미설정 — .env 에 키를 넣어주세요');
    } catch {
      toast('서버 설정을 불러오지 못했어요');
    }
    showView('home');
  })();
})();
