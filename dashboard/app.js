/* Aurora Token Radar dashboard.
   Everything on this page comes from window.RADAR, a local file written next to
   this dashboard by main.ts. There is no fetch, no network and no tracking:
   the board, the detail view and the filters all run on that one dataset. */
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('app');
  var meta = document.getElementById('mastMeta');
  if (!DATA || !root) return;
  meta.textContent = 'snapshot ' + DATA.as_of + ' / model ' + DATA.model_id + ' / offline';

  var view = { text: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', open: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'age unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function node(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var v = attrs[key];
        if (v === null || v === undefined) return;
        if (key === 'class') el.className = v;
        else if (key === 'text') el.textContent = v;
        else if (key.indexOf('on') === 0) el.addEventListener(key.slice(2), v);
        else el.setAttribute(key, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) el.appendChild(c); });
      else el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  function visibleRows() {
    var needle = view.text.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (view.watchOnly && !r.watchlist) return false;
      if (view.category !== 'all' && (r.category || 'Uncategorised') !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!needle) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(needle) >= 0;
    });
    var key = view.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'momentum') return (b.change_7d || -999) - (a.change_7d || -999);
      if (key === 'conviction') return b.conviction - a.conviction;
      if (key === 'name') return a.name < b.name ? -1 : 1;
      return a.rank - b.rank;
    });
    return list;
  }

  function hero() {
    var top = DATA.rows[0];
    return node('section', { class: 'hero' },
      node('div', null,
        node('h1', { text: 'Protocols with no token yet, ranked by what their launch could be worth' }),
        node('p', { class: 'lede', html: '' },
          'The board covers all ',
          node('b', { text: DATA.watchlist_size + ' watchlist protocols' }),
          ' above the ' + usd(DATA.floor_usd) + ' TVL floor, plus ',
          node('b', { text: DATA.early_size + ' early finds' }),
          ' below it. Wrapped, staked and bridged lookalikes are filtered out. The current leader is ',
          node('b', { text: top ? top.name : 'n/a' }),
          top ? ' at an implied ' + usd(top.implied_value_usd) + '.' : '.'
        )
      ),
      node('div', { class: 'stats' },
        stat('Board rows', String(DATA.board_size), 'every row has a farm plan'),
        stat('Watchlist', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'covered in full'),
        stat('Early finds', String(DATA.early_size), 'below the TVL floor'),
        stat('Already trading', String(DATA.live_size), 'carried separately, never ranked'),
        stat('Median implied', usd(DATA.median_implied_usd || 0), 'the middle row of the board')
      )
    );
  }
  function stat(label, value, hint) {
    return node('div', { class: 'stat' },
      node('span', { text: label }), node('b', { text: value }), node('small', { text: hint }));
  }

  function toolbar() {
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (cats.indexOf(c) < 0) cats.push(c);
      (r.chains || []).forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
    });
    cats.sort(); chains.sort();
    var search = node('input', { type: 'search', id: 'fText', placeholder: 'Name, slug, category or chain', value: view.text });
    search.addEventListener('input', function () { view.text = search.value; paint(false); });
    var catSel = selectOf('fCat', cats, view.category, 'All categories');
    catSel.addEventListener('change', function () { view.category = catSel.value; syncHash(); paint(false); });
    var chainSel = selectOf('fChain', chains, view.chain, 'All chains');
    chainSel.addEventListener('change', function () { view.chain = chainSel.value; syncHash(); paint(false); });
    var sortSel = node('select', { id: 'fSort' },
      option('rank', 'Implied value (board rank)', view.sort),
      option('tvl', 'TVL, largest first', view.sort),
      option('momentum', '7-day momentum', view.sort),
      option('conviction', 'Conviction score', view.sort),
      option('name', 'Name A-Z', view.sort));
    sortSel.addEventListener('change', function () { view.sort = sortSel.value; paint(false); });
    var toggle = node('input', { type: 'checkbox', id: 'fWatch' });
    toggle.checked = view.watchOnly;
    toggle.addEventListener('change', function () { view.watchOnly = toggle.checked; syncHash(); paint(false); });
    return node('div', { class: 'toolbar' },
      node('div', { class: 'field' }, node('label', { for: 'fText', text: 'Search' }), search),
      node('div', { class: 'field' }, node('label', { for: 'fCat', text: 'Category' }), catSel),
      node('div', { class: 'field' }, node('label', { for: 'fChain', text: 'Chain' }), chainSel),
      node('div', { class: 'field' }, node('label', { for: 'fSort', text: 'Sort' }), sortSel),
      node('label', { class: 'check' }, toggle, 'Watchlist only'),
      node('span', { class: 'shown', id: 'shownCount' })
    );
  }
  function option(value, label, current) {
    var o = node('option', { value: value, text: label });
    if (value === current) o.setAttribute('selected', 'selected');
    return o;
  }
  function selectOf(id, values, current, allLabel) {
    var sel = node('select', { id: id }, option('all', allLabel, current),
      values.map(function (v) { return option(v, v, current); }));
    sel.value = current;
    return sel;
  }

  function filterBanner(list) {
    var active = [];
    if (view.text.trim()) active.push('search "' + view.text.trim() + '"');
    if (view.category !== 'all') active.push('category = ' + view.category);
    if (view.chain !== 'all') active.push('chain = ' + view.chain);
    if (view.watchOnly) active.push('watchlist only');
    if (active.length === 0) return null;
    return node('div', { class: 'banner', text: 'Filtered view: ' + active.join('  /  ') + '  -  ' + list.length + ' of ' + DATA.board_size + ' protocols match.' });
  }

  function boardCard(list) {
    if (list.length === 0) {
      return node('div', { class: 'card' }, node('div', { class: 'emptybox' },
        node('h2', { text: 'Nothing matches those filters' }),
        node('p', { text: 'Loosen the search or reset the category and chain filters to see the full board again.' }),
        node('button', { class: 'btn', type: 'button', text: 'Reset all filters', onclick: resetFilters })
      ));
    }
    var body = node('tbody');
    list.forEach(function (r) {
      var row = node('tr', {
        tabindex: '0', 'aria-selected': view.open === r.slug ? 'true' : 'false',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        node('td', { class: 'num', text: '#' + r.rank }),
        node('td', null,
          node('div', { class: 'pname', text: r.name }),
          node('div', { class: 'psub', text: (r.category || 'Uncategorised') + ' / ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain n/a') })
        ),
        node('td', { class: 'num', text: usd(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        node('td', { class: 'num', text: ageLabel(r.age_days) }),
        node('td', null, node('div', { class: 'score' },
          node('span', { class: 'track' }, node('i', { style: 'width:' + Math.max(4, r.conviction) + '%' })),
          node('span', { class: 'num', text: String(r.conviction) })
        )),
        node('td', null, node('span', { class: 'implied', text: usd(r.implied_value_usd) })),
        node('td', null, node('span', { class: 'badge' + (r.watchlist ? ' watch' : ''), text: r.watchlist ? 'watchlist' : 'early find' }))
      );
      body.appendChild(row);
    });
    return node('div', { class: 'card' }, node('div', { class: 'table-scroll' },
      node('table', null,
        node('caption', { text: 'Pre-token board, strongest implied launch value first. Activate any row to open its model breakdown and farm plan.' }),
        node('thead', null, node('tr', null,
          node('th', { text: 'Rank' }), node('th', { text: 'Protocol' }), node('th', { text: 'TVL' }),
          node('th', { text: '7 days' }), node('th', { text: 'Tokenless age' }), node('th', { text: 'Conviction' }),
          node('th', { text: 'Implied value' }), node('th', { text: 'Origin' })
        )),
        body
      )
    ));
  }

  function modelCard() {
    return node('section', { class: 'modelcard' },
      node('h2', { text: 'How the implied value is built - model ' + DATA.model_id }),
      node('div', { class: 'formula', text: 'implied = round( TVL x category multiple (0.24-0.42) x momentum (1 + clamp(7d change, -40, +80) x 0.55 / 100) x maturity (0.62 + min(tokenless age, 1825d) / 1825 x 0.48) x breadth (1 + extra chains x 0.025, capped at 5) )' }),
      node('p', { text: 'One formula scores every protocol; no name is hand-picked or hand-boosted. The category multiple reflects what comparable DeFi categories have historically listed at per dollar of TVL. Momentum rewards protocols gaining TVL this week but is clamped so one wild week cannot crown a board leader. Maturity rewards protocols that have operated for years without a token - the strongest public signal that a launch is a real event, not a launch-day invention. Conviction (0-100) is a display summary of size, momentum and maturity; the ranking itself is pure implied value.' }),
      node('p', { text: 'An implied value is a disciplined guess, not a price promise. Protocols that already trade are never ranked here: ' + DATA.live_size + ' of them are carried separately in the data feed with the market caps the market actually gave them.' })
    );
  }

  function detailPanel() {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === view.open) r = x; });
    if (!r) return null;
    var m = r.model;
    var panel = node('aside', { class: 'detail', id: 'detailPanel' },
      node('div', { class: 'detail-head' },
        node('div', null,
          node('div', { class: 'kicker', text: 'Rank #' + r.rank + ' of ' + DATA.board_size + (r.watchlist ? ' / watchlist' : ' / early find') }),
          node('h2', { text: r.name }),
          node('p', { class: 'psub', text: (r.category || 'Uncategorised') + ' on ' + ((r.chains || []).join(', ') || 'an unnamed chain') + ' / slug ' + r.slug })
        ),
        node('button', { class: 'closebtn', type: 'button', text: 'Close', onclick: function () { view.open = null; syncHash(); paint(true); } })
      ),
      node('div', { class: 'breakdown' },
        line('TVL in the snapshot', usd(r.tvl_usd)),
        line('Category multiple', 'x ' + m.category_multiple),
        line('7-day change / momentum', pct(r.change_7d) + ' / x ' + m.momentum_multiplier),
        line('Tokenless age / maturity', ageLabel(r.age_days) + ' / x ' + m.maturity_multiplier),
        line('Chain breadth', (r.chains || []).length + ' chain(s) / x ' + m.breadth_multiplier),
        line('Conviction score', String(r.conviction) + ' / 100'),
        node('div', { class: 'total' }, node('span', { text: 'Implied launch value' }), node('b', { text: usd(r.implied_value_usd) }))
      ),
      node('p', { class: 'note', text: 'First tracked ' + (r.listed_at || 'on an unknown date') + '. No token is on record for this protocol in the ' + DATA.as_of + ' snapshot: no CoinGecko id, no ticker, no market cap. That absence - at this size - is exactly what the radar exists to catch early.' }),
      node('h3', { text: 'Farm plan - do this, in this order' }),
      node('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return node('li', { text: s }); })),
      node('h3', { text: 'Honest risks' }),
      node('p', { class: 'note', text: 'A token may never launch, may launch with little or nothing for early users, or may value far below this model. Farm with capital you can leave parked for months, and treat every step above as a cost you are choosing to pay for a chance - not as a purchase of a guaranteed reward.' })
    );
    return panel;
    function line(label, value) {
      return node('div', null, node('span', { text: label }), node('b', { text: value }));
    }
  }

  function resetFilters() {
    view.text = ''; view.category = 'all'; view.chain = 'all'; view.watchOnly = false; view.sort = 'rank';
    syncHash(); paint(true);
  }
  function openDetail(slug) {
    view.open = slug;
    syncHash();
    paint(true);
    var panel = document.getElementById('detailPanel');
    if (panel) panel.scrollIntoView({ block: 'start' });
  }
  function syncHash() {
    var parts = [];
    if (view.category !== 'all') parts.push('category=' + encodeURIComponent(view.category));
    if (view.chain !== 'all') parts.push('chain=' + encodeURIComponent(view.chain));
    if (view.watchOnly) parts.push('watch=1');
    if (view.open) parts.push('p=' + encodeURIComponent(view.open));
    var hash = parts.join('&');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
    }
  }
  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var key = decodeURIComponent(kv[0] || '');
      var val = decodeURIComponent(kv.slice(1).join('=') || '');
      if (key === 'category') view.category = val;
      if (key === 'chain') view.chain = val;
      if (key === 'watch') view.watchOnly = val === '1';
      if (key === 'q') view.text = val;
      if (key === 'p') view.open = val;
    });
  }

  function paint(rebuildToolbar) {
    var list = visibleRows();
    var hadSearchFocus = document.activeElement && document.activeElement.id === 'fText';
    root.textContent = '';
    root.appendChild(hero());
    root.appendChild(toolbar());
    if (hadSearchFocus) {
      var again = document.getElementById('fText');
      if (again) {
        again.focus();
        try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* older engines */ }
      }
    }
    var banner = filterBanner(list);
    if (banner) root.appendChild(banner);
    var detail = detailPanel();
    var layout = node('div', { class: 'layout' + (detail ? ' with-detail' : '') },
      boardCard(list), detail);
    root.appendChild(layout);
    root.appendChild(modelCard());
    root.appendChild(node('footer', { class: 'foot', text: 'Source: ' + DATA.source + ' / Snapshot date ' + DATA.as_of + ' / Static page, generated locally, no network calls.' }));
    var counter = document.getElementById('shownCount');
    if (counter) counter.textContent = list.length + ' of ' + DATA.board_size + ' shown';
    root.setAttribute('aria-busy', 'false');
  }

  readHash();
  paint(true);
})();
