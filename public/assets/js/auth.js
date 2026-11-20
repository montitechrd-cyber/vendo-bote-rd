(function () {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  const verifyToken = params.get('verify');
  if (verifyToken) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  if (resetToken) { try { history.replaceState(null, '', location.pathname); } catch (e) {} } // el token no se queda en la barra ni en el historial
  const redirect = sessionStorage.getItem('vbr_redirect') || '/dashboard.html';
  const $ = (id) => document.getElementById(id);
  const msg = $('auth-msg');

  function show(type, text) { msg.className = 'auth-msg ' + type; msg.textContent = text; }
  function clearMsg() { msg.className = 'auth-msg hidden'; }
  function go(view) {
    clearMsg();
    document.querySelectorAll(".auth-view").forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    const first = document.querySelector('#view-' + view + ' input');
    if (first) first.focus();
  }

  async function post(path, body) {
    try {
      const r = await fetch('/api/auth/' + path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await r.json();
    } catch { return { error: 'Error de conexión, intenta de nuevo.' }; }
  }

  async function afterSignIn() {
    let me = null;
    try { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); me = r.ok ? await r.json() : null; } catch {}
    // El administrador no pasa por el onboarding de cliente.
    if (me && me.role !== 'admin' && !me.profile_completed) {
      sessionStorage.setItem('vbr_redirect', redirect);
      location.href = '/complete-profile.html';
      return;
    }
    sessionStorage.removeItem('vbr_redirect');
    location.href = me && me.role === 'admin' ? '/admin.html' : redirect;
  }

  async function submit(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Un momento...';
    clearMsg();
    try { await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const input = $(b.dataset.toggle);
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    b.textContent = hidden ? 'Ocultar' : 'Ver';
  }));

  $('view-login').addEventListener('submit', e => { e.preventDefault(); submit(e.target, async () => {
    const d = await post('login', { email: $('login-email').value, password: $('login-pass').value });
    if (d.error) return show('error', d.error);
    afterSignIn();
  }); });

  // Foto de perfil opcional: vista previa y recorte cuadrado a 400px antes de enviarla
  let regAvatarBlob = null;
  $('reg-photo-pick').addEventListener('click', () => $('reg-photo').click());
  $('reg-photo').addEventListener('change', async () => {
    const f = $('reg-photo').files[0]; regAvatarBlob = null;
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const side = Math.min(bmp.width, bmp.height), size = Math.min(400, side);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      regAvatarBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      $('reg-photo-circle').innerHTML = '<img alt="" src="' + c.toDataURL('image/jpeg', 0.7) + '" />';
    } catch { show('error', 'No se pudo leer la foto de perfil. Prueba con otra imagen.'); $('reg-photo').value = ''; }
  });

  $('view-register').addEventListener('submit', e => { e.preventDefault(); submit(e.target, async () => {
    const need = [['reg-name', 'tu nombre'], ['reg-last', 'tu apellido'], ['reg-email', 'tu correo'], ['reg-phone', 'tu teléfono'], ['reg-id', 'tu cédula o pasaporte'], ['reg-pass', 'una contraseña']];
    for (const [id, label] of need) {
      if (!$(id).value.trim()) { $(id).focus(); return show('error', 'Escribe ' + label + '.'); }
    }
    if ($('reg-pass').value.length < 8) { $('reg-pass').focus(); return show('error', 'La contraseña debe tener al menos 8 caracteres.'); }
    const doc = $('reg-doc').files[0];
    if (doc && doc.size > 10 * 1024 * 1024) return show('error', 'El documento supera los 10MB.');
    const fd = new FormData();
    fd.append('name', $('reg-name').value); fd.append('last_name', $('reg-last').value);
    fd.append('email', $('reg-email').value); fd.append('phone', $('reg-phone').value);
    fd.append('id_number', $('reg-id').value); fd.append('password', $('reg-pass').value);
    if (regAvatarBlob) fd.append('avatar', regAvatarBlob, 'perfil.jpg');
    if (doc) fd.append('id_document', doc);
    let d;
    try { d = await (await fetch('/api/auth/register', { method: 'POST', credentials: 'same-origin', body: fd })).json(); }
    catch { d = { error: 'Error de conexión, intenta de nuevo.' }; }
    if (d.error) return show('error', d.error);
    afterSignIn();
  }); });

  $('view-forgot').addEventListener('submit', e => { e.preventDefault(); submit(e.target, async () => {
    const d = await post('forgot', { email: $('forgot-email').value });
    if (d.error) return show('error', d.error);
    show('ok', 'Listo. Si el correo está registrado, te enviamos un enlace (revisa también el spam). Vale por 1 hora.');
  }); });

  $('view-reset').addEventListener('submit', e => { e.preventDefault(); submit(e.target, async () => {
    const d = await post('reset', { token: resetToken, password: $('reset-pass').value });
    if (d.error) return show('error', d.error);
    afterSignIn();
  }); });

  // Acceso con Google: se carga solo si el servidor lo tiene configurado
  fetch('/api/auth/config').then(r => r.json()).then(cfg => {
    if (!cfg || !cfg.googleClientId) return;
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = () => {
      if (!window.google || !google.accounts || !google.accounts.id) return;
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (resp) => {
          clearMsg();
          const d = await post('google', { credential: resp.credential });
          if (d.error) return show('error', d.error);
          afterSignIn();
        },
      });
      const w = Math.min(340, Math.max(220, document.querySelector('.auth-card').clientWidth - 48));
      google.accounts.id.renderButton($('google-btn'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'es', width: w });
      $('google-block').hidden = false;
    };
    document.head.appendChild(sc);
  }).catch(() => {});

  // Si ya hay sesión, no mostrar el formulario
  // Enlace de confirmación de correo: confirma y, si ya hay sesión, sigue al panel tras mostrar el aviso.
  const checkSession = () => fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => (r.ok ? afterSignIn() : null)).catch(() => {});
  if (verifyToken) {
    post('verify-email', { token: verifyToken }).then(d => {
      show(d.error ? 'error' : 'ok', d.error || '¡Correo confirmado! Ya puedes reservar.');
      setTimeout(checkSession, d.error ? 4000 : 2500);
    });
  } else if (!resetToken) {
    checkSession();
  }
  if (resetToken) go('reset');
  else if (params.get('tab') === 'register') go('register');
})();
