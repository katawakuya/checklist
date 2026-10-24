// =====================================================
// フリー入力モード（マスタ未登録・突発の箇所をつくる）— チェックリストと発注計算で共通
//   車道/歩道・仮/本復旧・路盤層転圧の撒き出し・旗揚げ番号・AS層・路盤層・DP・管下H（または床付け）を入れると、
//   路盤マスタと同じ形の箇所データ（型）と旗揚げ番号データを作る。
//   保存先: 端末 ckfree_roadbed_masters_<現場> / ckfree_hata_master_<現場>、
//           端末間は WorkRecord.syncFree（Firestore masters/ckfree_<現場>）で共有する。
//   どちらのアプリで作っても、もう一方の型一覧に出る。
//
// 使い方: FreeEntry.open({ siteId, siteName, rules:{rbStep, rbStepFixed}, by, db,
//                          onSaved(res), onDeleted(hata) })
//   res = { hata, rbKey, kbn, road, dp, dph（m）, entry, hataEntry, form }
// =====================================================
(function(g){
  var AS_OPTS = ['密粒度AS混合物','再生密粒度AS混合物','粗粒度AS混合物','再生粗粒度AS混合物','細粒度AS混合物','開粒度AS混合物','瀝青安定処理','再生瀝青安定処理'];
  var RB_OPTS = ['RM-40','RM-30','RM-25','再生RM-40','RC-40','RC-30','再生RC-40','改良土','砂'];
  var KIND_OPTS = ['上層','下層'];
  var _fr = null, _o = {};

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function rules(){ return _o.rules || {}; }
  function blank(){
    return { road:'車道', kbn:'kari', rbStep:rules().rbStep || 150, hata:'', dp:'', dph:'', floor:'',
      as:[ {name:'密粒度AS混合物', t:50}, {name:'粗粒度AS混合物', t:50} ],
      rb:[ {kind:'上層', mat:'RM-40', t:150}, {kind:'下層', mat:'RC-40', t:150} ] };
  }
  // 旧形式（「その他」＋custom）の入力を名前1つにまとめる
  function normForm(f){
    f.kbn = f.kbn || 'kari';
    f.rbStep = f.rbStep || rules().rbStep || 150;
    (f.as||[]).forEach(function(a){ if(a.name==='その他'){ a.name = a.custom||''; } delete a.custom; });
    (f.rb||[]).forEach(function(r){ if(r.mat==='その他'){ r.mat = r.custom||''; } delete r.custom; });
    return f;
  }
  function keyOf(kind){ return 'ckfree_' + kind + '_' + _o.siteId; }
  function load(kind){ try{ var a = JSON.parse(localStorage.getItem(keyOf(kind))||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
  function store(kind, arr){ localStorage.setItem(keyOf(kind), JSON.stringify(arr)); }
  function totals(){
    var asT = _fr.as.reduce(function(s,a){ return s+(parseFloat(a.t)||0); },0);
    var rbT = _fr.rb.reduce(function(s,r){ return s+(parseFloat(r.t)||0); },0);
    return { asT:asT, rbT:rbT, total:asT+rbT };
  }

  // ── 画面 ──
  function ensureModal(){
    if(document.getElementById('freeModal')) return;
    var d = document.createElement('div');
    d.id = 'freeModal';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 8px 40px;';
    d.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:560px;width:100%;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.25);color:#1e293b;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<div style="font-size:18px;font-weight:800;color:#92400e;">✏ フリー入力で箇所をつくる</div>'
      + '<button type="button" onclick="FreeEntry.close()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b;">✕</button></div>'
      + '<div id="freeBody"></div></div>';
    document.body.appendChild(d);
  }
  function open(opts){
    _o = opts || {};
    if(!_o.siteId){ alert('先に現場を選択してください'); return; }
    if(!_fr || _fr._site !== _o.siteId){ _fr = blank(); _fr._site = _o.siteId; }
    ensureModal();
    document.getElementById('freeModal').style.display = 'flex';
    render();
  }
  function close(){ var m = document.getElementById('freeModal'); if(m) m.style.display = 'none'; }
  function set(path, v){
    var p = path.split('.'), o = _fr;
    for(var i=0;i<p.length-1;i++) o = o[p[i]];
    o[p[p.length-1]] = v;
  }
  function inp(path, val, ph, type, w){
    return '<input type="'+(type||'text')+'" value="'+esc(val)+'" placeholder="'+(ph||'')+'"'+(type==='number'?' inputmode="decimal" step="1"':'')
      + ' oninput="FreeEntry.set(\''+path+'\',this.value);FreeEntry.updTotal()" style="width:'+(w||'100%')+';box-sizing:border-box;font-size:15px;padding:7px 8px;border:1px solid #cbd5e1;border-radius:6px;">';
  }
  // 選択＋フリー入力: 文字欄に直接書くか、右の▼から定型の名前を選ぶ
  function combo(path, val, opts, ph){
    return '<div style="display:flex;gap:3px;">'
      + '<input type="text" value="'+esc(val)+'" placeholder="'+(ph||'')+'" oninput="FreeEntry.set(\''+path+'\',this.value)" style="flex:1;min-width:0;box-sizing:border-box;font-size:15px;padding:7px 8px;border:1px solid #cbd5e1;border-radius:6px;">'
      + '<select onchange="if(this.value){FreeEntry.set(\''+path+'\',this.value);FreeEntry.render();}" title="定型から選ぶ" style="width:38px;flex:none;font-size:15px;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;">'
      + '<option value="">▼</option>' + opts.map(function(o){ return '<option value="'+esc(o)+'">'+esc(o)+'</option>'; }).join('') + '</select></div>';
  }
  function updTotal(){
    var t = totals();
    var el = document.getElementById('frTotal');
    if(el) el.textContent = 'AS '+t.asT+'mm ＋ 路盤 '+t.rbT+'mm ＝ 路盤構成変更点 GL-'+(t.total/1000).toFixed(3)+'m（中間転圧@200の終点。ここから'+(_fr.kbn==='hon'?'本':'仮')+'復旧の路盤層転圧）';
    var dp = parseFloat(_fr.dp)||0, dph = parseFloat(_fr.dph)||0, fl = parseFloat(_fr.floor)||0;
    var el2 = document.getElementById('frDepth');
    if(el2){
      var txt = '';
      if(dp && fl) txt = '管下H ＝ 床付け − DP ＝ '+(fl-dp)+'mm（床付けを優先）';
      else if(dp && dph) txt = '床付け ＝ DP ＋ 管下H ＝ '+(dp+dph)+'mm';
      el2.textContent = txt;
    }
  }
  function lab(t){ return '<div style="font-size:13px;font-weight:700;color:#475569;margin:10px 0 4px;">'+t+'</div>'; }
  function seg(field, opts){
    return '<div style="display:flex;gap:8px;">'
      + opts.map(function(o){ var on = String(_fr[field])===String(o[0]);
          return '<button type="button" onclick="FreeEntry.set(\''+field+'\','+JSON.stringify(o[0]).replace(/"/g,'\'')+');FreeEntry.render()" style="flex:1;padding:9px;font-size:15px;font-weight:700;border-radius:8px;cursor:pointer;border:2px solid '+(on?'#d97706':'#cbd5e1')+';background:'+(on?'#fffbeb':'#fff')+';color:'+(on?'#92400e':'#64748b')+';">'+o[1]+'</button>'; }).join('')
      + '</div>';
  }
  var BTN_X = 'background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;padding:6px 0;';
  var BTN_ADD = 'background:#fff;border:1px dashed #94a3b8;color:#475569;border-radius:6px;padding:5px 10px;font-size:14px;cursor:pointer;';
  function render(){
    var b = document.getElementById('freeBody');
    if(!b) return;
    normForm(_fr);
    var r = rules();
    var emb = _fr.road==='車道' ? 300 : 200;
    var h = '<div style="font-size:14px;color:#334155;margin-bottom:6px;">🏗 現場: <b>'+esc(_o.siteName||'')+'</b></div>';
    h += lab('車道／歩道（埋設シートの高さが決まります）') + seg('road', [['車道','車道'],['歩道','歩道']])
      + '<div style="font-size:13px;color:#0369a1;margin-top:4px;">埋設シート: 管上 '+emb+'mm</div>';
    h += lab('仮復旧／本復旧') + seg('kbn', [['kari','仮復旧'],['hon','本復旧']]);
    h += lab('路盤層転圧の撒き出し（中間転圧は@200固定）');
    if(r.rbStepFixed){
      _fr.rbStep = r.rbStep;
      h += '<div style="font-size:14px;color:#7030a0;font-weight:700;">@'+r.rbStep+' 固定（この現場のルール）</div>';
    } else {
      h += seg('rbStep', [[200,'@200'],[150,'@150']]);
    }
    h += lab('旗揚げ番号') + inp('hata', _fr.hata, '例: 1485');
    h += lab('AS層（上から）');
    _fr.as.forEach(function(a, i){
      h += '<div style="display:grid;grid-template-columns:minmax(0,1fr) 88px 30px;gap:6px;margin-bottom:6px;align-items:center;">'
        + '<div>'+combo('as.'+i+'.name', a.name, AS_OPTS, '層の名前')+'</div>'
        + '<div style="display:flex;align-items:center;gap:3px;">'+inp('as.'+i+'.t', a.t, 'mm', 'number', '58px')+'<span style="font-size:13px;">mm</span></div>'
        + '<button type="button" onclick="FreeEntry.removeRow(\'as\','+i+')" style="'+BTN_X+'">✕</button></div>';
    });
    h += '<button type="button" onclick="FreeEntry.addRow(\'as\')" style="'+BTN_ADD+'">＋ AS層追加</button>';
    h += lab('路盤層（上から）');
    _fr.rb.forEach(function(x, i){
      h += '<div style="display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr) 88px 30px;gap:6px;margin-bottom:6px;align-items:center;">'
        + '<div>'+combo('rb.'+i+'.kind', x.kind, KIND_OPTS, '上層')+'</div>'
        + '<div>'+combo('rb.'+i+'.mat', x.mat, RB_OPTS, '材料名')+'</div>'
        + '<div style="display:flex;align-items:center;gap:3px;">'+inp('rb.'+i+'.t', x.t, 'mm', 'number', '58px')+'<span style="font-size:13px;">mm</span></div>'
        + '<button type="button" onclick="FreeEntry.removeRow(\'rb\','+i+')" style="'+BTN_X+'">✕</button></div>';
    });
    h += '<button type="button" onclick="FreeEntry.addRow(\'rb\')" style="'+BTN_ADD+'">＋ 路盤層追加</button>';
    h += '<div id="frTotal" style="margin-top:8px;font-size:14px;font-weight:700;color:#7030a0;"></div>';
    h += lab('深さ（mm）')
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">'
      + '<div><div style="font-size:12px;color:#64748b;">DP（土被り）</div>'+inp('dp', _fr.dp, '1100', 'number')+'</div>'
      + '<div><div style="font-size:12px;color:#64748b;">DP下配管高さH</div>'+inp('dph', _fr.dph, '200', 'number')+'</div>'
      + '<div><div style="font-size:12px;color:#64748b;">床付け（直接でも可）</div>'+inp('floor', _fr.floor, '1400', 'number')+'</div>'
      + '</div><div id="frDepth" style="font-size:13px;color:#0369a1;margin-top:4px;min-height:16px;"></div>';
    h += '<button type="button" onclick="FreeEntry.save()" style="margin-top:14px;width:100%;background:#d97706;color:#fff;border:none;border-radius:8px;padding:11px;font-size:16px;font-weight:800;cursor:pointer;">'+esc(_o.saveLabel||'この内容で箇所をつくる')+'</button>';
    var list = load('hata_master');
    if(list.length){
      h += lab('この現場のフリー入力箇所（チェックリスト・発注計算で共通）')
        + list.map(function(e){
          var f = e.form || {};
          return '<div style="display:flex;gap:6px;align-items:center;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:4px;font-size:14px;">'
            + '<span style="flex:1;">No.'+esc(e.hata)+'　'+esc(e.road||'')+(f.kbn==='hon'?'・本復旧':'・仮復旧')+'　DP '+(e.dp*1000).toFixed(0)+' / 床付け '+((e.dp+e.dph)*1000).toFixed(0)+'mm</span>'
            + '<button type="button" onclick="FreeEntry.edit(\''+esc(e.hata)+'\')" style="background:#f0f9ff;border:1px solid #0ea5e9;color:#0369a1;border-radius:5px;padding:3px 8px;cursor:pointer;">編集</button>'
            + '<button type="button" onclick="FreeEntry.remove(\''+esc(e.hata)+'\')" style="background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c;border-radius:5px;padding:3px 8px;cursor:pointer;">削除</button></div>';
        }).join('');
    }
    b.innerHTML = h;
    updTotal();
  }
  function addRow(kind){
    if(kind==='as') _fr.as.push({name:'瀝青安定処理', t:100});
    else _fr.rb.push({kind:'下層', mat:'RC-40', t:150});
    render();
  }
  function removeRow(kind, i){ _fr[kind].splice(i,1); render(); }
  function edit(hata){
    var e = load('hata_master').find(function(x){ return String(x.hata)===String(hata); });
    if(!e || !e.form){ alert('この箇所は編集できません'); return; }
    _fr = normForm(JSON.parse(JSON.stringify(e.form)));
    _fr._site = _o.siteId;
    render();
  }
  function remove(hata){
    if(!confirm('No.'+hata+' のフリー入力箇所を削除しますか？（チェック記録・発注記録は消えません）')) return;
    var hs = load('hata_master'), e = hs.find(function(x){ return String(x.hata)===String(hata); });
    store('hata_master', hs.filter(function(x){ return String(x.hata)!==String(hata); }));
    if(e && e.rbKey) store('roadbed_masters', load('roadbed_masters').filter(function(x){ return x.key!==e.rbKey; }));
    if(g.WorkRecord) WorkRecord.syncFree(_o.siteId, _o.db, { deleted: e && e.rbKey ? [e.rbKey] : [] });
    if(_o.onDeleted) _o.onDeleted(hata);
    render();
  }

  // 材料名に RM-40 / RC-40 などがあれば上層・下層路盤として扱う（全角も可）
  function rbRow(r){
    var t = parseFloat(r.t), mat = String(r.mat||'').trim(), kind = String(r.kind||'').trim() || '下層';
    var z = mat.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0)-0xFEE0); }).replace(/[－‐ー―]/g,'-').toUpperCase();
    var m = z.match(/R([MC])\s*-?\s*(\d+)/);
    var sub = m ? ('R'+m[1]+'-'+m[2]) : (kind.indexOf('上')>=0 ? 'rmfree' : 'rcfree');
    return { cat:kind, subcat:sub, size:m?sub:'', name:(m && z===sub)?'':(mat||'路盤材'), t:t, n:1, totalMm:t };
  }
  var isRm = function(r){ var c = String(r.subcat||''); return c.indexOf('RM')===0 || c==='rmfree'; };
  var isRc = function(r){ var c = String(r.subcat||''); return c.indexOf('RC')===0 || c==='rcfree'; };

  function save(){
    var hata = String(_fr.hata||'').trim();
    if(!hata){ alert('旗揚げ番号を入力してください'); return; }
    var dp = parseFloat(_fr.dp)||0, dph = parseFloat(_fr.dph)||0, fl = parseFloat(_fr.floor)||0;
    if(!dp){ alert('DP（土被り）を入力してください'); return; }
    if(fl) dph = fl - dp;
    if(!(dph > 0)){ alert('DP下配管高さH か 床付け を入力してください（床付けは DP より深く）'); return; }
    normForm(_fr);
    var as = _fr.as.filter(function(a){ return (parseFloat(a.t)||0) > 0; }).map(function(a){
      return { name: String(a.name||'').trim() || 'AS層', t: parseFloat(a.t) };
    });
    var rb = _fr.rb.filter(function(r){ return (parseFloat(r.t)||0) > 0; }).map(rbRow);
    var tot = totals();
    if(!(tot.total > 0)){ alert('AS層か路盤層の厚さを入力してください'); return; }
    var sumT = function(f){ return rb.filter(f).reduce(function(s,r){ return s+r.t; },0)/1000; };
    var size = function(f){ var r = rb.find(function(x){ return f(x) && x.size; }); return r ? (parseInt(String(r.size).replace(/\D/g,''))||40) : 40; };
    var lstr = function(f){ return rb.filter(f).map(function(r){ return (r.name || (r.cat+' '+r.subcat))+' t='+r.t+'mm'; }).join(' + '); };
    var ckType = _fr.road==='車道' ? '85' : '30';
    var old = load('hata_master').find(function(x){ return String(x.hata)===hata; });
    var rbKey = (old && old.rbKey) || ('free_'+Date.now());
    var kbn = _fr.kbn==='hon' ? 'hon' : 'kari';
    var label = '✏ No.'+hata+' '+_fr.road+' '+(kbn==='hon'?'本':'仮')+'復旧 AS'+as.length+'層 計'+tot.total+'mm';
    var side = {
      AsLayers: as, RbLayers: rb,
      RmSize: size(isRm), RmH: sumT(isRm), RmLayers: lstr(isRm),
      RcSize: size(isRc), RcH: sumT(isRc), RcLayers: lstr(isRc),
      TotalH: tot.total/1000
    };
    var now = new Date().toISOString();
    var entry = { key:rbKey, free:true, label:label, color:'#d97706', ckType:ckType, rbStep:parseInt(_fr.rbStep)||0,
      updatedAt:now.slice(0,10), savedAt:now };
    ['kari','hon'].forEach(function(p){ Object.keys(side).forEach(function(k){ entry[p+k] = side[k]; }); });
    var form = JSON.parse(JSON.stringify(_fr)); delete form._site;
    var hataEntry = { free:true, key:'hf_'+hata, hata:hata, num:hata, name:'フリー入力', road:_fr.road,
      dp:+(dp/1000).toFixed(3), dph:+(dph/1000).toFixed(3), rbKey:rbKey, form:form, at:now, by:_o.by||'' };
    store('roadbed_masters', load('roadbed_masters').filter(function(x){ return x.key!==rbKey; }).concat([entry]));
    store('hata_master', load('hata_master').filter(function(x){ return String(x.hata)!==hata; }).concat([hataEntry]));
    if(g.WorkRecord) WorkRecord.syncFree(_o.siteId, _o.db);
    close();
    if(_o.onSaved) _o.onSaved({ hata:hata, rbKey:rbKey, kbn:kbn, road:_fr.road, dp:hataEntry.dp, dph:hataEntry.dph,
      entry:entry, hataEntry:hataEntry, form:form });
  }

  g.FreeEntry = { open:open, close:close, render:render, set:set, updTotal:updTotal, addRow:addRow, removeRow:removeRow,
    edit:edit, remove:remove, save:save,
    _state:function(){ return _fr; }, _setState:function(f){ _fr = f; if(_fr) _fr._site = _o.siteId; } };
})(window);
