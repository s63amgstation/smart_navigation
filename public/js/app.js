(function () {
  let cfg = { hasKey: false, mapKey: '' };
  const views = [...document.querySelectorAll('.view')];
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('backBtn');
  const TITLES = { home: '', menu1: '경유지 시간 비교', menu2: '멀티 경유지 최적화', favs: '즐겨찾기' };

  // ── 라우팅 ──────────────────────────────────────────────
  function showView(name) {
    views.forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    titleEl.textContent = TITLES[name] || '';
    backBtn.hidden = name === 'home';
    document.body.classList.toggle('home-active', name === 'home');
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

  // ── 공통 ────────────────────────────────────────────────
  const km = (m) => (m == null ? '-' : (m / 1000).toFixed(1) + 'km');
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function fmtMinAbs(seconds) {
    const m = Math.round(Math.abs(seconds) / 60);
    if (m < 60) return `${m}분`;
    return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  }
  function extraBadgeHtml(extraSeconds) {
    if (extraSeconds == null) return '';
    const m = Math.round(extraSeconds / 60);
    if (m < 1) return `<span style="color:#6b7280;font-weight:600">  ≈ 거의 동일</span>`;
    return `<span style="color:#b45309;font-weight:600">  +${fmtMinAbs(extraSeconds)} 추가</span>`;
  }

  // ── 시간 입력: 10분 단위 라운딩 + 기본값/프리셋 ─────────
  function localDtString(date = new Date(), roundMin = 10) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    d.setMinutes(Math.round(d.getMinutes() / roundMin) * roundMin);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function applyDtPreset(input, preset) {
    const d = new Date();
    if (preset === '+30m') d.setMinutes(d.getMinutes() + 30);
    else if (preset === '+1h') d.setHours(d.getHours() + 1);
    else if (preset === 'tmr9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    input.value = localDtString(d);
  }
  document.getElementById('m1-time').value = localDtString();
  document.getElementById('m2-time').value = localDtString();
  document.querySelectorAll('.dt-wrap').forEach((wrap) => {
    const inp = wrap.querySelector('.dt-input');
    wrap.querySelectorAll('[data-dt]').forEach((b) => {
      b.addEventListener('click', () => applyDtPreset(inp, b.dataset.dt));
    });
    // 사용자가 직접 시간 변경 시 10분 단위로 자동 라운딩
    inp.addEventListener('change', () => { inp.value = localDtString(new Date(inp.value)); });
  });

  // ── 현재 위치 ───────────────────────────────────────────
  function useCurrentLocation(placeInput) {
    if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않습니다');
    toast('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => placeInput.setValue({ name: '📍 내 현재 위치', lon: pos.coords.longitude, lat: pos.coords.latitude, address: '' }),
      (err) => {
        const m = { 1: '위치 권한이 거부됨. iPhone: 설정 > Safari > 위치 → 허용', 2: '현재 위치 확인 불가', 3: '위치 확인 시간 초과' };
        toast(m[err.code] || '위치 확인 실패');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  // ── 즐겨찾기 칩 행 (모든 검색 입력 아래에 붙음) ─────────
  function iconOf(label) {
    const s = String(label || '');
    if (s.includes('집')) return '🏠';
    if (s.includes('회사')) return '🏢';
    if (s.includes('학교')) return '📚';
    if (s.includes('병원')) return '🏥';
    if (s.includes('카페') || s.includes('스타벅스')) return '☕';
    return '⭐';
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
  const allRenders = []; // 즐겨찾기 변화 시 모든 칩행을 동시에 갱신
  function attachFavoritesBar(placeInput, holderEl, opts = {}) {
    const row = document.createElement('div');
    row.className = 'fav-bar';
    holderEl.parentElement.insertBefore(row, holderEl.nextSibling);
    function render() {
      row.innerHTML = '';
      if (opts.withCurrent) {
        addChip(row, '📍 현위치', () => useCurrentLocation(placeInput)).classList.add('chip-cur');
      }
      Store.list().forEach((f) => {
        addChip(row, `${iconOf(f.label)} ${f.label}`, () => placeInput.setValue(f), f.name);
      });
      if (opts.withSave) {
        const cur = placeInput.getValue();
        if (cur && cur.lon != null && cur.lat != null && !Store.findByCoord(cur.lon, cur.lat)) {
          addChip(row, '⭐ 즐겨찾기 추가', () => openFavModal({ preset: cur })).classList.add('chip-save');
        }
      }
    }
    allRenders.push(render);
    return { render };
  }
  function refreshAllBars() { allRenders.forEach((r) => r()); }

  // ── 장소 입력 인스턴스 (모두 즐겨찾기 칩 바 부착) ────────
  const PI = {};
  function makeInput(role, placeholder, barOpts) {
    const holder = document.querySelector(`[data-role="${role}"]`);
    let helpers;
    const pi = PlaceInput.create(holder, { placeholder, onChange: () => helpers?.render() });
    helpers = attachFavoritesBar(pi, holder, barOpts);
    return pi;
  }
  PI.start   = makeInput('start',   '출발지 검색', { withCurrent: true,  withSave: true });
  PI.dest    = makeInput('dest',    '도착지 검색', { withCurrent: false, withSave: true });
  PI.m2start = makeInput('m2start', '출발지 검색', { withCurrent: true,  withSave: true });
  PI.m2dest  = makeInput('m2dest',  '도착지 검색', { withCurrent: false, withSave: true });

  // 진입 시 기본 출발지 = "집" 즐겨찾기(없으면 첫 즐겨찾기)
  (function applyDefaultStart() {
    const d = Store.defaultStart();
    if (!d) return;
    if (!PI.start.getValue()) PI.start.setValue(d);
    if (!PI.m2start.getValue()) PI.m2start.setValue(d);
  })();

  // ── 즐겨찾기 모달 ──────────────────────────────────────
  const favModal = document.getElementById('favModal');
  const favLabelInput = document.getElementById('favLabel');
  let favPlacePI = null;
  let favEditing = null; // null=추가, {id,...}=편집

  function openFavModal({ preset = null, editing = null } = {}) {
    favEditing = editing;
    document.getElementById('favModalTitle').textContent = editing ? '즐겨찾기 편집' : '즐겨찾기 추가';
    favLabelInput.value = editing?.label || '';
    const placeHolder = document.querySelector('#favPlaceField .place-input');
    favPlacePI = PlaceInput.create(placeHolder, { placeholder: '장소 검색' });
    if (preset) favPlacePI.setValue(preset);
    else if (editing) favPlacePI.setValue({ name: editing.name, lon: editing.lon, lat: editing.lat, address: editing.address || '' });
    favModal.hidden = false;
    setTimeout(() => favLabelInput.focus(), 60);
  }
  function closeFavModal() { favModal.hidden = true; favEditing = null; }

  document.getElementById('favAddBtn').addEventListener('click', () => {
    if (Store.list().length >= Store.MAX_FAVS) return toast(`즐겨찾기는 최대 ${Store.MAX_FAVS}개까지`);
    openFavModal({});
  });
  document.getElementById('favCancel').addEventListener('click', closeFavModal);
  document.getElementById('favSave').addEventListener('click', () => {
    const label = favLabelInput.value.trim();
    if (!label) return toast('별칭을 입력하세요');
    const place = favPlacePI?.getValue();
    if (!place) return toast('장소를 검색해 선택하세요');
    if (favEditing) {
      Store.update(favEditing.id, { label, name: place.name, lon: place.lon, lat: place.lat, address: place.address || '' });
      toast('즐겨찾기 수정됨');
    } else {
      const r = Store.add({ label, name: place.name, lon: place.lon, lat: place.lat, address: place.address || '' });
      if (!r.ok) return toast(r.error);
      toast('즐겨찾기 추가됨');
    }
    closeFavModal();
    renderFavorites();
    refreshAllBars();
  });

  // 메인 즐겨찾기 그리드
  function renderFavorites() {
    const grid = document.getElementById('favGrid');
    const cntEl = document.getElementById('favCount');
    const favs = Store.list();
    cntEl.textContent = `${favs.length}/${Store.MAX_FAVS}`;
    grid.innerHTML = favs.map((f) => `
      <div class="fav-item" data-id="${f.id}">
        <span>${iconOf(f.label)}</span>
        <span class="lbl">${escapeHtml(f.label)}</span>
        <button type="button" class="ico-btn ico-edit" data-act="edit" title="편집">✎</button>
        <button type="button" class="ico-btn ico-del"  data-act="del"  title="삭제">✕</button>
      </div>`).join('');
  }
  document.getElementById('favGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.fav-item')?.dataset.id;
    const fav = Store.list().find((f) => f.id === id);
    if (!fav) return;
    if (btn.dataset.act === 'del') {
      if (confirm(`"${fav.label}" 즐겨찾기를 삭제할까요?`)) {
        Store.remove(id);
        renderFavorites();
        refreshAllBars();
        toast('삭제됨');
      }
    } else if (btn.dataset.act === 'edit') {
      openFavModal({ editing: fav });
    }
  });

  // ── 카테고리 칩 (메뉴1 키워드) ─────────────────────────
  const m1kw = document.getElementById('m1-keyword');
  ['스타벅스', '카페', '주유소', '편의점', '약국', '주차장'].forEach((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = c;
    chip.addEventListener('click', () => (m1kw.value = c));
    document.getElementById('m1-chips').appendChild(chip);
  });

  // ── 메뉴 1 ─────────────────────────────────────────────
  let m1State = { results: [], start: null, dest: null, selectedIdx: -1 };
  const m1ResultEl = document.getElementById('m1-result');
  const m1MapEl = document.getElementById('m1-map');
  const m1MapHome = m1MapEl.parentElement;

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
    const markers = [{ lon: m1State.start.lon, lat: m1State.start.lat, label: '출발', role: 'start' }];
    if (r.poi) markers.push({ lon: r.poi.lon, lat: r.poi.lat, label: '경유', role: 'via' });
    markers.push({ lon: m1State.dest.lon, lat: m1State.dest.lat, label: '도착', role: 'end' });
    MapView.draw('m1-map', { mapKey: cfg.mapKey, path: r.path, markers });
  }
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

    const btn = document.getElementById('m1-run');
    btn.disabled = true;
    if (m1MapEl.parentElement !== m1MapHome) m1MapHome.appendChild(m1MapEl);
    m1MapEl.hidden = true;
    m1ResultEl.innerHTML = '';
    const time = document.getElementById('m1-time').value;
    const predictionType = document.getElementById('m1-ptype').value;

    try {
      // 키워드 비어있으면 → 직접 경로만 1회 조회
      if (!keyword) {
        btn.innerHTML = '<span class="spinner"></span>직접 경로 계산 중…';
        const r = await Api.route({ start, dest, waypoints: [], time, predictionType });
        m1State = { results: [{ poi: null, totalTime: r.totalTime, totalDistance: r.totalDistance, path: r.path }], start, dest, selectedIdx: -1 };
        m1ResultEl.innerHTML = `
          <div class="res-card clickable best" data-idx="0">
            <div class="res-rank">직접 경로<span class="badge">경유지 없음</span><span class="tap-hint">탭하면 지도</span></div>
            <div class="res-name">${escapeHtml(start.name)} → ${escapeHtml(dest.name)}</div>
            <div class="res-time">${r.timeText || fmtMinAbs(r.totalTime)} · ${km(r.totalDistance)}</div>
          </div>`;
        m1DrawSelected(0);
        return;
      }

      // 경유지 후보 비교
      btn.innerHTML = '<span class="spinner"></span>경유지별 시간 계산 중…';
      const { results, best, baseline } = await Api.minWaypoint({
        start, dest, keyword, time, predictionType, maxCandidates: 5,
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
      m1ResultEl.innerHTML = baselineCard + results.map((r, i) => {
        if (r.error) {
          return `<div class="res-card" data-idx="${i}" data-err="1">
            <div class="res-rank">${i + 1}순위</div>
            <div class="res-name">${escapeHtml(r.poi.name)}</div>
            <div class="res-meta">${escapeHtml(r.poi.address || '')}</div>
            <div class="res-meta" style="color:#b91c1c">계산 실패: ${escapeHtml(r.error)}</div></div>`;
        }
        const isBest = best && r.poi.name === best.poi.name && r.totalTime === best.totalTime;
        const extra = extraBadgeHtml(r.extraSeconds);
        return `<div class="res-card clickable ${isBest ? 'best' : ''}" data-idx="${i}">
          <div class="res-rank">${i + 1}순위${isBest ? '<span class="badge">최단</span>' : ''}<span class="tap-hint">탭하면 지도</span></div>
          <div class="res-name">${escapeHtml(r.poi.name)}</div>
          <div class="res-meta">${escapeHtml(r.poi.address || '')}</div>
          <div class="res-time">${r.timeText} · ${km(r.totalDistance)}${extra}</div>
        </div>`;
      }).join('');
      const initIdx = results.findIndex((r) => !r.error && r.totalTime != null);
      if (initIdx >= 0) m1DrawSelected(initIdx);
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '조회 / 최적 경유지 찾기';
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
    // 경유지에도 즐겨찾기 칩 부착 (현위치 X, 저장 X)
    attachFavoritesBar(pi, holder, { withCurrent: false, withSave: false }).render();
    const ref = { pi, row };
    wpInputs.push(ref);
    del.addEventListener('click', () => {
      wpWrap.removeChild(row);
      const idx = wpInputs.indexOf(ref);
      if (idx >= 0) wpInputs.splice(idx, 1);
    });
  }
  document.getElementById('m2-add').addEventListener('click', addWaypoint);
  addWaypoint();

  // ── 메뉴 2 실행 ────────────────────────────────────────
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
      const header = `<div class="hint">${combinations}가지 순서를 모두 계산 — 시간 짧은 순으로 정렬. 카드 탭하면 그 순서의 지도가 펼쳐집니다.</div>`;
      m2ResultEl.innerHTML = header + results.map((r, i) => {
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
      }).join('');
      const initIdx = results.findIndex((r) => !r.error && r.totalTime != null);
      if (initIdx >= 0) m2DrawSelected(initIdx);
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '최적 순서 계산';
    }
  });

  // ── 부팅 ────────────────────────────────────────────────
  (async function boot() {
    try {
      cfg = await Api.config();
      if (!cfg.hasKey) toast('TMAP 키 미설정 — .env 에 키를 넣어주세요');
    } catch {
      toast('서버 설정을 불러오지 못했어요');
    }
    renderFavorites();
    refreshAllBars();
    showView('home');
    // 환영카드: 날짜/날씨/배경 (비동기, 실패해도 무관)
    WeatherView.load(
      document.getElementById('weatherBg'),
      document.getElementById('welcomeInfo'),
      document.getElementById('welcomeGreeting'),
    ).catch(() => {});
  })();
})();
