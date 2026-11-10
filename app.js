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

  /* ---- Contact form (POST JSON {name,email,message,_gotcha,submissionId,turnstileToken}) ---- */
  const cForm = $('contact-form');
  if (cForm) {
    const fName = $('form-name'),
      fEmail = $('form-email'),
      fMsg = $('form-message'),
      fStatus = $('form-status'),
      fDone = $('form-done'),
      fAgain = $('form-again'),
      fBtn = $('form-submit'),
      btnLabel = fBtn.querySelector('span');
    const WORKER_URL = 'https://site-form.skmahin.workers.dev';
    const CONTACT_EMAIL = 'contact@skmahin.com';
    /* Cloudflare Turnstile PUBLIC site key (safe to ship in client code).
       Turnstile is mandatory: the Worker rejects every request without a valid token.
       The matching SECRET key lives only on the Worker (wrangler secret put TURNSTILE_SECRET).
       The widget's allowed hostnames (Dashboard > Turnstile) must include this site's domain. */
    const TURNSTILE_SITE_KEY = '0x4AAAAAAF0f1JKxXLE6nTwm';
    const TURNSTILE_ACTION = 'contact'; /* must match the action the Worker expects; leave as is */
    const LIMITS = { name: 100, email: 254, message: 5000 },
      TIMEOUT_MS = 20000,
      COOLDOWN_MS = 30000;
    /* Pragmatic email check (the server must still re-validate): one @, sane local part, dot-separated
       domain labels without leading/trailing hyphens or empty labels, alphabetic TLD of 2+ chars. */
    const validEmail = (v) => {
      const at = v.indexOf('@');
      if (at < 1 || at !== v.lastIndexOf('@')) return false;
      const local = v.slice(0, at),
        labels = v.slice(at + 1).split('.');
      if (local.length > 64 || /^\.|\.$|\.\.|[\s<>",;:()\[\]\\]/.test(local)) return false;
      if (labels.length < 2) return false;
      if (!labels.every((l) => l.length > 0 && l.length <= 63 && !/^-|-$|[\s<>"',;:()\[\]\\]/.test(l))) return false;
      const tld = labels[labels.length - 1];
      return tld.length >= 2 && !/^\d+$/.test(tld);
    };
    const fields = [
      [fName, 'err-name', 'Please enter your name.', 'name'],
      [fEmail, 'err-email', 'Please enter your email address.', 'email'],
      [fMsg, 'err-message', 'Please write a message.', 'message'],
    ];
    const setErr = (el, id, msg) => {
      $(id).textContent = msg;
      if (msg) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    };
    const status = (cls, msg) => {
      fStatus.className = 'form-status' + (cls ? ' ' + cls : '');
      fStatus.textContent = msg;
    };
    fields.forEach(([el, id]) => el.addEventListener('input', () => setErr(el, id, '')));
    let sending = false,
      lastSent = 0,
      tsId = null,
      tsToken = '',
      tsLoading = false,
      tsScript = null,
      tsFailed = false,
      submissionId = '';
    /* One unique ID per submission attempt. Retrying the SAME unsent message reuses it (so a double-click or retry can never send twice);
       editing any field or a successful send discards it, so a later legitimate message always gets a fresh ID. */
    const newId = () => {
      if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
    fields.forEach(([el]) =>
      el.addEventListener('input', () => {
        submissionId = '';
      })
    );

    const tsBox = $('ts-box');
    const tsBlockedMsg =
      'The human-verification check could not load. A browser extension or network setting may be blocking it. Please email ' +
      CONTACT_EMAIL +
      ' instead.';
    if (!TURNSTILE_SITE_KEY) console.error('Contact form: set TURNSTILE_SITE_KEY in app.js (Turnstile is mandatory).');

    /* Turnstile loads lazily (when the form nears the viewport or is first touched), so visitors who never
       reach the form make no request to Cloudflare's challenge service. */
    function loadTurnstile() {
      if (!TURNSTILE_SITE_KEY || !tsBox || tsLoading) return;
      tsLoading = true;
      if (tsScript && tsScript.parentNode) tsScript.parentNode.removeChild(tsScript);
      const s = d.createElement('script');
      tsScript = s;
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = () => {
        if (!window.turnstile || tsId !== null) return;
        try {
          tsId = window.turnstile.render(tsBox, {
            sitekey: TURNSTILE_SITE_KEY,
            action: TURNSTILE_ACTION,
            appearance: 'interaction-only',
            size: 'flexible',
            theme: 'dark',
            callback: (t) => {
              tsToken = t;
              tsFailed = false;
              if (fStatus.textContent === tsBlockedMsg) status('', '');
            },
            'expired-callback': () => {
              tsToken = '';
            },
            'timeout-callback': () => {
              tsToken = '';
            },
            'unsupported-callback': () => {
              tsToken = '';
              tsFailed = true;
              status('error', tsBlockedMsg);
            },
            'error-callback': () => {
              tsToken = '';
              tsFailed = true;
            },
          });
        } catch (err) {
          tsFailed = true;
          status('error', tsBlockedMsg);
        }
      };
      s.onerror = () => {
        tsLoading = false; /* allow a later retry (e.g. on next focus or submit) */
        if (s.parentNode) s.parentNode.removeChild(s); /* don't pile up dead script tags */
        tsScript = null;
        tsFailed = true;
        status('error', tsBlockedMsg);
      };
      d.head.appendChild(s);
    }
    if ('IntersectionObserver' in window && tsBox) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            loadTurnstile();
            io.disconnect();
          }
        },
        { rootMargin: '400px 0px' }
      );
      io.observe(cForm);
    } else {
      loadTurnstile();
    }
    cForm.addEventListener('focusin', loadTurnstile);

    cForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return;
      if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
        const wait = Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - lastSent)) / 1000));
        status('error', 'Message already sent. Please wait ' + wait + ' seconds before sending another.');
        return;
      }
      const nameVal = fName.value.trim(),
        emailVal = fEmail.value.trim(),
        msgVal = fMsg.value.trim();
      const gotchaVal = cForm.elements['_gotcha'] ? cForm.elements['_gotcha'].value : '';

      let first = null;
      fields.forEach(([el, id, msg, key]) => {
        const v = el.value.trim();
        let m = '';
        if (!v) m = msg;
        else if (v.length > LIMITS[key]) m = 'Please keep this under ' + LIMITS[key] + ' characters.';
        else if (el === fEmail && !(validEmail(v) && el.checkValidity())) m = 'Please enter a valid email address.';
        setErr(el, id, m);
        if (m && !first) first = el;
      });
      if (first) {
        status('error', 'Please fix the highlighted fields.');
        first.focus();
        return;
      }

      if (!TURNSTILE_SITE_KEY) {
        status('error', 'The form is not configured yet. Please email ' + CONTACT_EMAIL + ' instead.');
        return;
      }
      if (!tsToken) {
        loadTurnstile();
        status(
          'error',
          tsFailed
            ? tsBlockedMsg
            : 'Verifying you are human. Please wait a moment and press Send again.'
        );
        return;
      }
      if (!submissionId) submissionId = newId();

      sending = true;
      fBtn.disabled = true;
      btnLabel.textContent = 'Sending…';
      status('', 'Sending message…');

      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer2 = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            name: nameVal,
            email: emailVal,
            message: msgVal,
            _gotcha: gotchaVal,
            submissionId: submissionId,
            turnstileToken: tsToken,
          }),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: ctl ? ctl.signal : undefined,
        });
        let data = {};
        try {
          data = await res.json();
        } catch (_) {}
        if (res.ok && data && data.success === true) {
          lastSent = Date.now();
          submissionId = '';
          status('', '');
          cForm.reset();
          cForm.hidden = true;
          if (fDone) {
            fDone.hidden = false;
            const t = fDone.querySelector('.form-title');
            t.setAttribute('tabindex', '-1');
            t.focus();
          }
        } else if (res.status === 429) {
          status('error', 'Too many messages. Please try again in a few minutes.');
        } else {
          const msg = data && typeof data.error === 'string' && data.error.length <= 200 ? data.error : '';
          status('error', msg || 'Failed to send message. Please try again, or email ' + CONTACT_EMAIL + '.');
        }
      } catch (err) {
        status(
          'error',
          err && err.name === 'AbortError'
            ? 'The request timed out. Please try again.'
            : 'Network error. Please try again later, or email ' + CONTACT_EMAIL + '.'
        );
      } finally {
        clearTimeout(timer2);
        /* Turnstile tokens are single-use: always discard this one and request a fresh token for any retry.
           submissionId is deliberately kept on failure so a retry of the same message is still de-duplicated. */
        tsToken = '';
        if (tsId !== null && window.turnstile) {
          try {
            window.turnstile.reset(tsId);
          } catch (_) {}
        }
        sending = false;
        fBtn.disabled = false;
        btnLabel.textContent = 'Send message';
        if (!cForm.hidden) {
          const calm = matchMedia('(prefers-reduced-motion:reduce)').matches;
          fStatus.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
        }
      }
    });
    if (fAgain) {
      fAgain.addEventListener('click', () => {
        fDone.hidden = true;
        cForm.hidden = false;
        fName.focus();
      });
    }
  }
})();
