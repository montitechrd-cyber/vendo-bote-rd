(function () {
  const redirect = sessionStorage.getItem('vbr_redirect') || '/dashboard.html';

  // main.js es un <script defer> igual que este — en teoría carga primero, pero
  // se ha visto llegar tarde en algunos entornos; se espera en vez de asumirlo.
  function whenReady(fn) {
    if (window.VBR_getUser) fn();
    else setTimeout(() => whenReady(fn), 20);
  }

  whenReady(() => window.VBR_getUser().then(me => {
    if (!me) { location.href = '/auth.html'; return; }

    // Si ya completó el perfil antes, no tiene nada que hacer aquí.
    if (me.profile_completed) {
      location.href = me.role === 'admin' ? '/admin.html' : redirect;
      return;
    }
    // Precarga si ya había algo guardado (ej. volvió sin terminar)
    if (me.name) document.getElementById('cp-name').value = me.name;
    if (me.last_name) document.getElementById('cp-lastname').value = me.last_name;
    if (me.phone) document.getElementById('cp-phone').value = me.phone;
    if (me.id_number) document.getElementById('cp-idnumber').value = me.id_number;
  }));

  document.getElementById('cp-file').addEventListener('change', function () {
    const file = this.files[0];
    document.getElementById('cp-file-placeholder').style.display = file ? 'none' : 'block';
    const nameEl = document.getElementById('cp-file-name');
    nameEl.style.display = file ? 'block' : 'none';
    nameEl.textContent = file ? file.name : '';
  });

  document.getElementById('cp-submit').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const lastname = document.getElementById('cp-lastname').value.trim();
    const phone = document.getElementById('cp-phone').value.trim();
    const idnumber = document.getElementById('cp-idnumber').value.trim();
    const errEl = document.getElementById('cp-error');
    errEl.classList.add('hidden');

    if (!name || !lastname || !phone || !idnumber) {
      errEl.textContent = 'Nombre, apellido, teléfono y cédula o pasaporte son obligatorios.';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('cp-submit');
    btn.disabled = true; btn.textContent = 'Guardando...';

    const formData = new FormData();
    formData.append('name', name);
    formData.append('last_name', lastname);
    formData.append('phone', phone);
    formData.append('id_number', idnumber);
    const file = document.getElementById('cp-file').files[0];
    if (file) formData.append('id_document', file);

    try {
      const r = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      const data = await r.json();
      if (data.error) {
        errEl.textContent = data.error;
        errEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Continuar';
        return;
      }
      sessionStorage.removeItem('vbr_redirect');
      location.href = data.role === 'admin' ? '/admin.html' : redirect;
    } catch (e) {
      errEl.textContent = 'Error de conexión, intenta de nuevo.';
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Continuar';
    }
  });
})();
