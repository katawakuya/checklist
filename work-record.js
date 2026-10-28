// =====================================================
// 作業記録の共通化（チェックリスト・発注計算・日報）
//   現場＋作業日＋旗揚げ番号 で1件。どのアプリで入れた値も他のアプリが読み、
//   同じ DP・管下H・W・L を二度入れなくて済むようにする。
//   保存先: 端末（localStorage 'work_records'）＋ Firestore 'work_records'（書けなければ端末だけ）
//   他端末の値は work_records → order_records（発注計算の記録）→ cl_records（チェックリストの記録）の順に探す。
//
// 作業日: 日替わり時刻（既定 7時）より前の入力は前日の作業日にする。
//   夜勤で日をまたいでも開始日の記録にまとまり、朝からの日勤は当日になる。
//   夜勤が日替わり時刻を過ぎて続いた（残業）場合に備え、昨夜の入力が残っている朝は
//   「夜勤の続きか」を確認し、そうなら前日の作業日を使う。
// =====================================================
(function(g){
  var CUT_KEY = 'wr_cutoff_hour', STORE = 'work_records', KEEP_DAYS = 60;
  function pad(n){ return String(n).padStart(2,'0'); }
  function cutoffHour(){
    var v = parseInt(localStorage.getItem(CUT_KEY), 10);
    return (isNaN(v) || v < 0 || v > 12) ? 7 : v;
  }
  function setCutoffHour(h){ localStorage.setItem(CUT_KEY, String(parseInt(h,10))); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function naturalWorkDate(at){
    var d = at ? new Date(at) : new Date();
    return ymd(new Date(d.getTime() - cutoffHour()*3600000));
  }
  // 「夜勤の続き」と答えた場合は、その朝のあいだ前日の作業日を使う（この端末の全アプリ共通）
  var OVR_KEY = 'wr_date_override', ASKED_KEY = 'wr_carry_asked', LAST_KEY = 'wr_last_input', OVR_HOURS = 8;
  function _json(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
  function override(){
    var o = _json(OVR_KEY);
    if(o && o.natural === naturalWorkDate() && Date.now() - o.at < OVR_HOURS*3600000) return o.date;
    return null;
  }
  function workDate(at){
    if(!at){ var o = override(); if(o) return o; }
    return naturalWorkDate(at);
  }
  // 入力した作業日と時刻を覚える（夜勤明けの確認に使う）
  function touch(date){
    if(!date) return;
    try{ localStorage.setItem(LAST_KEY, JSON.stringify({ date:date, at:Date.now() })); }catch(e){}
  }
  // 日替わり後（既定 7〜12時）に、昨夜（19時〜日替わり直後）の入力が前日の作業日で残っていれば、その前日を返す
  function carryOverDate(){
    var now = new Date(), c = cutoffHour(), h = now.getHours();
    if(h < c || h >= c + 5) return null;
    var last = _json(LAST_KEY);
    if(!last || !last.at) return null;
    var prev = ymd(new Date(now.getTime() - c*3600000 - 86400000));
    if(last.date !== prev || Date.now() - last.at > 16*3600000) return null;
    var lh = new Date(last.at).getHours();
    if(!(lh >= 19 || lh < c + 1)) return null;
    return prev;
  }
  // 夜勤明けの入力かもしれないときに確認する。前日にした場合は onPrev(前日) を呼ぶ。1日1回だけ聞く
  function askCarryOver(onPrev){
    if(override()) return;
    var nat = naturalWorkDate();
    if(localStorage.getItem(ASKED_KEY) === nat) return;
    var prev = carryOverDate();
    if(!prev) return;
    localStorage.setItem(ASKED_KEY, nat);
    var md = function(d){ var p = d.split('-'); return (+p[1])+'/'+(+p[2]); };
    var ok = confirm('⚠ 作業日の確認\n\n昨夜の作業（'+md(prev)+'）の入力が、日替わり（'+cutoffHour()+'時）の前まで残っています。\n夜勤の続き（残業）の入力ですか？\n\nOK　＝ '+md(prev)+' の作業として入力（夜勤の続き）\nキャンセル ＝ '+md(nat)+' の作業として入力（今日の作業）');
    if(!ok) return;
    try{ localStorage.setItem(OVR_KEY, JSON.stringify({ natural:nat, date:prev, at:Date.now() })); }catch(e){}
    if(onPrev) onPrev(prev);
  }
  function normHata(h){ return String(h==null?'':h).trim(); }
  function key(siteId, date, hata){ return (siteId||'')+'|'+(date||'')+'|'+normHata(hata); }
  function docId(siteId, date, hata){ return key(siteId, date, hata).replace(/[\/|]/g,'_'); }
  function loadAll(){
    try{ var o = JSON.parse(localStorage.getItem(STORE)||'{}'); return (o && typeof o==='object') ? o : {}; }catch(e){ return {}; }
  }
  function saveAll(o){
    var lim = ymd(new Date(Date.now() - KEEP_DAYS*86400000));
    Object.keys(o).forEach(function(k){ if((o[k].date||'') < lim) delete o[k]; });
    try{ localStorage.setItem(STORE, JSON.stringify(o)); }catch(e){}
  }
  function valid(siteId, date, hata){
    var h = normHata(hata);
    return !!(date && h && !/[、,]/.test(h));   // 複数番号をまとめた入力は対象外
  }
  function get(siteId, date, hata){
    if(!valid(siteId, date, hata)) return null;
    return loadAll()[key(siteId, date, hata)] || null;
  }
  // fields: { dp, dph, W, L, road, kbn, typeLabel, ... }（m単位）。空の値は上書きしない
  // opts.keepOthers: 他のアプリが入れた値は上書きしない（画面を開いただけの自動保存用）
  function put(siteId, date, hata, fields, src, db, opts){
    if(!valid(siteId, date, hata)) return null;
    var all = loadAll(), k = key(siteId, date, hata);
    var r = all[k] || { siteId:siteId||'', date:date, hata:normHata(hata), src:{} };
    var changed = false;
    Object.keys(fields||{}).forEach(function(f){
      var v = fields[f];
      if(v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) return;
      if(opts && opts.keepOthers && r[f] != null && r.src[f] && r.src[f] !== src) return;
      if(r[f] !== v){ r[f] = v; r.src[f] = src; changed = true; }
    });
    if(!changed && all[k]) return r;
    r.updatedAt = new Date().toISOString();
    all[k] = r; saveAll(all);
    touch(date);
    if(db){
      try{ db.collection('work_records').doc(docId(siteId, date, hata)).set(r, {merge:true}).catch(function(){}); }catch(e){}
    }
    return r;
  }
  function _num(v){ var n = parseFloat(v); return isNaN(n) ? null : n; }
  // 他端末で入った値を探す（見つかったら端末にも残す）
  function fetch(siteId, date, hata, db, cb){
    var loc = get(siteId, date, hata);
    if(loc || !db || !valid(siteId, date, hata)){ cb(loc); return; }
    var h = normHata(hata), done = false;
    var finish = function(rec){
      if(done) return; done = true;
      if(rec){
        var all = loadAll(); all[key(siteId, date, h)] = rec; saveAll(all);
      }
      cb(rec);
    };
    var sameSite = function(x){ return !siteId || !x.siteId || x.siteId === siteId; };
    var fromOrders = function(){
      db.collection('order_records').where('hata','==',h).limit(30).get().then(function(snap){
        var hit = null;
        snap.forEach(function(d){ var x = d.data(); if(x.date === date && sameSite(x) && x.dims) hit = x; });
        if(!hit){ fromChecks(); return; }
        var n = hit.dims.n || hit.dims[Object.keys(hit.dims)[0]] || {};
        var src = {};
        var rec = { siteId:siteId||'', date:date, hata:h, src:src, updatedAt:hit.savedAt||'' };
        if(n.DP != null){ rec.dp = n.DP; src.dp = 'order'; }
        if(n.DPH != null){ rec.dph = n.DPH; src.dph = 'order'; }
        if(n.W != null){ rec.W = n.W; src.W = 'order'; }
        if(n.L != null){ rec.L = n.L; src.L = 'order'; }
        finish(rec);
      }).catch(fromChecks);
    };
    var fromChecks = function(){
      db.collection('cl_records').where('hata','==',h).limit(30).get().then(function(snap){
        var hit = null;
        snap.forEach(function(d){ var x = d.data(); if(x.date === date && sameSite(x) && x.depth) hit = x; });
        if(!hit){ finish(null); return; }
        var dp = _num(hit.depth.dp1), dph = _num(hit.depth.dph);
        if(dp == null){ finish(null); return; }
        finish({ siteId:siteId||'', date:date, hata:h, dp:dp, dph:dph, src:{dp:'checklist', dph:'checklist'}, updatedAt:'' });
      }).catch(function(){ finish(null); });
    };
    try{
      db.collection('work_records').doc(docId(siteId, date, h)).get().then(function(doc){
        if(doc.exists){ finish(doc.data()); return; }
        fromOrders();
      }).catch(fromOrders);
    }catch(e){ finish(null); }
  }
  // =====================================================
  // フリー入力の箇所（チェックリストの「✏ フリー入力」）を端末間・アプリ間で共有する
  //   端末: ckfree_roadbed_masters_<現場> / ckfree_hata_master_<現場>
  //   Firestore: masters/ckfree_<現場> { roadbed, hata, deleted, updatedAt }（書けなければ端末だけ）
  //   同じ箇所は新しい方を残す。削除した箇所は deleted に残して、他端末から復活しないようにする
  // =====================================================
  function _arr(k){ try{ var a = JSON.parse(localStorage.getItem(k)||'[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
  function freeKeys(siteId){ return { rb:'ckfree_roadbed_masters_'+siteId, hata:'ckfree_hata_master_'+siteId }; }
  function freeLocal(siteId){ var k = freeKeys(siteId); return { rb:_arr(k.rb), hata:_arr(k.hata) }; }
  function _stamp(e){ return String(e.savedAt || e.at || e.updatedAt || ''); }
  function _merge(a, b, idOf, deleted){
    var m = {};
    a.concat(b).forEach(function(e){
      var id = idOf(e);
      if(!id || deleted.indexOf(id) >= 0) return;
      if(!m[id] || _stamp(e) > _stamp(m[id])) m[id] = e;
    });
    return Object.keys(m).map(function(k){ return m[k]; });
  }
  function syncFree(siteId, db, opts){
    opts = opts || {};
    var cb = opts.cb || function(){};
    if(!siteId){ cb(false); return; }
    var k = freeKeys(siteId), loc = freeLocal(siteId);
    var before = JSON.stringify(loc);
    var apply = function(remote){
      var deleted = (remote.deleted || []).slice();
      (opts.deleted || []).forEach(function(d){ if(deleted.indexOf(d) < 0) deleted.push(d); });
      var rb = _merge(loc.rb, remote.roadbed || [], function(e){ return e.key; }, deleted);
      var ha = _merge(loc.hata, remote.hata || [], function(e){ return String(e.hata||''); }, [])
        .filter(function(e){ return deleted.indexOf(e.rbKey) < 0; });
      try{ localStorage.setItem(k.rb, JSON.stringify(rb)); localStorage.setItem(k.hata, JSON.stringify(ha)); }catch(e){}
      var out = { roadbed:rb, hata:ha, deleted:deleted.slice(-200) };
      if(db && (opts.deleted || JSON.stringify(out.roadbed) !== JSON.stringify(remote.roadbed||[]) || JSON.stringify(out.hata) !== JSON.stringify(remote.hata||[]))){
        out.updatedAt = new Date().toISOString();
        try{ db.collection('masters').doc('ckfree_'+siteId).set(out).catch(function(){}); }catch(e){}
      }
      cb(JSON.stringify({ rb:rb, hata:ha }) !== before);
    };
    if(!db){ apply({}); return; }
    try{
      db.collection('masters').doc('ckfree_'+siteId).get()
        .then(function(doc){ apply(doc.exists ? (doc.data()||{}) : {}); })
        .catch(function(){ apply({}); });
    }catch(e){ apply({}); }
  }
  // フリー入力の旗揚げ番号（DP・管下H は m）
  function freeHata(siteId, hata){
    var h = normHata(hata);
    return freeLocal(siteId).hata.find(function(e){ return String(e.hata) === h; }) || null;
  }

  // =====================================================
  // 現場ルール（チェックリスト・発注計算で共通）
  //   noYuka: 掘削出来形は撮らず、復旧延長（L×W 検測）で代用する（例: PFI磯子）
  //   rbStep: 路盤層転圧の撒き出し厚（mm）。150 / 200。未設定なら従来ルール（層定義、無ければ@150）
  //           rbStepFixed=true の現場は画面でも変えられない。中間転圧は常に@200
  //   現場名から既定値を決め、チェックリストの画面で現場ごとに切り替えられる（端末に保存: ck_site_rules）
  // =====================================================
  // backfill（管上100mm〜路盤変更点の埋戻し）:
  //   'isoil'  … 管上100mmまで再生砂（水締め）／その上 路盤変更点まで改良土（例: 環状2号線）
  //   'sand'   … 管上100mmから上も再生砂（例: 小田原）
  //   'hassei' … 管上100mmまで改良土／その上 路盤変更点まで発生土（発注なし）（例: PFI磯子）
  //   ''       … 未設定（発注計算のウィザードで箇所ごとに聞く）
  var BACKFILL_OPTS = [
    ['',       '未設定（ウィザードで毎回聞く）'],
    ['isoil',  '管上100mmまで再生砂／その上は改良土'],
    ['sand',   '管上100mmから上も再生砂（改良土なし）'],
    ['hassei', '管上100mmまで改良土／その上は発生土（発注なし）']
  ];
  var SITE_RULE_DEFAULTS = [
    { re:/磯子/, rule:{ noYuka:true, rbStep:200, backfill:'hassei' } },
    { re:/小田原/, rule:{ rbStep:150, rbStepFixed:true, backfill:'sand' } },
    { re:/環状\s*[2２]|環[2２]/, rule:{ rbStep:200, rbStepFixed:true, backfill:'isoil' } }
  ];
  function _siteRec(siteId){
    var sites = _json('site_master') || [];
    for(var i=0;i<sites.length;i++){ if(sites[i] && sites[i].id === siteId) return sites[i]; }
    return null;
  }
  // 優先順: 現場名からの既定 → この端末の設定（チェックリスト） → 現場マスタの設定（全端末共通） → 固定ルール
  //   r._master に現場マスタで決めた項目名が入る（画面で「現場マスタで設定」と出すため）
  function siteRules(siteId, siteName){
    var rec = _siteRec(siteId);
    var name = siteName || (rec && rec.name) || '', r = {};
    SITE_RULE_DEFAULTS.forEach(function(d){ if(d.re.test(name)) Object.keys(d.rule).forEach(function(k){ r[k]=d.rule[k]; }); });
    var saved = (_json('ck_site_rules') || {})[siteId];
    if(saved) Object.keys(saved).forEach(function(k){ r[k]=saved[k]; });
    var m = (rec && rec.rules) || {};
    r._master = [];
    Object.keys(m).forEach(function(k){
      if(m[k] === '' || m[k] == null) return;
      r[k] = m[k]; r._master.push(k);
    });
    if(m.rbStep) r.rbStepFixed = !!m.rbStepFixed;
    // 固定ルールは端末の設定より優先（現場マスタで決めていない場合）
    if(!m.rbStep) SITE_RULE_DEFAULTS.forEach(function(d){ if(d.re.test(name) && d.rule.rbStepFixed){ r.rbStep = d.rule.rbStep; r.rbStepFixed = true; } });
    r.btmIsoil = (r.backfill === 'hassei');
    return r;
  }
  function backfillLabel(v){
    for(var i=0;i<BACKFILL_OPTS.length;i++) if(BACKFILL_OPTS[i][0] === (v||'')) return BACKFILL_OPTS[i][1];
    return '';
  }
  // 現場マスタに現場ルールを書く。クラウドは最新を読んでからその現場の rules だけ差し替える（他の現場を巻き戻さない）
  function saveSiteRules(siteId, rules, db, cb){
    cb = cb || function(){};
    var patch = function(arr){
      return (arr || []).map(function(x){ if(x && x.id === siteId){ x = Object.assign({}, x); x.rules = rules; x.updatedAt = new Date().toISOString().slice(0,10); } return x; });
    };
    try{ localStorage.setItem('site_master', JSON.stringify(patch(_json('site_master')))); }catch(e){}
    if(!db){ cb(true, 'local'); return; }
    var ref = db.collection('masters').doc('site_master');
    ref.get().then(function(doc){
      var cur = (doc.exists && doc.data().data) ? doc.data().data : (_json('site_master') || []);
      var next = patch(cur);
      try{ localStorage.setItem('site_master', JSON.stringify(next)); }catch(e){}
      return ref.set({ data:next, updatedAt:new Date().toISOString() });
    }).then(function(){ cb(true, 'cloud'); }).catch(function(e){ console.warn('[WorkRecord] site rules save failed', e); cb(false, 'local'); });
  }
  // 現場ルールの入力欄（現場マスタ・路盤マスタの画面で共通）。値は readRulesForm で読む
  function rulesFormHTML(prefix, rules, siteName){
    rules = rules || {};
    var def = siteRules('', siteName || '');
    var sel = function(id, opts, v){
      return '<select id="'+prefix+id+'" style="font-size:15px;padding:6px 8px;border-radius:6px;max-width:100%;">'
        + opts.map(function(o){ return '<option value="'+o[0]+'"'+(String(v==null?'':v)===String(o[0])?' selected':'')+'>'+o[1]+'</option>'; }).join('') + '</select>';
    };
    var row = function(label, ctrl, hint){
      return '<div style="margin:8px 0;"><div style="font-size:13px;font-weight:700;margin-bottom:3px;">'+label+'</div>'+ctrl
        + (hint ? '<div style="font-size:12px;opacity:.75;margin-top:2px;">'+hint+'</div>' : '') + '</div>';
    };
    var defTxt = function(k, txt){ return def[k] != null && def[k] !== '' ? '空欄なら現場名からの既定: '+txt : ''; };
    return row('埋戻し（管上100mm〜路盤変更点）', sel('backfill', BACKFILL_OPTS, rules.backfill),
               defTxt('backfill', backfillLabel(def.backfill)))
      + row('路盤層転圧の撒き出し（中間転圧は@200固定）', sel('rbStep', [['','未設定（現場名の既定・端末で選択）'],['200','@200'],['150','@150']], rules.rbStep),
               defTxt('rbStep', '@'+def.rbStep+(def.rbStepFixed?' 固定':'')))
      + '<label style="display:flex;align-items:center;gap:6px;font-size:14px;margin:4px 0;"><input type="checkbox" id="'+prefix+'rbStepFixed"'+(rules.rbStepFixed?' checked':'')+'> 撒き出しを固定（端末で変えられないようにする）</label>'
      + row('掘削出来形の撮影', sel('noYuka', [['','未設定（現場名の既定）'],['0','撮影する'],['1','撮らない（復旧延長で代用）']], rules.noYuka == null ? '' : (rules.noYuka ? '1' : '0')),
               defTxt('noYuka', def.noYuka ? '撮らない' : '撮影する'));
  }
  function readRulesForm(prefix){
    var v = function(id){ var e = document.getElementById(prefix+id); return e ? e.value : ''; };
    var r = {};
    if(v('backfill')) r.backfill = v('backfill');
    if(v('rbStep')) r.rbStep = parseInt(v('rbStep'), 10);
    var fx = document.getElementById(prefix+'rbStepFixed');
    if(r.rbStep && fx && fx.checked) r.rbStepFixed = true;
    if(v('noYuka') !== '') r.noYuka = v('noYuka') === '1';
    return r;
  }

  var SRC_LABEL = { checklist:'チェックリスト', order:'発注計算', daily:'日報', free:'フリー入力' };
  g.WorkRecord = { workDate:workDate, cutoffHour:cutoffHour, setCutoffHour:setCutoffHour,
    touch:touch, askCarryOver:askCarryOver, carryOverDate:carryOverDate,
    freeLocal:freeLocal, syncFree:syncFree, freeHata:freeHata, siteRules:siteRules,
    saveSiteRules:saveSiteRules, rulesFormHTML:rulesFormHTML, readRulesForm:readRulesForm, backfillLabel:backfillLabel, BACKFILL_OPTS:BACKFILL_OPTS,
    get:get, put:put, fetch:fetch, srcLabel:function(s){ return SRC_LABEL[s] || s || ''; } };
})(window);
