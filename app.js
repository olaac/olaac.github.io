(() => {
  const d = document,
    $ = (id) => d.getElementById(id);

  /* Signal that JavaScript is executing (enables form display without inline noscript CSS) */
  d.documentElement.classList.add('js-ready');

  /* ---- Footer year ---- */
  const yearEl = $('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- Active section navigation highlight (rAF-throttled, with aria-current) ---- */
  const sections = Array.from(d.querySelectorAll('main section[id]'));
  const navLinks = Array.from(d.querySelectorAll('.nav .nav-link'));
  let currentId = null,
    ticking = false;

  function setActive(id) {
    if (id === currentId) return;
    currentId = id;
    navLinks.forEach((link) => {
      const on = link.getAttribute('href') === '#' + id;
      link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function updateActiveNav() {
    ticking = false;
    if (!sections.length || !navLinks.length) return;
    let id = sections[0].id;
    sections.forEach((sec) => {
      if (sec.getBoundingClientRect().top <= 120) id = sec.id;
    });
    /* At the very bottom the last section wins even if it is short. */
    if (window.innerHeight + window.scrollY >= d.documentElement.scrollHeight - 2) {
      id = sections[sections.length - 1].id;
    }
    setActive(id);
  }

  function requestNavUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateActiveNav);
  }

  window.addEventListener('scroll', requestNavUpdate, { passive: true });
  window.addEventListener('resize', requestNavUpdate);
  window.addEventListener('load', requestNavUpdate);
  updateActiveNav();

  /* ---- Subtle Geist radial spotlight effect on grid cells (hover-capable devices only) ---- */
  if (window.matchMedia && matchMedia('(hover: hover)').matches) {
    d.querySelectorAll('.geist-cell').forEach((cell) => {
      cell.addEventListener('mousemove', (e) => {
        const rect = cell.getBoundingClientRect();
        cell.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        cell.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
      });
    });
  }

  /* ---- Copy email ---- */
  const copy = $('copy'),
    email = $('email-text'),
    cl = $('copy-label'),
    st = $('copy-status');
  const platformStr =
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
  const isApple = /Mac|iPhone|iPad|iPod/.test(platformStr);
  let timer;
  const say = (m, l) => {
    st.textContent = m;
    cl.textContent = l;
    clearTimeout(timer);
    timer = setTimeout(() => {
      st.textContent = '';
      cl.textContent = 'Copy';
    }, 3000);
  };
  if (copy && email && cl && st) {
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email.textContent.trim());
        say('Email copied to clipboard.', 'Copied');
      } catch (err) {
        const g = d.createRange();
        g.selectNodeContents(email);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(g);
        say(
          'Copy failed. Address selected: press ' + (isApple ? 'Cmd+C' : 'Ctrl+C') + '.',
          isApple ? 'Cmd+C' : 'Ctrl+C'
        );
      }
    });
  }
})();
