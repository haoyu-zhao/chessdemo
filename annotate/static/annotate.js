import { Chess } from './vendor/chess.js';
const $ = id => document.getElementById(id);
const KEY = 'chess-annotation-workspace-1', TOKEN = 'chess-annotation-session-1';
const t = (en, zh) => lang === 'zh' ? zh : en;
let lang = localStorage.getItem('chess-annotation-language') || 'en';
let catalog, workspace = {current:null, entries:{}}, records = [], connected = false;
let flipped = false, preview = false, selected = null, saving = false, toastTimer, storageError = false;
let endpoint = '', endpointTime = 0;
const initial = new Chess().fen();
const samples = {
  opening: {fen:initial, moves:['d2d4','d7d5'], target:'c2c4', en:'Opening · 1.d4 d5', zh:'开局 · 1.d4 d5'},
  middle: {fen:'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7', moves:[], target:'d3d4', en:'Middlegame · both sides castled', zh:'中局 · 双方已易位'},
  ending: {fen:'8/4k3/8/3P4/4K3/8/8/8 w - - 0 1', moves:[], target:'d5d6', en:'Endgame · king and pawn', zh:'残局 · 王兵残局'},
  initial: {fen:initial, moves:[], target:'', en:'Standard starting position', zh:'标准初始局面'}
};
const uid = () => crypto.randomUUID();
const entry = () => workspace.entries[workspace.current];
const doc = () => entry().document;
const moveUci = m => m.from + m.to + (m.promotion || '');
const applyUci = (board, uci) => board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
const pieceNames = {p:['pawn','兵'],n:['knight','马'],b:['bishop','象'],r:['rook','车'],q:['queen','后'],k:['king','王']};
const name = c => lang === 'zh' ? c.name : c.name_en;
function boardOf(d = doc()) { const b = new Chess(d.context.initial_fen); d.context.moves_uci.forEach(u=>applyUci(b,u)); return b; }
function meaningful(e) { return e.revision > 0 || !!e.document.explanation.trim() || !!e.document.extra_concepts.trim() || Object.values(e.document.concepts).some(Boolean); }
function message(text, state='') { $('save-message').textContent=text; $('save-message').className='save-message '+state; }
function toast(text) { $('toast').textContent=text; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),5000); }
function persist() {
  try {localStorage.setItem(KEY,JSON.stringify(workspace)); storageError=false; return true;}
  catch {storageError=true; message(t('Browser storage is full or unavailable. Download a backup now; this draft is only in memory.','浏览器存储已满或不可用，请立即下载备份；当前草稿仅在内存中。'),'failed'); return false;}
}
function inputDocument(d) {
  return Object.fromEntries(['id','schema_version','catalog_version','scope','fen_before','move_uci','context','concepts','extra_concepts','explanation','annotator','source'].map(k=>[k,d[k]]));
}
function validateLocal(d) {
  if(d.schema_version!=='chess-annotation-1'||d.catalog_version!==catalog.version) throw Error(t('This backup uses a different schema or concept library.','备份的数据格式或概念库版本不兼容。'));
  if(!/^[0-9a-f-]{36}$/i.test(d.id)||!d.context||!Array.isArray(d.context.moves_uci)) throw Error(t('Invalid annotation record.','标注记录格式错误。'));
  const ids=catalog.concepts.map(c=>c.id);
  if(!d.concepts||Object.keys(d.concepts).length!==ids.length||!ids.every(k=>d.concepts[k]===0||d.concepts[k]===1)) throw Error(t('Invalid concept vector.','概念向量不完整或不合法。'));
  if(typeof d.explanation!=='string'||typeof d.annotator!=='string'||typeof d.extra_concepts!=='string') throw Error(t('Invalid text fields.','文本字段不合法。'));
  const b=boardOf(d); if(b.fen()!==new Chess(d.fen_before).fen()) throw Error(t('Position and move history do not match.','棋盘与历史不匹配。'));
  if(d.scope==='move'&&d.move_uci) applyUci(b,d.move_uci);
  else if(d.scope!=='position'&&d.scope!=='move') throw Error('Invalid scope');
  return inputDocument(d);
}
function newDraft(context, source, target='', scope='move') {
  if(entry()&&!meaningful(entry())) delete workspace.entries[workspace.current];
  const b=new Chess(context.initial_fen); context.moves_uci.forEach(u=>applyUci(b,u));
  const d={id:uid(),schema_version:'chess-annotation-1',catalog_version:catalog.version,scope,
    fen_before:b.fen(),move_uci:scope==='move'?(target||null):null,context:structuredClone(context),
    concepts:Object.fromEntries(catalog.concepts.map(c=>[c.id,0])),extra_concepts:'',explanation:'',
    annotator:localStorage.getItem('chess-annotator-name')||'',source};
  workspace.current=d.id; workspace.entries[d.id]={document:d,revision:0,dirty:true,touched_at:new Date().toISOString()};
  preview=false; selected=null; persist(); renderAll();
}
function changeTarget(uci, scope=doc().scope) {
  if(meaningful(entry())) newDraft(doc().context,doc().source,uci,scope);
  else {doc().scope=scope;doc().move_uci=scope==='move'?(uci||null):null; changed();renderAll();}
}
function changed() {entry().dirty=true;entry().touched_at=new Date().toISOString(); persist();renderMeta();renderRecords();}
function savedStatus() {
  if(storageError) return;
  if(saving) return message(t('Saving and reading back from Z890…','正在写入 Z890 并回读核对……'));
  if(!entry().dirty && entry().receipt) return message(t(`Saved to Z890 · version ${entry().revision} · read-back verified`,`已保存到 Z890 · 第 ${entry().revision} 版 · 已回读核对`),'saved');
  message(t('Draft kept in this browser · not yet saved to Z890.','草稿已保留在本浏览器 · 尚未保存到 Z890。'));
}
function renderMeta() {
  const count=Object.values(doc().concepts).reduce((a,b)=>a+b,0);
  $('selected-count').textContent=t(`${count} / ${catalog.concepts.length} selected`,`已选 ${count} / ${catalog.concepts.length}`);
  $('text-count').textContent=t(`${doc().explanation.length} characters`,`${doc().explanation.length} 字`);
  $('json-preview').textContent=JSON.stringify({scope:doc().scope,move_uci:doc().move_uci,concepts:doc().concepts,explanation:doc().explanation},null,2);
  $('save').disabled=saving; savedStatus();
}
function renderConcepts() {
  const groups=$('concept-groups');groups.replaceChildren();
  const groupNames=[...new Set(catalog.concepts.map(c=>c.group))];
  for(const group of groupNames) {
    const items=catalog.concepts.filter(c=>c.group===group), field=document.createElement('fieldset');field.className='concept-group';
    const legend=document.createElement('legend');legend.textContent=lang==='zh'?group:items[0].group_en;field.append(legend);
    const grid=document.createElement('div');grid.className='concept-options';
    for(const c of items) {
      const label=document.createElement('label');label.className='concept-option';
      const input=document.createElement('input');input.type='checkbox';input.id='concept-'+c.id;input.checked=doc().concepts[c.id]===1;input.dataset.concept=c.id;
      const text=document.createElement('span');text.textContent=name(c);
      const detail=lang==='zh'?c.description:c.description_en;label.title=detail;
      input.addEventListener('change',()=>{doc().concepts[c.id]=input.checked?1:0;changed();});
      const show=()=>$('concept-detail').textContent=name(c)+' — '+detail;
      label.addEventListener('pointerenter',show);input.addEventListener('focus',show);label.addEventListener('click',show);
      label.append(input,text);grid.append(label);
    } field.append(grid);groups.append(field);
  }
  const help=document.createElement('p');help.id='concept-detail';help.textContent=t('Point to a concept, or focus its checkbox, to read its meaning.','悬停或选中概念，可在这里查看它的含义。');groups.append(help);
}
function renderBoard() {
  const d=doc(), b=boardOf(), legal=b.moves({verbose:true}), candidate=legal.find(m=>moveUci(m)===d.move_uci);
  const shown=boardOf();if(preview&&candidate) applyUci(shown,d.move_uci);
  const board=$('board');board.replaceChildren();
  const ranks=flipped?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1];
  const files=flipped?'hgfedcba':'abcdefgh';
  for(const [ri,rank] of ranks.entries()) for(const [fi,file] of [...files].entries()) {
    const sq=file+rank,p=shown.get(sq),button=document.createElement('button');button.type='button';button.className='square';button.dataset.square=sq;
    if((file.charCodeAt(0)-97+rank)%2===1) button.classList.add('dark');
    if(sq===selected) button.classList.add('selected');
    if(selected&&legal.some(m=>m.from===selected&&m.to===sq)) button.classList.add('target');
    if(candidate&&sq===candidate.from) button.classList.add('annotation-from');
    if(candidate&&sq===candidate.to) button.classList.add('annotation-target');
    let label=sq;
    if(p){const img=document.createElement('img');img.src='../causal/static/pieces/'+p.color+p.type.toUpperCase()+'.svg';img.alt='';button.append(img);label+=' '+t(p.color==='w'?'white':'black',p.color==='w'?'白方':'黑方')+' '+t(...pieceNames[p.type]);}
    button.setAttribute('aria-label',label);
    if(fi===0){const span=document.createElement('span');span.className='coordinate rank';span.textContent=rank;button.append(span);}
    if(ri===7){const span=document.createElement('span');span.className='coordinate file';span.textContent=file;button.append(span);}
    button.addEventListener('click',()=>squareClicked(sq));board.append(button);
  }
  $('turn-label').textContent=t(b.turn()==='w'?'White to move':'Black to move',b.turn()==='w'?'白方行棋':'黑方行棋');
  $('position-name').textContent=d.source.startsWith('sample:')?t(samples[d.source.slice(7)].en,samples[d.source.slice(7)].zh):t('Custom position','自定义局面');
  $('before').classList.toggle('active',!preview);$('after').classList.toggle('active',preview);
  $('before').setAttribute('aria-pressed',String(!preview));$('after').setAttribute('aria-pressed',String(preview));
  $('after').disabled=!candidate;$('advance').disabled=!candidate;$('undo').disabled=!d.context.moves_uci.length;
  $('scope').value=d.scope;$('move-row').hidden=d.scope==='position';
  $('target-move').replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=t('Choose a legal move…','选择一个合法着法……');$('target-move').append(empty);
  for(const m of legal.sort((a,b)=>a.san.localeCompare(b.san))){const o=document.createElement('option');o.value=moveUci(m);o.textContent=`${m.san} · ${m.from} → ${m.to}`;$('target-move').append(o);}
  $('target-move').value=d.move_uci||'';
  $('target-summary').textContent=d.scope==='position'?t('Explain the position shown before any candidate move.','解释走子前的整个局面。'):candidate?t(`Explaining ${candidate.san} · ${candidate.from} → ${candidate.to}${candidate.promotion?' · promotion to '+candidate.promotion.toUpperCase():''}`,`正在解释 ${candidate.san} · ${candidate.from} → ${candidate.to}${candidate.promotion?' · 升变为 '+candidate.promotion.toUpperCase():''}`):t('Select a move on the board or in the list.','请在棋盘或列表中选择要解释的着法。');
  $('history-label').textContent=t(`${d.context.moves_uci.length} plies since import`,`自导入起 ${d.context.moves_uci.length} 个半回合`);
  $('board-message').textContent=preview?t('Previewing the chosen move. The annotation stays linked to the position before it.','正在预览所选着法；标注仍绑定走子前的局面。'):t('Click a piece, then its destination, to choose the move to explain.','点击棋子，再点击目标格，选择要解释的着法。');
  $('fen-display').textContent=d.fen_before;
}
function squareClicked(square) {
  if(preview){preview=false;selected=null;renderBoard();return;}
  const b=boardOf(), moves=b.moves({verbose:true}).filter(m=>m.from===selected&&m.to===square);
  if(moves.length){
    if(moves.length>1){$('promotion-options').replaceChildren();for(const m of moves){const button=document.createElement('button');button.textContent=t(...pieceNames[m.promotion]);button.onclick=()=>{$('promotion-dialog').close();changeTarget(moveUci(m),'move');preview=true;renderBoard();};$('promotion-options').append(button);}$('promotion-dialog').showModal();}
    else {changeTarget(moveUci(moves[0]),'move');preview=true;renderBoard();}return;
  }
  selected=b.get(square)?.color===b.turn()?square:null;renderBoard();
}
function renderAll() {
  $('explanation').value=doc().explanation;$('annotator').value=doc().annotator;$('extra-concepts').value=doc().extra_concepts;
  renderConcepts();renderBoard();renderMeta();renderRecords();renderConnection();
}
function renderConnection() {$('connection-status').textContent=connected?t('Z890 connected','Z890 已连接'):t('Local drafts','本机草稿模式');$('connection-status').classList.toggle('online',connected);}
function renderRecords() {
  const local=Object.values(workspace.entries).filter(e=>e.dirty&&meaningful(e));
  const items=[...local.map(e=>({d:e.document,local:true,revision:e.revision})),...records.map(d=>({d,local:false,revision:d.revision}))];
  $('record-count').textContent=records.length;
  const query=$('record-search').value.trim().toLowerCase();const list=$('records-list');list.replaceChildren();
  for(const item of items){const d=item.d, tags=catalog.concepts.filter(c=>d.concepts[c.id]);
    if(query&&!JSON.stringify([d.explanation,d.annotator,d.move_uci,d.move_san,d.fen_before,...tags.map(c=>[c.name,c.name_en])]).toLowerCase().includes(query))continue;
    const row=document.createElement('article');row.className='record-item';row.dataset.id=d.id;row.dataset.kind=item.local?'draft':'server';
    const info=document.createElement('div'),title=document.createElement('span');title.className='record-title';
    let san=d.move_san;try{if(!san&&d.move_uci) san=applyUci(boardOf(d),d.move_uci).san;}catch{}
    title.textContent=(d.scope==='position'?t('Position','局面'):san||t('Move not selected','未选着法'))+' · '+(d.annotator||t('Unnamed','未署名'));
    const meta=document.createElement('div');meta.className='record-meta'+(item.local?' draft-badge':'');meta.textContent=item.local?t('Local draft · not synced','本机草稿 · 未同步'):t(`Z890 · version ${item.revision}`,`Z890 · 第 ${item.revision} 版`);
    const date=document.createElement('div');date.className='record-meta';date.textContent=(d.updated_at?new Date(d.updated_at).toLocaleString(lang==='zh'?'zh-CN':'en-GB'):'')+' · '+d.id.slice(0,8);
    info.append(title,meta,date);
    const body=document.createElement('div'),ex=document.createElement('div');ex.className='record-explanation';ex.textContent=d.explanation||t('Explanation not written yet.','尚未填写解释。');
    const chips=document.createElement('div');chips.className='record-tags';for(const c of tags){const chip=document.createElement('span');chip.textContent=name(c);chips.append(chip);}body.append(ex,chips);
    const open=document.createElement('button');open.className='secondary record-open';open.textContent=item.local?t('Resume draft','继续草稿'):t('Open record','查看记录');
    open.onclick=()=>{if(item.local){workspace.current=d.id;preview=false;persist();renderAll();window.scrollTo({top:0,behavior:'smooth'});}else loadRecord(d);};
    row.append(info,body,open);list.append(row);
  }
  if(!list.childElementCount){const p=document.createElement('div');p.className='empty-records';p.textContent=t(connected?'No matching annotations yet. Save your first one above.':'Connect to Z890 to see saved records. Your local drafts will appear here.','暂无匹配记录。连接 Z890 后可查看已保存记录，本机草稿也会显示在这里。');list.append(p);}
}
function loadRecord(d) {
  const existing=workspace.entries[d.id];
  // Keep an unsynced version separately; never overwrite a draft with server data.
  if(existing?.dirty&&meaningful(existing)){
    const copy=structuredClone(existing);copy.document.id=uid();copy.revision=0;delete copy.pending;delete copy.receipt;workspace.entries[copy.document.id]=copy;
    toast(t('Your unsynced edits were kept as a separate draft.','未同步的修改已保留为单独草稿。'));
  }
  workspace.entries[d.id]={document:inputDocument(d),revision:d.revision,dirty:false,receipt:true};workspace.current=d.id;preview=false;selected=null;persist();renderAll();window.scrollTo({top:0,behavior:'smooth'});
}
const validEndpoint = value => typeof value==='string'&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(value);
async function resolveEndpoint(force=false) {
  if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))return location.origin;
  if(!force&&endpoint&&Date.now()-endpointTime<30000)return endpoint;
  const config=window.ANNOTATION_CONFIG||{},sources=[...(config.endpointSources||[])];
  if(force&&config.recoverySource)sources.unshift(config.recoverySource);
  for(const source of sources)try{
    const u=new URL(source,location.href);u.searchParams.set('v',Math.floor(Date.now()/15000));
    const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)continue;
    let data=await r.json();if(data.encoding==='base64')data=JSON.parse(atob(data.content));
    if(!validEndpoint(data.api_origin))continue;endpoint=data.api_origin;endpointTime=Date.now();return endpoint;
  }catch{}
  if(endpoint)return endpoint;
  throw Error(t('Z890 is unavailable. Your draft is kept locally; you can download a backup.','暂时无法连接 Z890。草稿已保留在本机，可以下载备份。'));
}
async function api(path,body,raw=false) {
  const origin=await resolveEndpoint(), headers={'X-Annotation-Client':'1'};
  const token=localStorage.getItem(TOKEN);if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined)headers['Content-Type']='application/json';
  const send=host=>fetch(host+'/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(18000)});
  let response;try{response=await send(origin);}catch{const next=await resolveEndpoint(true);if(next!==origin)response=await send(next);else throw Error(t('Connection interrupted. The draft is still on this device. Retry saving or download a backup.','连接中断。草稿仍保留在本机，请重试保存或下载备份。'));}
  if(!response.ok){if(response.status===401){connected=false;renderConnection();}
    const data=await response.json().catch(()=>({}));
    const errors={401:t('Access code required or incorrect.','访问码未填写或不正确。'),409:t('A newer server version exists. Your draft is safe. Open the server record to compare, or use “New annotation”.','服务器存在更新版本。草稿已保留，请打开服务器记录比较，或使用“同局面新标注”。'),422:t('Please check the position, selected move, annotator name and explanation.','请检查局面、所选着法、标注员称呼和解释。')};
    throw Error(lang==='zh'&&typeof data.detail==='string'?data.detail:errors[response.status]||t('Z890 could not complete the request. Your draft is retained.','Z890 暂时无法完成请求，草稿已保留。'));
  }
  return raw?response:response.json();
}
async function refreshRecords() { const data=await api('/annotations');records=data.records;connected=true;renderConnection();renderRecords();return data; }
async function save() {
  if(saving)return;
  const target=entry(),d=target.document;
  if(!d.annotator.trim()||!d.explanation.trim()){message(t('Add your name or research ID and a written explanation before saving.','请先填写标注员称呼和人工解释。'),'failed');return;}
  if(d.scope==='move'&&!d.move_uci){message(t('Choose the move you are explaining.','请先选择要解释的着法。'),'failed');return;}
  if(!connected){$('connection-dialog').showModal();return;}
  const snapshot=structuredClone(d), snapshotText=JSON.stringify(snapshot);
  if(!target.pending||target.pending.text!==snapshotText)target.pending={text:snapshotText,body:{operation_id:uid(),expected_revision:target.revision,document:snapshot}};
  persist();saving=true;renderMeta();
  try{
    const receipt=await api('/annotations',target.pending.body);
    const readback=await api('/annotations/'+d.id);
    if(readback.sha256!==receipt.sha256||readback.document.revision!==receipt.document.revision)throw Error(t('The saved record changed during verification. Keep this draft and refresh records before retrying.','回读时记录发生变化，草稿已保留，请刷新服务器记录。'));
    target.revision=receipt.document.revision;target.receipt=receipt.sha256;target.dirty=JSON.stringify(target.document)!==snapshotText;delete target.pending;
    persist();records=[receipt.document,...records.filter(r=>r.id!==d.id)];connected=true;
    saving=false;renderMeta();renderConnection();renderRecords();
    toast(t(`Saved to Z890 and verified · ${receipt.document.id.slice(0,8)}`,`已保存并回读核对 · ${receipt.document.id.slice(0,8)}`));
  }catch(error){saving=false;target.dirty=true;persist();renderMeta();message(error.message+' '+t('Not confirmed saved.','尚未确认保存成功。'),'failed');renderRecords();}
}
function download(blob,filename) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function draftEnvelope(entries) {return {schema_version:'chess-annotation-backup-1',catalog,exported_at:new Date().toISOString(),entries};}
async function exportServer(format) {
  try{
    const response=await api('/export?format='+format,undefined,true),blob=await response.blob();
    if(!blob.size)throw Error(t('The export was empty. Please retry.','导出为空，请重试。'));
    const text=await blob.text();if(format==='json')JSON.parse(text);else if(format==='jsonl')text.split('\n').filter(Boolean).forEach(line=>JSON.parse(line));else if(!text.includes('fen_before'))throw Error('Invalid CSV');
    download(blob,`chess-annotations-${new Date().toISOString().slice(0,10)}.${format}`);
    $('download-message').textContent=t(`${format.toUpperCase()} download started · ${blob.size.toLocaleString()} bytes · server records only`,`${format.toUpperCase()} 下载已发起 · ${blob.size.toLocaleString()} 字节 · 仅含服务器记录`);
  }catch(error){$('download-message').textContent=error.message;toast(error.message);}
}
function exportLocal(currentOnly=false) {
  const rows=currentOnly?[entry()]:Object.values(workspace.entries).filter(meaningful);
  download(new Blob([JSON.stringify(draftEnvelope(rows),null,2)],{type:'application/json;charset=utf-8'}),`chess-${currentOnly?'annotation':'drafts'}-${new Date().toISOString().slice(0,10)}.json`);
  $('download-message').textContent=t(`Backup download started · ${rows.length} record(s) · includes unsynced drafts`,`备份下载已发起 · ${rows.length} 条 · 包含未同步草稿`);
}
async function importBackup(file) {
  if(!file)return;if(file.size>20_000_000)throw Error(t('Backup is too large (maximum 20 MB).','备份过大，最多 20 MB。'));
  const data=JSON.parse(await file.text());
  const rows=data.schema_version==='chess-annotation-backup-1'?data.entries:data.records?.map(d=>({document:d,revision:d.revision||0}));
  if(!Array.isArray(rows)||rows.length>5000)throw Error(t('Choose a JSON export or backup from this annotation tool.','请选择本工具导出的 JSON 数据或备份。'));
  const checked=rows.map(e=>({document:validateLocal(e.document),revision:Number(e.revision)||0,dirty:true}));
  let added=0;
  for(const e of checked){
    const existing=workspace.entries[e.document.id];
    if(existing){if(JSON.stringify(existing.document)===JSON.stringify(e.document))continue; e.document.id=uid();e.revision=0;}
    workspace.entries[e.document.id]=e;added++;
  }
  persist();renderRecords();toast(t(`Imported ${added} draft(s). Nothing was overwritten or submitted.`,`已导入 ${added} 条草稿，未覆盖原记录，也未自动提交。`));
}
// Static interface translation. The source text remains available for switching back.
const staticPairs = {
  '连接设置':'Connection', '观察局面 · 选择理由 · 写下解释':'OBSERVE · SELECT CONCEPTS · EXPLAIN',
  '把你的棋局理解，留下来。':'Capture the thinking behind a move.',
  '在左侧选择局面和着法，在右侧勾选相关概念，写下你自己的解释。':'Choose a position and move, select relevant concepts, then write your explanation.',
  '查看标注记录':'Annotations', '走之前':'Before', '走之后':'After', '继续这一步 →':'Continue this move →',
  '标注对象':'Explain', '解释一个着法':'A move', '解释当前局面':'The position', '选择着法':'Move',
  '← 上一步':'← Undo move', '同局面新标注':'New annotation', '更换局面 · 导入 FEN / PGN':'Change position · FEN / PGN',
  '内置局面':'Example positions', '开局 · 1.d4 d5':'Opening · 1.d4 d5', '中局 · 双方已易位':'Middlegame · both sides castled',
  '残局 · 王兵残局':'Endgame · king and pawn', '标准初始局面':'Standard starting position', '载入局面':'Load position',
  'FEN 棋盘编码':'Position as FEN', '粘贴完整 FEN':'Paste a complete FEN', '载入 FEN':'Load FEN', 'PGN 棋谱':'Game as PGN',
  '例如：1. d4 d5 2. c4 e6':'For example: 1. d4 d5 2. c4 e6', '载入棋谱末尾局面':'Load final position',
  '载入前会保留已有草稿；导入棋谱后可用“上一步”回看。仅导入第一盘棋。':'Existing drafts are retained. Use Undo move to step back through the imported game. Only the first game is loaded.',
  '查看当前 FEN 与结构化数据':'Inspect FEN and structured data', '哪些概念解释了这个选择？':'Which concepts explain this choice?',
  '勾选你认为与解释有关的理由。选中 = 1，未选 = 0。':'Select the reasons relevant to your explanation. Checked = 1; unchecked = 0.',
  '不是看到某个现象就勾选，而是它确实参与你的解释。':'Choose concepts that help explain the decision, rather than simply describe the board.',
  '没有合适的概念？补充说明':'Missing a concept? Add a note', '补充概念':'Additional concepts',
  '可以填写未覆盖的理由，供以后改进概念库':'Add a reason not covered by this library', '用自己的话解释':'Explain in your own words',
  '为什么这样走？对手可能怎样应对？换一种走法会有什么不同？只写你有把握的内容，不要求使用固定句式。':'Why this choice? How might the opponent respond? What changes with an alternative? Write what you can support, in your own style.',
  '人工自然语言解释':'Human-written explanation', '写下你对当前局面或所选着法的解释……':'Write your explanation of this position or move…',
  '标注员称呼':'Annotator', '姓名或研究代号':'Name or research ID', '保存到 Z890':'Save to Z890', '下载本条备份':'Back up this record',
  '点击保存后才提交为正式标注。勾选标签是人工判断，不会被标记为已经证明的因果关系。':'Save submits a human annotation. Concept labels express your judgement; they are not marked as proven causal relations.',
  '标注记录':'Annotations', '服务器记录可以重新打开；本机草稿可继续编辑或重试保存。':'Reopen saved records, or resume a local draft and retry saving.',
  '刷新记录':'Refresh', '搜索解释、标注员、着法或概念':'Search explanations, annotators, moves or concepts',
  '下载 JSON':'Download JSON', '下载所有本机草稿':'Back up all local drafts', '导入 JSON 备份':'Import JSON backup',
  'Chess Studio · 人工解释数据集':'Chess Studio · Human explanation dataset',
  '概念库 v1 · 数据存储于 Z890 ·':'Concept library v1 · Stored on Z890 ·', '返回分析 demo':'Analysis demo',
  '连接标注数据集':'Connect to the collection', '访问码用于读写研究标注。网页托管在 GitHub Pages，记录写入 Z890。':'Use the collection access code to read and save annotations. This page is on GitHub Pages; records are stored on Z890.',
  '标注访问码':'Collection access code', '先保留草稿':'Keep a local draft', '连接 Z890':'Connect to Z890',
  '选择升变棋子':'Choose a promotion', '取消':'Cancel', '翻转棋盘':'Flip board', '棋盘与标注对象':'Board and annotation target',
  '国际象棋棋盘':'Chessboard', '着法预览':'Move preview', '搜索标注记录':'Search annotations'
};
const staticNodes=[];
function captureStatic() {
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode,zh=node.textContent.trim();if(staticPairs[zh])staticNodes.push({node,zh,spacing:node.textContent});}
  for(const el of document.querySelectorAll('[placeholder],[title],[aria-label]'))for(const attr of ['placeholder','title','aria-label']){const zh=el.getAttribute(attr);if(staticPairs[zh])staticNodes.push({el,attr,zh});}
}
function translateStatic() {document.documentElement.lang=lang==='zh'?'zh-CN':'en';document.title=t('Annotation Studio · Chess Studio','棋局标注台 · Chess Studio');
  for(const item of staticNodes){const value=lang==='zh'?item.zh:staticPairs[item.zh];if(item.node)item.node.textContent=item.spacing.replace(item.zh,value);else item.el.setAttribute(item.attr,value);}
  $('language').textContent=lang==='zh'?'EN':'中文';
}
function bind() {
  $('language').onclick=()=>{lang=lang==='zh'?'en':'zh';localStorage.setItem('chess-annotation-language',lang);translateStatic();renderAll();};
  $('flip').onclick=()=>{flipped=!flipped;renderBoard();};$('before').onclick=()=>{preview=false;renderBoard();};$('after').onclick=()=>{preview=true;selected=null;renderBoard();};
  $('target-move').onchange=e=>{changeTarget(e.target.value);preview=!!doc().move_uci;renderBoard();};
  $('scope').onchange=e=>changeTarget('',e.target.value);
  $('advance').onclick=()=>{const context=structuredClone(doc().context);context.moves_uci.push(doc().move_uci);newDraft(context,doc().source);};
  $('undo').onclick=()=>{const context=structuredClone(doc().context);context.moves_uci.pop();newDraft(context,doc().source);};
  $('fresh').onclick=()=>newDraft(doc().context,doc().source,doc().move_uci,doc().scope);
  $('explanation').oninput=e=>{doc().explanation=e.target.value;changed();};
  $('annotator').oninput=e=>{doc().annotator=e.target.value;try{localStorage.setItem('chess-annotator-name',e.target.value);}catch{}changed();};
  $('extra-concepts').oninput=e=>{doc().extra_concepts=e.target.value;changed();};
  $('load-sample').onclick=()=>{const key=$('sample').value,s=samples[key];newDraft({initial_fen:s.fen,moves_uci:s.moves},'sample:'+key,s.target);};
  $('load-fen').onclick=()=>{try{const b=new Chess($('fen-input').value.trim());newDraft({initial_fen:b.fen(),moves_uci:[]},'FEN');}catch{toast(t('Invalid FEN. Your current annotation has not changed.','FEN 不合法，当前标注未改变。'));}};
  $('load-pgn').onclick=()=>{try{const b=new Chess();b.loadPgn($('pgn-input').value);const h=b.history({verbose:true});newDraft({initial_fen:h[0]?.before||b.fen(),moves_uci:h.map(moveUci)},'PGN');}catch{toast(t('Could not read this PGN. Your annotation has not changed.','无法读取该 PGN，当前标注未改变。'));}};
  $('save').onclick=save;$('export-draft').onclick=()=>exportLocal(true);$('export-local').onclick=()=>exportLocal(false);
  for(const format of ['json','jsonl','csv'])$('export-'+format).onclick=()=>exportServer(format);
  $('import-backup').onchange=async e=>{try{await importBackup(e.target.files[0]);}catch(error){toast(error.message);}finally{e.target.value='';}};
  $('record-search').oninput=renderRecords;$('view-records').onclick=()=>$('records-panel').scrollIntoView({behavior:'smooth'});
  $('refresh-records').onclick=()=>refreshRecords().catch(error=>toast(error.message));
  $('connect').onclick=()=>$('connection-dialog').showModal();$('close-connection').onclick=()=>$('connection-dialog').close();
  $('close-promotion').onclick=()=>$('promotion-dialog').close();
  $('connection-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{
    const result=await api('/login',{code:$('access-code').value});localStorage.setItem(TOKEN,result.token);$('access-code').value='';
    await refreshRecords();$('connection-dialog').close();$('login-error').classList.add('hidden');toast(t('Connected. You can now save to Z890.','已连接，可以保存到 Z890。'));
  }catch(error){$('login-error').textContent=error.message;$('login-error').classList.remove('hidden');}finally{button.disabled=false;}};
}
async function init() {
  captureStatic();translateStatic();
  catalog=await (await fetch('./static/catalog.json')).json();
  const stored=localStorage.getItem(KEY);if(stored){try{const parsed=JSON.parse(stored);for(const e of Object.values(parsed.entries))validateLocal(e.document);workspace=parsed;}catch{toast(t('A previous workspace could not be loaded. It was preserved as a recovery backup.','旧草稿无法载入，已保留为恢复备份。'));try{localStorage.setItem(KEY+'-recovery-'+Date.now(),stored);}catch{}}}
  bind();
  const params=new URLSearchParams(location.search),fen=params.get('fen');
  if(fen){try{const b=new Chess(fen),move=params.get('move')||'';if(move)applyUci(new Chess(fen),move);newDraft({initial_fen:b.fen(),moves_uci:[]},'analysis-demo',move);}catch{toast(t('The linked position is invalid.','链接中的局面不合法。'));}}
  if(!entry()){const s=samples.opening;newDraft({initial_fen:s.fen,moves_uci:s.moves},'sample:opening',s.target);}else renderAll();
  const hash=new URLSearchParams(location.hash.slice(1)),invite=hash.get('access');if(invite){history.replaceState(null,'',location.pathname+location.search);try{const result=await api('/login',{code:invite});localStorage.setItem(TOKEN,result.token);}catch(error){toast(error.message);}}
  if(localStorage.getItem(TOKEN))try{await refreshRecords();}catch(error){connected=false;renderConnection();toast(error.message);}else renderConnection();
}
init().catch(error=>{message(t('Could not start the annotation tool: ','标注工具加载失败：')+error.message,'failed');console.error(error);});
