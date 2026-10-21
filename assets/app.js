(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const norm = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const typeName = type => ({
    FO: 'Formularios (FO)',
    PR: 'Procedimientos (PR)',
    MF: 'Manuales de funciones (MF)',
    Otros: 'Otros documentos',
  }[type] || type);
  const dataURL = 'data/procedimientos-iso.json';
  const modal = $('#modal');
  const viewer = $('#viewer');
  let documents = [];
  let renderToken = 0;

  addEventListener('mousemove', event => {
    const glow = $('#cg');
    if (glow) {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }
  });

  function fillFilter(id, values, label) {
    const select = $(id);
    const options = [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
    select.innerHTML = `<option value="">${label}</option>${options.map(value => {
      const displayValue = id === '#type' ? typeName(value) : value;
      return `<option value="${esc(value)}">${esc(displayValue)}</option>`;
    }).join('')}`;
  }

  function initFilters() {
    fillFilter('#folder', documents.map(item => item.carpeta), 'Todas las carpetas');
    fillFilter('#type', documents.map(item => item.tipo), 'Todos los tipos');
    fillFilter('#area', documents.map(item => item.area), 'Todas las áreas');
    fillFilter('#version', documents.map(item => item.version), 'Todas las versiones');
  }

  function getResults() {
    const words = norm($('#q').value.trim()).split(/\s+/).filter(Boolean);
    const folder = $('#folder').value;
    const type = $('#type').value;
    const area = $('#area').value;
    const version = $('#version').value;
    const sort = $('#sort').value;
    return documents.filter(item => {
      const text = norm([
        item.nombre, item.codigo, item.carpeta,
        typeName(item.tipo), item.area, item.version, item.formato,
      ].join(' '));
      return (!folder || item.carpeta === folder)
        && (!type || item.tipo === type)
        && (!area || item.area === area)
        && (!version || item.version === version)
        && words.every(word => text.includes(word));
    }).sort((a, b) => {
      if (sort === 'codigo') {
        return (a.codigo || '\uffff').localeCompare(b.codigo || '\uffff', 'es');
      }
      return norm(a[sort]).localeCompare(norm(b[sort]), 'es');
    });
  }

  function render() {
    const results = getResults();
    $('#count').innerHTML = `<b>${results.length}</b> ${results.length === 1 ? 'documento' : 'documentos'}`;
    $('#grid').innerHTML = results.length ? results.map((item, index) => `
      <button class="card document-card" type="button" data-index="${index}" aria-label="Ver ${esc(item.nombre)}">
        <span class="tag">${esc(typeName(item.tipo))}${item.area !== 'Sin área' ? ` · ${esc(item.area)}` : ''}</span>
        <h3>${esc(item.nombre)}</h3>
        ${item.codigo ? `<p class="doc-code">Código: <strong>${esc(item.codigo)}</strong></p>` : ''}
        <div class="meta"><span>${esc(item.carpeta)}</span><span>${esc(item.formato.slice(1).toUpperCase())} · Ver documento →</span></div>
      </button>`).join('') : '<div class="empty">No hay documentos que coincidan. Pruebe con otro código o limpie los filtros.</div>';
  }

  async function loadDocuments() {
    const response = await fetch(dataURL);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el catálogo (${response.status}).`);
    }
    const catalog = await response.json();
    if (!Array.isArray(catalog)) {
      throw new Error('El catálogo de documentos tiene un formato no válido.');
    }
    documents = catalog;
    initFilters();
    render();
  }

  function openDocument(item) {
    const row = (label, value) => value
      ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`
      : '';
    const href = new URL(item.ruta, location.href).href;
    const isPDF = item.formato === '.pdf';
    const formatLabel = item.formato.slice(1).toUpperCase();
    $('#side').innerHTML = `
      <span class="tag">${esc(typeName(item.tipo))}${item.area !== 'Sin área' ? ` · ${esc(item.area)}` : ''}</span>
      <h2 id="document-title">${esc(item.nombre)}</h2>
      <dl>${row('Código', item.codigo)}${row('Carpeta', item.carpeta)}
      ${row('Área', item.area)}${row('Versión', item.version)}
      ${row('Formato', formatLabel)}</dl>
      <div class="document-actions">
        <a class="download-btn" href="${esc(href)}" download="${esc(item.nombre)}">Descargar documento</a>
        <a class="open-link" href="${esc(href)}" target="_blank" rel="noopener">Abrir archivo en otra pestaña</a>
      </div>`;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (isPDF) {
      viewPDF(href, item.nombre);
    } else if (item.formato === '.docx') {
      viewDOCX(href, item.nombre);
    } else if (item.formato === '.xlsx') {
      viewXLSX(href, item.nombre);
    } else {
      showPreviewError('La vista previa no está disponible para este formato.');
    }
  }

  function closeModal() {
    renderToken++;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    viewer.innerHTML = '';
  }

  async function viewPDF(url, filename) {
    const token = ++renderToken;
    viewer.scrollTop = 0;
    viewer.innerHTML = '<div class="vmsg">Cargando documento…</div>';
    try {
      if (typeof pdfjsLib === 'undefined') {
        throw new Error('No se cargó el visor PDF del sitio.');
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        new URL('assets/vendor/pdf.worker.min.js', location.href).href;
      const pdf = await pdfjsLib.getDocument({ url, isEvalSupported: false }).promise;
      if (token !== renderToken) return;
      viewer.innerHTML = `<div class="vbar"><span>${pdf.numPages} páginas · ${esc(filename)}</span></div><div class="pages" id="pages"></div>`;
      const pages = $('#pages');
      const placeholders = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'pg-ph';
        placeholder.textContent = `Página ${pageNumber}`;
        placeholder.dataset.page = pageNumber;
        pages.appendChild(placeholder);
        placeholders.push(placeholder);
      }

      const renderPage = async placeholder => {
        const page = await pdf.getPage(Number(placeholder.dataset.page));
        if (token !== renderToken) return;
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar el visor de páginas.');
        await page.render({ canvasContext: context, viewport }).promise;
        if (token === renderToken) placeholder.replaceWith(canvas);
      };

      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            renderPage(entry.target).catch(error => {
              console.error('No se pudo mostrar una página del PDF:', error);
              if (token === renderToken) entry.target.textContent = 'No se pudo mostrar esta página.';
            });
          });
        }, { root: viewer, rootMargin: '800px 0px' });
        placeholders.forEach(placeholder => observer.observe(placeholder));
      } else {
        for (const placeholder of placeholders) await renderPage(placeholder);
      }
    } catch (error) {
      console.error('No se pudo abrir el documento PDF:', url, error);
      if (token === renderToken) {
        viewer.innerHTML = `<div class="vmsg"><b>No se pudo abrir el PDF</b>${esc(error.message || error)}</div>`;
      }
    }
  }

  function showPreviewError(message, token = renderToken) {
    if (token !== renderToken) return;
    const messageBox = document.createElement('div');
    messageBox.className = 'vmsg';
    const title = document.createElement('b');
    title.textContent = 'No se pudo mostrar la vista previa';
    messageBox.append(title, document.createTextNode(message));
    viewer.replaceChildren(messageBox);
  }

  async function loadOfficeFile(url, token) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el archivo (${response.status}).`);
    }
    const buffer = await response.arrayBuffer();
    if (token !== renderToken) return null;
    return buffer;
  }

  async function viewDOCX(url, filename) {
    const token = ++renderToken;
    viewer.scrollTop = 0;
    viewer.innerHTML = '<div class="vmsg">Preparando vista previa del documento…</div>';
    try {
      if (typeof mammoth === 'undefined' || typeof DOMPurify === 'undefined') {
        throw new Error('No se cargaron las herramientas de vista previa DOCX.');
      }
      const buffer = await loadOfficeFile(url, token);
      if (!buffer) return;
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      if (token !== renderToken) return;

      const content = document.createElement('article');
      content.className = 'office-docx';
      content.innerHTML = DOMPurify.sanitize(result.value, {
        ALLOWED_TAGS: [
          'a', 'blockquote', 'br', 'caption', 'div', 'em', 'h1', 'h2', 'h3',
          'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'strong', 'table', 'tbody',
          'td', 'th', 'thead', 'tr', 'u', 'ul',
        ],
        ALLOWED_ATTR: ['href', 'colspan', 'rowspan'],
      });
      if (!content.childElementCount && !content.textContent.trim()) {
        throw new Error('El documento no contiene texto que se pueda previsualizar.');
      }
      const toolbar = document.createElement('div');
      toolbar.className = 'vbar';
      toolbar.textContent = `Vista previa DOCX · ${filename}`;
      viewer.replaceChildren(toolbar, content);
      if (result.messages.length) {
        console.info(`El documento "${filename}" tiene elementos que no se muestran en la vista previa.`, result.messages);
      }
    } catch (error) {
      console.error('No se pudo previsualizar el documento DOCX:', url, error);
      showPreviewError(`${error.message || error} Puede descargar el documento original.`, token);
    }
  }

  async function viewXLSX(url, filename) {
    const token = ++renderToken;
    viewer.scrollTop = 0;
    viewer.innerHTML = '<div class="vmsg">Preparando vista previa de la hoja de cálculo…</div>';
    try {
      if (typeof XLSX === 'undefined') {
        throw new Error('No se cargó la herramienta de vista previa XLSX.');
      }
      const buffer = await loadOfficeFile(url, token);
      if (!buffer) return;
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (token !== renderToken) return;
      if (!workbook.SheetNames.length) {
        throw new Error('El archivo no contiene hojas para mostrar.');
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'vbar office-toolbar';
      const title = document.createElement('span');
      title.textContent = `Vista previa XLSX · ${filename}`;
      const tabs = document.createElement('div');
      tabs.className = 'sheet-tabs';
      toolbar.append(title, tabs);

      const content = document.createElement('div');
      content.className = 'office-sheet-wrap';
      const renderSheet = sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false,
        });
        const table = document.createElement('table');
        table.className = 'office-sheet';
        const body = document.createElement('tbody');
        const maxRows = 1000;
        const maxColumns = 40;
        rows.slice(0, maxRows).forEach(row => {
          const tr = document.createElement('tr');
          row.slice(0, maxColumns).forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = String(value ?? '');
            tr.appendChild(cell);
          });
          if (tr.childElementCount) body.appendChild(tr);
        });
        table.appendChild(body);

        const note = document.createElement('p');
        note.className = 'sheet-note';
        if (rows.length > maxRows) {
          note.textContent = `Vista previa limitada a las primeras ${maxRows} filas. Descargue el archivo para consultar todas las filas.`;
        } else if (rows.some(row => row.length > maxColumns)) {
          note.textContent = `Vista previa limitada a las primeras ${maxColumns} columnas por fila. Descargue el archivo para consultar todas las columnas.`;
        }
        content.replaceChildren(table);
        if (note.textContent) content.appendChild(note);
        tabs.querySelectorAll('button').forEach(button => {
          const active = button.dataset.sheet === sheetName;
          button.classList.toggle('on', active);
          button.setAttribute('aria-pressed', String(active));
        });
      };

      workbook.SheetNames.forEach(sheetName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sheet-tab';
        button.textContent = sheetName;
        button.dataset.sheet = sheetName;
        button.setAttribute('aria-label', `Mostrar hoja ${sheetName}`);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => renderSheet(sheetName));
        tabs.appendChild(button);
      });
      viewer.replaceChildren(toolbar, content);
      renderSheet(workbook.SheetNames[0]);
    } catch (error) {
      console.error('No se pudo previsualizar el archivo XLSX:', url, error);
      showPreviewError(`${error.message || error} Puede descargar el documento original.`, token);
    }
  }

  $('#q').addEventListener('input', render);
  ['#folder', '#type', '#area', '#version', '#sort'].forEach(selector => {
    $(selector).addEventListener('change', render);
  });
  $('#reset').addEventListener('click', () => {
    $('#q').value = '';
    ['#folder', '#type', '#area', '#version'].forEach(selector => {
      $(selector).value = '';
    });
    $('#sort').value = 'nombre';
    render();
  });
  $('#grid').addEventListener('click', event => {
    const card = event.target.closest('.document-card');
    if (card) openDocument(getResults()[Number(card.dataset.index)]);
  });
  $('#close').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', event => {
    if (event.target === modal) closeModal();
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });

  loadDocuments().catch(error => {
    console.error('No se pudo cargar la biblioteca ISO:', error);
    $('#count').textContent = 'No se pudo cargar el catálogo de documentos.';
    $('#grid').innerHTML = '<div class="empty">No se pudo cargar la biblioteca. Intente nuevamente más tarde.</div>';
  });
})();
