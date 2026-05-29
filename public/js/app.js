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
    // 기록 탭은 메뉴1/2 에서만 노출
    const histTabEl = document.getElementById('histTab');
    if (histTabEl) histTabEl.hidden = !(name === 'menu1' || name === 'menu2');
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

  // ── 외부 길안내 앱 URL 빌더 ──────────────────────────────
  // 모두 모바일에서 해당 앱이 설치돼 있어야 열림 (없으면 OS 가 안내)
  function buildTmapUrl({ start, dest, waypoints = [] }) {
    const p = new URLSearchParams();
    if (start) { p.set('rStName', start.name || '출발'); p.set('rStX', start.lon); p.set('rStY', start.lat); }
    p.set('rGoName', dest.name || '도착'); p.set('rGoX', dest.lon); p.set('rGoY', dest.lat);
    waypoints.slice(0, 5).forEach((w, i) => {
      const n = i + 1;
      p.set(`rV${n}Name`, w.name || `경유${n}`);
      p.set(`rV${n}X`, w.lon);
      p.set(`rV${n}Y`, w.lat);
    });
    return `tmap://route?${p.toString()}`;
  }
  function buildNaverUrl({ start, dest, waypoints = [] }) {
    const p = new URLSearchParams();
    if (start) { p.set('slat', start.lat); p.set('slng', start.lon); p.set('sname', start.name || '출발'); }
    p.set('dlat', dest.lat); p.set('dlng', dest.lon); p.set('dname', dest.name || '도착');
    waypoints.slice(0, 5).forEach((w, i) => {
      const n = i + 1;
      p.set(`v${n}lat`, w.lat); p.set(`v${n}lng`, w.lon); p.set(`v${n}name`, w.name || `경유${n}`);
    });
    p.set('appname', location.host || 'com.smartnav.app');
    return `nmap://route/car?${p.toString()}`;
  }
  function buildKakaoUrl({ start, dest, waypoints = [] }) {
    const p = new URLSearchParams();
    if (start) p.set('sp', `${start.lat},${start.lon}`);
    p.set('ep', `${dest.lat},${dest.lon}`);
    p.set('by', 'car');
    waypoints.slice(0, 5).forEach((w, i) => {
      const key = i === 0 ? 'vp' : `vp${i + 1}`;
      p.set(key, `${w.lat},${w.lon}`);
    });
    return `kakaomap://route?${p.toString()}`;
  }
  function renderNavApps(container, payload) {
    container.innerHTML = `
      <p class="nav-apps-title">선택한 경로 그대로 길안내</p>
      <div class="nav-apps-row">
        <a class="nav-app nav-tmap"  href="${buildTmapUrl(payload)}">T맵</a>
        <a class="nav-app nav-naver" href="${buildNaverUrl(payload)}">네이버</a>
        <a class="nav-app nav-kakao" href="${buildKakaoUrl(payload)}">카카오맵</a>
      </div>`;
    container.hidden = false;
  }

  // ── 시간 입력: 10분 라운딩 + 한글 포맷 표시 (네이티브 input 은 투명) ──
  // 현재 시각의 "다음 10분 슬롯" (과거시간 차단용 기준)
  function localDtCeil(date = new Date(), roundMin = 10) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    const ceil = Math.ceil(d.getMinutes() / roundMin) * roundMin;
    if (ceil >= 60) { d.setHours(d.getHours() + 1); d.setMinutes(0); }
    else d.setMinutes(ceil);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // 사용자 입력을 가장 가까운 10분 슬롯으로 라운딩 (포맷팅용)
  function localDtString(date = new Date(), roundMin = 10) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    d.setMinutes(Math.round(d.getMinutes() / roundMin) * roundMin);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDtPretty(value) {
    if (!value) return ['—', '—'];
    const d = new Date(value);
    if (isNaN(d.getTime())) return ['—', '—'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dt0 = new Date(d); dt0.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((dt0 - today) / 86400000);
    let dateLabel;
    if (dayDiff === 0)      dateLabel = '오늘';
    else if (dayDiff === 1) dateLabel = '내일';
    else if (dayDiff === -1) dateLabel = '어제';
    else                    dateLabel = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    const dateFull = `${dateLabel} (${WEEKDAYS[d.getDay()]})`;
    const h = d.getHours();
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h % 12 || 12;
    const timeFull = `${ampm} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`;
    return [dateFull, timeFull];
  }
  function bindDtWrap(wrap) {
    const inp = wrap.querySelector('.dt-native');
    const dateEl = wrap.querySelector('.dt-d-date');
    const timeEl = wrap.querySelector('.dt-d-time');
    function sync() {
      const [d, t] = fmtDtPretty(inp.value);
      dateEl.textContent = d;
      timeEl.textContent = t;
    }
    function refreshMin() { inp.min = localDtCeil(); }
    function ensureFuture() {
      refreshMin();
      if (!inp.value) { inp.value = inp.min; return; }
      // 10분 단위로 라운딩하고 min 보다 작으면 min 으로 끌어올린다
      let v = localDtString(new Date(inp.value));
      if (v < inp.min) {
        toast('과거 시각은 선택할 수 없어요');
        v = inp.min;
      }
      if (v !== inp.value) inp.value = v;
    }
    inp.addEventListener('change', () => { ensureFuture(); sync(); });
    inp.addEventListener('focus', refreshMin);
    refreshMin();
    if (!inp.value) inp.value = inp.min;
    sync();
  }
  // 기본값을 "다음 10분 슬롯"으로 채우고 wrap 바인딩 (과거 시각 차단)
  document.getElementById('m1-time').value = localDtCeil();
  document.getElementById('m2-time').value = localDtCeil();
  document.querySelectorAll('.dt-wrap').forEach(bindDtWrap);

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
    // 메뉴2 경유지 입력은 holderEl 의 부모가 .wp-row (display:flex) 라서, 거기 직접 끼우면
    // fav-bar 가 flex 자식으로 들어가 텍스트박스를 옆에서 짜부러뜨림.
    // → wp-row 바깥(=다음 형제)으로 올려서 입력 한 줄 아래에 깔리게 함.
    const wpRow = holderEl.closest('.wp-row');
    const anchor = wpRow || holderEl;
    anchor.parentElement.insertBefore(row, anchor.nextSibling);
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
          addChip(row, '⭐ 즐겨찾기 추가', () => {
            showView('favs');
            showFavForm({ preset: cur });
          }).classList.add('chip-save');
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

  // ── 즐겨찾기 추가/편집 (인라인 폼 — 모달 사용 안 함) ──
  const favForm = document.getElementById('favForm');
  const favFormTitle = document.getElementById('favFormTitle');
  const favLabelInput = document.getElementById('favLabel');
  let favPlacePI = null;
  let favEditing = null;

  function showFavForm({ preset = null, editing = null } = {}) {
    favEditing = editing;
    favFormTitle.textContent = editing ? '즐겨찾기 편집' : '새 즐겨찾기';
    favLabelInput.value = editing?.label || '';
    const placeHolder = document.querySelector('#favPlaceField .place-input');
    favPlacePI = PlaceInput.create(placeHolder, { placeholder: '장소 검색' });
    if (preset) favPlacePI.setValue(preset);
    else if (editing) favPlacePI.setValue({ name: editing.name, lon: editing.lon, lat: editing.lat, address: editing.address || '' });
    favForm.hidden = false;
    setTimeout(() => { try { favLabelInput.focus(); } catch {} }, 60);
    favForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function hideFavForm() {
    favForm.hidden = true;
    favEditing = null;
    favPlacePI = null;
  }

  document.getElementById('favAddBtn').addEventListener('click', () => {
    if (Store.list().length >= Store.MAX_FAVS) return toast(`즐겨찾기는 최대 ${Store.MAX_FAVS}개까지`);
    showFavForm({});
  });
  document.getElementById('favCancel').addEventListener('click', hideFavForm);
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
    hideFavForm();
    renderFavorites();
    refreshAllBars();
  });

  // 즐겨찾기 화면을 떠나면 폼도 닫기
  document.querySelectorAll('[data-go="home"], #backBtn').forEach((b) => {
    b.addEventListener('click', hideFavForm);
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
      showFavForm({ editing: fav });
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

  // ── 검색 anchor (출발지 중심 / 도착지 중심) ─────────────
  let m1Anchor = 'start';
  const m1AnchorEl = document.getElementById('m1-anchor');
  m1AnchorEl.addEventListener('click', (e) => {
    const opt = e.target.closest('.ax-opt');
    if (!opt) return;
    m1Anchor = opt.dataset.anchor === 'dest' ? 'dest' : 'start';
    m1AnchorEl.querySelectorAll('.ax-opt').forEach((b) => {
      const on = b.dataset.anchor === m1Anchor;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  });

  // ── 메뉴 1 ─────────────────────────────────────────────
  let m1State = { results: [], start: null, dest: null, selectedIdx: -1 };
  const m1ResultEl = document.getElementById('m1-result');
  const m1MapEl = document.getElementById('m1-map');
  const m1NavEl = document.getElementById('m1-nav');
  const m1MapHome = m1MapEl.parentElement;
  const m1NavHome = m1NavEl.parentElement;

  function m1MoveMapUnder(card) {
    if (!card || !m1MapEl) return;
    if (card.nextElementSibling !== m1MapEl) card.after(m1MapEl);
    // nav 버튼은 항상 지도 바로 뒤에 따라붙는다
    if (m1MapEl.nextElementSibling !== m1NavEl) m1MapEl.after(m1NavEl);
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
    renderNavApps(m1NavEl, {
      start: m1State.start,
      dest: m1State.dest,
      waypoints: r.poi ? [r.poi] : [],
    });
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
    // 어떤 보조 동작(기록 저장 등)도 클릭 핸들러를 죽이면 안 됨 — 모두 try 안에서
    try {
      // 검색 기록 저장 (시간 제외) — 실패해도 핵심 흐름은 계속
      try { Store.histAdd({ kind: 'menu1', start, dest, keyword, predictionType: document.getElementById('m1-ptype').value }); } catch {}
    if (m1MapEl.parentElement !== m1MapHome) m1MapHome.appendChild(m1MapEl);
    if (m1NavEl.parentElement !== m1NavHome) m1NavHome.appendChild(m1NavEl);
    m1MapEl.hidden = true;
    m1NavEl.hidden = true;
    m1ResultEl.innerHTML = '';
    const time = document.getElementById('m1-time').value;
    const predictionType = document.getElementById('m1-ptype').value;

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
      const { results, best, baseline, note } = await Api.minWaypoint({
        start, dest, keyword, time, predictionType, maxCandidates: 5,
        anchor: m1Anchor,
      });
      if (!results.length) {
        m1ResultEl.innerHTML = `<div class="hint">${escapeHtml(note || '근처에서 후보를 찾지 못했어요. 키워드를 바꿔보세요.')}</div>`;
        return;
      }
      // 60% 반대편 폴백 안내문 (서버가 tier=3 일 때만 채워줌)
      const noteHtml = note ? `<div class="result-note">⚠️ ${escapeHtml(note)}</div>` : '';
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
      m1ResultEl.innerHTML = noteHtml + baselineCard + results.map((r, i) => {
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
  const m2NavEl = document.getElementById('m2-nav');
  const m2MapHome = m2MapEl.parentElement;
  const m2NavHome = m2NavEl.parentElement;

  function m2MoveMapUnder(card) {
    if (!card || !m2MapEl) return;
    if (card.nextElementSibling !== m2MapEl) card.after(m2MapEl);
    if (m2MapEl.nextElementSibling !== m2NavEl) m2MapEl.after(m2NavEl);
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
    renderNavApps(m2NavEl, {
      start: m2State.start,
      dest: m2State.dest,
      waypoints: r.order,
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
    try {
      // 검색 기록 저장 — 실패해도 핵심 흐름은 계속
      try { Store.histAdd({ kind: 'menu2', start, dest, waypoints, predictionType: document.getElementById('m2-ptype').value }); } catch {}
    if (m2MapEl.parentElement !== m2MapHome) m2MapHome.appendChild(m2MapEl);
    if (m2NavEl.parentElement !== m2NavHome) m2NavHome.appendChild(m2NavEl);
    m2MapEl.hidden = true;
    m2NavEl.hidden = true;
    m2ResultEl.innerHTML = '';
      const { results, best } = await Api.optimize({
        start, dest, waypoints,
        time: document.getElementById('m2-time').value,
        predictionType: document.getElementById('m2-ptype').value,
      });
      if (!results?.length || !best) {
        m2ResultEl.innerHTML = '<div class="hint">경로를 계산하지 못했어요.</div>';
        return;
      }
      m2State = { results, start, dest, selectedIdx: -1 };
      // 백엔드가 routeOptimization10 한 번으로 TMAP 최적 순서를 받아오므로 결과는 1개.
      // (옛 N! brute-force 와 같은 응답 shape 를 유지해서 카드 렌더링 로직은 그대로.)
      const header = `<div class="hint">TMAP 가 계산한 최적 방문 순서예요. 카드 탭하면 지도가 펼쳐집니다.</div>`;
      m2ResultEl.innerHTML = header + results.map((r, i) => {
        const seqParts = ['<b>출발</b>'];
        r.order.forEach((w, j) => seqParts.push(`<b>경유${j + 1}</b> <span style="color:#6b7280">(${escapeHtml(w.name)})</span>`));
        seqParts.push('<b>도착</b>');
        const seq = seqParts.join(' → ');
        if (r.error) {
          return `<div class="res-card" data-idx="${i}" data-err="1">
            <div class="res-rank">최적 순서</div>
            <div class="res-name" style="font-size:13px;font-weight:500">${seq}</div>
            <div class="res-meta" style="color:#b91c1c">계산 실패: ${escapeHtml(r.error)}</div></div>`;
        }
        return `<div class="res-card clickable best" data-idx="${i}">
          <div class="res-rank">최적 순서<span class="badge">TMAP 추천</span><span class="tap-hint">탭하면 지도</span></div>
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

  // ── 검색 기록 패널 ──────────────────────────────────────
  const histPanel = document.getElementById('histPanel');
  const histBackdrop = document.getElementById('histBackdrop');
  const histListEl = document.getElementById('histList');
  const histEmptyEl = document.getElementById('histEmpty');
  const histCountEl = document.getElementById('histCount');

  function openHistPanel() {
    renderHistory();
    histPanel.hidden = false;
    histBackdrop.hidden = false;
    histPanel.setAttribute('aria-hidden', 'false');
  }
  function closeHistPanel() {
    histPanel.hidden = true;
    histBackdrop.hidden = true;
    histPanel.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('histTab').addEventListener('click', openHistPanel);
  document.getElementById('histClose').addEventListener('click', closeHistPanel);
  histBackdrop.addEventListener('click', closeHistPanel);
  document.getElementById('histClearAll').addEventListener('click', () => {
    if (!Store.histList().length) return;
    if (!confirm('모든 검색 기록을 삭제할까요?')) return;
    Store.histClear();
    renderHistory();
    toast('기록 삭제됨');
  });

  function tsLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = (n) => String(n).padStart(2, '0');
    if (sameDay) return `오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function renderHistory() {
    const entries = Store.histList();
    histCountEl.textContent = entries.length;
    histEmptyEl.style.display = entries.length === 0 ? 'block' : 'none';
    histListEl.style.display = entries.length === 0 ? 'none' : 'block';
    histListEl.innerHTML = entries.map((e) => {
      let summary;
      if (e.kind === 'menu1') {
        summary = `${escapeHtml(e.start.name)} → ${escapeHtml(e.dest.name)}`;
        if (e.keyword) summary += ` <span style="color:var(--muted)">· "${escapeHtml(e.keyword)}"</span>`;
      } else {
        const wps = e.waypoints.map((w) => escapeHtml(w.name)).join(' → ');
        summary = `${escapeHtml(e.start.name)} → ${wps} → ${escapeHtml(e.dest.name)}`;
      }
      const kindLabel = e.kind === 'menu1' ? '📍 경유지 시간 비교' : '🔀 멀티 경유지 최적화';
      return `<div class="hist-item" data-id="${e.id}">
        <div class="h-kind">${kindLabel}</div>
        <div class="h-summary">${summary}</div>
        <div class="h-ts">${tsLabel(e.ts)}</div>
        <div class="h-actions">
          <button class="h-apply" data-act="apply">다시 검색</button>
          <button class="h-del" data-act="del" aria-label="삭제">✕</button>
        </div>
      </div>`;
    }).join('');
  }
  histListEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.hist-item')?.dataset.id;
    const e = Store.histList().find((x) => x.id === id);
    if (!e) return;
    if (btn.dataset.act === 'del') { Store.histRemove(id); renderHistory(); return; }
    if (btn.dataset.act === 'apply') applyHistory(e);
  });

  // dt-wrap 의 한글 표시를 강제로 다시 그리는 헬퍼
  function refreshAllDtDisplays() {
    document.querySelectorAll('.dt-wrap').forEach((w) => {
      const inp = w.querySelector('.dt-native');
      if (inp) inp.dispatchEvent(new Event('change'));
    });
  }

  function applyHistory(e) {
    closeHistPanel();
    if (e.kind === 'menu1') {
      showView('menu1');
      PI.start.setValue(e.start);
      PI.dest.setValue(e.dest);
      m1kw.value = e.keyword || '';
      document.getElementById('m1-ptype').value = e.predictionType || 'departure';
      document.getElementById('m1-time').value = localDtCeil();
    } else {
      showView('menu2');
      PI.m2start.setValue(e.start);
      PI.m2dest.setValue(e.dest);
      // 기존 경유지 입력 모두 제거 후 새로 추가
      while (wpInputs.length) {
        const ref = wpInputs.pop();
        if (ref.row.parentElement) ref.row.parentElement.removeChild(ref.row);
      }
      e.waypoints.forEach((w) => {
        addWaypoint();
        const last = wpInputs[wpInputs.length - 1];
        last.pi.setValue(w);
      });
      document.getElementById('m2-ptype').value = e.predictionType || 'departure';
      document.getElementById('m2-time').value = localDtCeil();
    }
    refreshAllDtDisplays();
    toast('이전 검색을 가져왔어요 (시간은 현재로 초기화)');
  }

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
