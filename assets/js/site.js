/* Shared behaviour for every page: nav scrolling, the theme toggle, and the
   BibTeX panels on the homepage. Lifted out of index.html when the site gained
   a second page, so the blog and the homepage cannot drift apart. */

/* Smooth scroll for in-page links in the right rail.
   Rail links are absolute ("/#about") so they resolve from /blog/* too. Only
   intercept the click when the target is actually on this page; from a blog page
   there is no such section and the browser should just navigate home. */
document.querySelectorAll('.rail a, .side nav a').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    var hash = href.indexOf('#') === -1 ? '' : href.slice(href.indexOf('#') + 1);
    if (!hash) return;
    a.addEventListener('click', function (e) {
        var target = document.getElementById(hash);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', '#' + hash);
    });
});

/* Theme toggle */
(function () {
    var root = document.documentElement;
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    function apply(mode) {
        // Only the attribute and the labels change here. Which glyph shows is a
        // CSS concern keyed off data-theme -- writing textContent would delete
        // the two inline SVGs the button is built from.
        root.setAttribute('data-theme', mode);
        var next = mode === 'dark' ? 'light' : 'dark';
        btn.setAttribute('title', 'Switch to ' + next);
        btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    }
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    // Light unless this visitor has previously chosen dark. The OS preference is
    // deliberately not consulted, so the site looks the same to every new reader.
    apply(saved === 'dark' ? 'dark' : 'light');
    btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem('theme', next); } catch (e) {}
        trackEvent('UI', 'click', 'Theme ' + next);
    });
})();

/* Publications: the list and every BibTeX panel are static markup in the document,
   so they are present for crawlers and for readers without JavaScript. This only
   toggles a panel open and copies its contents. */
document.querySelectorAll('[data-bib-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.getAttribute('data-bib-toggle') + '_bib');
        if (!panel) return;
        var opening = panel.hasAttribute('hidden');
        panel.toggleAttribute('hidden', !opening);
        btn.setAttribute('aria-expanded', String(opening));
    });
});

document.querySelectorAll('[data-bib-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.getAttribute('data-bib-copy') + '_bib');
        var code = panel && panel.querySelector('.bib-code');
        if (!code) return;
        navigator.clipboard.writeText(code.textContent).then(function () {
            var original = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(function () { btn.textContent = original; }, 2000);
        }).catch(function () { alert('Failed to copy BibTeX'); });
    });
});

/* Rail collapse.
   Above 1248px the rail is a sticky column beside the card and is always open.
   Below that it folds into a panel above the content, where an expanded list of
   eleven sections would push the page down, so it starts shut. Kept in sync on
   resize because crossing the breakpoint otherwise leaves the wrong state. */
(function () {
    var mq = window.matchMedia('(max-width: 1248px)');
    function sync(e) {
        var details = document.getElementById('rail-details');
        if (details) details.open = !e.matches;
    }
    sync(mq);
    // The post rail builds itself in an inline script that has already run by the
    // time this file loads, so the element is present either way.
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
})();

/* Scroll indicator for the rail.
   Marks the entry whose target is the one you are currently reading. Applies to
   the homepage sections and to a post's headings; on /blog/ and tag pages the
   rail holds page links whose targets are not on this page, so those get
   filtered out here and the rail keeps its aria-current styling instead.

   Position is read from the elements rather than an IntersectionObserver: a
   section taller than the viewport never fully intersects, and short trailing
   sections can leave two entries lit at once. Picking the last target above a
   probe line 120px down the viewport is unambiguous at any section height, and
   it tracks where you are actually reading.

   The one special case is maximum scroll. A final section shorter than the
   viewport can never reach the probe line, so without it the last entry would
   never light. It is guarded on that target actually being on screen, so it
   cannot fire early on a page with a tall footer. */
(function () {
    var rail = document.querySelector('.rail');
    if (!rail) return;

    var items = [];
    rail.querySelectorAll('a[href*="#"]').forEach(function (a) {
        var hash = a.getAttribute('href').split('#')[1];
        var el = hash && document.getElementById(hash);
        if (el) items.push({ a: a, el: el });
    });
    if (items.length < 2) return;

    var ticking = false;

    function update() {
        ticking = false;
        var probe = window.scrollY + 120;
        var current = items[0];
        for (var i = 0; i < items.length; i++) {
            if (items[i].el.getBoundingClientRect().top + window.scrollY <= probe) current = items[i];
            else break;
        }
        // At maximum scroll the page cannot move further, so a short final
        // section may never reach the probe. If it is on screen at that point,
        // it is what is being read.
        var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        if (window.scrollY >= maxScroll - 2) {
            var last = items[items.length - 1];
            if (last.el.getBoundingClientRect().top < window.innerHeight) current = last;
        }

        for (var j = 0; j < items.length; j++) {
            items[j].a.classList.toggle('is-active', items[j] === current);
        }
    }

    function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
})();

/* Listing rows: this site's own claps and comment count, plus Medium's tally
   where a post was cross-posted, in one request for the whole page. /thread per
   row would be a round trip each and would carry every comment body across to
   render two integers.

   Hidden until a number arrives, so a dead API costs the listing nothing (D17).
   A zero stays hidden too: "0 comments" beside a new post is noise. */
(function () {
    var stats = document.querySelectorAll('.post-stats[data-stats-slug]');
    if (!stats.length) return;

    var api = stats[0].getAttribute('data-stats-api');
    if (!api) return;

    var slugs = [];
    stats.forEach(function (el) { slugs.push(el.getAttribute('data-stats-slug')); });

    /* Writes one group of glyphs and reveals it if any of them has a number.
       Both groups carry the same markup, so what a glyph means is decided by its
       data-stat and the object handed in -- our `comments` and Medium's
       `responses` are the same bubble counting different things. */
    function fill(group, values) {
        if (!group) return;
        var shown = 0;
        group.querySelectorAll('.post-stat').forEach(function (stat) {
            var value = values[stat.getAttribute('data-stat')] || 0;
            stat.querySelector('.post-stat-n').textContent = value;
            stat.hidden = value === 0;
            if (value) shown++;
        });
        group.hidden = shown === 0;
    }

    fetch(api + '/counts?slugs=' + encodeURIComponent(slugs.join(',')))
        .then(function (r) { if (!r.ok) throw new Error('counts'); return r.json(); })
        .then(function (data) {
            stats.forEach(function (el) {
                var n = data.counts[el.getAttribute('data-stats-slug')];
                if (!n) return;
                fill(el, n);

                /* Medium's numbers are pushed by hand, so they are a snapshot
                   rather than live. The date says which snapshot, the same way
                   the tally on the post page does. */
                var medium = el.parentElement.querySelector('.post-stats-medium');
                if (!n.medium) return;
                fill(medium, n.medium);
                if (medium && !medium.hidden && n.medium.updated_at) {
                    medium.title = 'on Medium, as of ' + new Date(n.medium.updated_at)
                        .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                }
            });
        })
        .catch(function () {
            /* Left hidden: a missing count is not worth a line of apology
               between a reader and the post they came for. */
        });
})();
