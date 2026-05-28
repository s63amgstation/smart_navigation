// 자동완성 장소 입력 컴포넌트.
// container(div.place-input)에 마운트하고, 선택된 장소 {name,lon,lat,address} 를 보관한다.
window.PlaceInput = (function () {
  function create(container, opts = {}) {
    const placeholder = opts.placeholder || '장소 검색';
    let selected = null;
    let timer = null;

    const box = document.createElement('div');
    box.className = 'place-box';
    container.innerHTML = '';
    container.appendChild(box);

    function renderInput() {
      box.innerHTML = `
        <input class="text-input" placeholder="${placeholder}" autocomplete="off" />
        <div class="suggest" hidden></div>`;
      const input = box.querySelector('input');
      const list = box.querySelector('.suggest');

      input.addEventListener('input', () => {
        const kw = input.value.trim();
        clearTimeout(timer);
        if (kw.length < 2) {
          list.hidden = true;
          return;
        }
        timer = setTimeout(() => search(kw, list), 250);
      });
      // 바깥 클릭 시 닫기
      document.addEventListener('click', (e) => {
        if (!box.contains(e.target)) list.hidden = true;
      });
      input.focus?.();
    }

    async function search(kw, list) {
      list.hidden = false;
      list.innerHTML = '<div class="empty">검색 중…</div>';
      try {
        const { pois } = await Api.pois(kw);
        if (!pois.length) {
          list.innerHTML = '<div class="empty">결과가 없습니다</div>';
          return;
        }
        list.innerHTML = '';
        pois.forEach((p) => {
          const item = document.createElement('div');
          item.className = 'item';
          item.innerHTML = `<div class="nm">${escape(p.name)}</div><div class="ad">${escape(p.address || '')}</div>`;
          item.addEventListener('click', () => choose(p));
          list.appendChild(item);
        });
      } catch (e) {
        list.innerHTML = `<div class="empty">${escape(e.message)}</div>`;
      }
    }

    function choose(p) {
      selected = p;
      renderSelected();
      opts.onChange?.(selected);
    }

    function renderSelected() {
      box.innerHTML = `
        <div class="selected">
          <span class="nm">${escape(selected.name)}</span>
          <span class="x" role="button">✕</span>
        </div>`;
      box.querySelector('.x').addEventListener('click', () => {
        selected = null;
        renderInput();
        opts.onChange?.(null);
      });
    }

    function escape(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    renderInput();

    return {
      getValue: () => selected,
      setValue: (p) => {
        selected = p;
        if (p) renderSelected();
        else renderInput();
      },
      clear: () => {
        selected = null;
        renderInput();
      },
    };
  }

  return { create };
})();
