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
  var SRC_LABEL = { checklist:'チェックリスト', order:'発注計算', daily:'日報' };
  g.WorkRecord = { workDate:workDate, cutoffHour:cutoffHour, setCutoffHour:setCutoffHour,
    touch:touch, askCarryOver:askCarryOver, carryOverDate:carryOverDate,
    get:get, put:put, fetch:fetch, srcLabel:function(s){ return SRC_LABEL[s] || s || ''; } };
})(window);
