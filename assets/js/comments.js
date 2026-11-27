/* Claps and comments. Talks to the Worker in worker/; see worker/README.md.

   Nothing here trusts a string that came from a reader: every one is written
   with textContent, never innerHTML. That is the entire XSS story for this
   feature, and it is why comment bodies are stored as plain text rather than
   markdown -- there is no sanitiser to keep correct as the years pass. */
(function () {
    var root = document.querySelector('.comments');
    if (!root) return;

    var api = root.getAttribute('data-comments-api');
    var slug = root.getAttribute('data-comments-slug');
    var list = root.querySelector('.comment-list');
    var empty = root.querySelector('.comment-empty');
    var form = root.querySelector('.comment-form');
    var fallback = root.querySelector('.comments-fallback');
    var status = root.querySelector('.comment-status');
    var clapBtn = root.querySelector('.clap-btn');
    var clapCount = root.querySelector('.clap-count');
    var mediumTally = root.querySelector('.medium-tally');

    var CAP = 20;          // mirrors LIMITS.clapsPerReader in the Worker
    var mine = 0;          // what this reader has already spent, per the server
    var pending = 0;       // clapped in the browser, not yet sent
    var flushTimer = null;

    function when(ms) {
        return new Date(ms).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    }

    function render(comments) {
        list.textContent = '';
        comments.forEach(function (c) {
            var li = document.createElement('li');

            var head = document.createElement('div');
            head.className = 'comment-head';
            var name = document.createElement('span');
            name.className = 'comment-name';
            name.textContent = c.name;
            var time = document.createElement('time');
            time.dateTime = new Date(c.created_at).toISOString();
            time.textContent = when(c.created_at);
            head.appendChild(name);
            head.appendChild(time);

            var body = document.createElement('p');
            body.className = 'comment-body';
            body.textContent = c.body;

            li.appendChild(head);
            li.appendChild(body);
            list.appendChild(li);
        });
        empty.hidden = comments.length > 0;
    }

    /* Medium's own numbers, pushed in by the author because Medium exposes no
       way to read them. Rendered beside ours, never added to them: a clap here
       is capped at 20 a reader, a clap there is up to 50 an account.

       The href is only assigned for an https URL. The Worker already refuses
       anything else, but this is the line that would put a javascript: URL in
       front of a reader, so it checks again rather than trusting the response. */
    function renderMedium(m) {
        if (!mediumTally) return;
        if (!m || typeof m.url !== 'string' || m.url.indexOf('https://') !== 0) {
            mediumTally.hidden = true;
            return;
        }
        var parts = [];
        if (m.claps) parts.push(m.claps + (m.claps === 1 ? ' clap' : ' claps'));
        if (m.responses) parts.push(m.responses + (m.responses === 1 ? ' response' : ' responses'));

        mediumTally.href = m.url;
        mediumTally.textContent = parts.length
            ? parts.join(' and ') + ' on Medium \u2192'
            : 'Also on Medium \u2192';
        if (m.updated_at) mediumTally.title = 'as of ' + when(m.updated_at);
        mediumTally.hidden = false;
    }

    function load() {
        return fetch(api + '/thread?slug=' + encodeURIComponent(slug))
            .then(function (r) { if (!r.ok) throw new Error('thread'); return r.json(); })
            .then(function (data) {
                mine = data.claps.mine;
                clapCount.textContent = data.claps.total;
                clapBtn.classList.toggle('clapped', mine > 0);
                render(data.comments);
                renderMedium(data.medium);
                form.hidden = false;
                fallback.hidden = true;
            });
    }

    /* Claps are batched: a reader tapping ten times should cost one request, not
       ten. The number moves immediately so the button feels alive, and the
       server's total replaces the optimistic one when the flush lands. */
    function flush() {
        var count = pending;
        pending = 0;
        flushTimer = null;
        if (!count) return;
        fetch(api + '/claps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: slug, count: count })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
              if (!data) return;
              mine = data.mine;
              clapCount.textContent = data.total;
          }).catch(function () {
              /* Leave the optimistic count alone: reverting it mid-read would be
                 more confusing than a number that is briefly one too high. */
          });
    }

    clapBtn.addEventListener('click', function () {
        if (mine + pending >= CAP) return;
        pending++;
        clapCount.textContent = parseInt(clapCount.textContent, 10) + 1;
        clapBtn.classList.add('clapped');
        clapBtn.classList.remove('pop');
        void clapBtn.offsetWidth;   // restart the animation on a rapid second tap
        clapBtn.classList.add('pop');
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 700);
        trackEvent('Blog', 'clap', slug);
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var widget = root.querySelector('.cf-turnstile');
        var token = window.turnstile && window.turnstile.getResponse
            ? window.turnstile.getResponse(widget)
            : '';
        if (!token) { status.textContent = 'Please complete the check first.'; return; }

        var button = form.querySelector('button[type=submit]');
        button.disabled = true;
        status.textContent = 'Posting…';

        fetch(api + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slug: slug,
                name: form.name.value,
                email: form.email.value,
                body: form.body.value,
                turnstile: token
            })
        }).then(function (r) {
            return r.json().then(function (data) { return { ok: r.ok, data: data }; });
        }).then(function (res) {
            if (!res.ok) throw new Error(res.data && res.data.error ? res.data.error : 'failed');
            form.body.value = '';
            status.textContent = 'Posted.';
            trackEvent('Blog', 'comment', slug);
            return load();
        }).catch(function (err) {
            status.textContent = 'Could not post: ' + err.message;
        }).then(function () {
            // A Turnstile token is single-use, so the widget is reset either way
            // -- otherwise a second attempt fails verification for a reason the
            // reader has no way to understand.
            if (window.turnstile) window.turnstile.reset(widget);
            button.disabled = false;
        });
    });

    /* Turnstile's own default is "auto", which follows the OS. This site
       deliberately does not (light unless the reader opts into dark), so the
       widget has to be told before the script renders it -- otherwise a dark
       page gets a white captcha box. Toggling the theme with the form already
       open leaves the widget behind until the next load, which is a narrow
       enough case not to justify tearing it down and re-rendering. */
    root.querySelector('.cf-turnstile').setAttribute(
        'data-theme',
        document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
    );

    /* Turnstile is the one third-party script this site loads, and only on pages
       that actually carry the form. */
    var ts = document.createElement('script');
    ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    ts.async = true;
    ts.defer = true;
    document.head.appendChild(ts);

    load().catch(function () {
        /* A dead API costs the reader nothing: the section collapses to one line
           rather than shouting an error over the writing. */
        fallback.textContent = 'Comments are unavailable right now.';
        fallback.hidden = false;
        form.hidden = true;
    });
})();
