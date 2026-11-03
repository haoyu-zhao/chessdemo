import { Chess } from './vendor/chess.js';
const $ = id => document.getElementById(id);
const KEY = 'chess-annotation-workspace-1', TOKEN = 'chess-annotation-session-1';
const t = (en, zh) => lang === 'zh' ? zh : en;
let lang = localStorage.getItem('chess-annotation-language') || 'en';
let catalog, workspace = {current:null, entries:{}, analyses:{}}, records = [], connected = false;
let variationStep = null;
const engineRequests = new Map();
const engineErrors = new Map();
let flipped = false, preview = false, selected = null, saving = false, toastTimer, storageError = false;
let endpoint = '', endpointTime = 0;
const initial = new Chess().fen();
const samples = {
  opening: {fen:initial, moves:['d2d4','d7d5'], target:'', en:'Opening · 1.d4 d5', zh:'开局 · 1.d4 d5'},
  middle: {fen:'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7', moves:[], target:'', en:'Middlegame · both sides castled', zh:'中局 · 双方已易位'},
  ending: {fen:'8/4k3/8/3P4/4K3/8/8/8 w - - 0 1', moves:[], target:'', en:'Endgame · king and pawn', zh:'残局 · 王兵残局'},
  initial: {fen:initial, moves:[], target:'', en:'Standard starting position', zh:'标准初始局面'}
};
const uid = () => crypto.randomUUID();
const entry = () => workspace.entries[workspace.current];
const doc = () => entry().document;
const moveUci = m => m.from + m.to + (m.promotion || '');
const applyUci = (board, uci) => board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
const pieceNames = {p:['pawn','兵'],n:['knight','马'],b:['bishop','象'],r:['rook','车'],q:['queen','后'],k:['king','王']};
const sideName = color => color==='w'?t('White','白方'):t('Black','黑方');
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
  return Object.fromEntries(['id','schema_version','catalog_version','scope','fen_before','move_uci','context','concepts','extra_concepts','explanation','annotator','source','engine_analysis_id'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
}
function validateLocal(d) {
  if(!['chess-annotation-1','chess-annotation-2'].includes(d.schema_version)||d.catalog_version!==catalog.version) throw Error(t('This backup uses a different schema or concept library.','备份的数据格式或概念库版本不兼容。'));
  if(!/^[0-9a-f-]{36}$/i.test(d.id)||!d.context||!Array.isArray(d.context.moves_uci)) throw Error(t('Invalid annotation record.','标注记录格式错误。'));
  const ids=catalog.concepts.map(c=>c.id);
  if(!d.concepts||Object.keys(d.concepts).length!==ids.length||!ids.every(k=>d.concepts[k]===0||d.concepts[k]===1)) throw Error(t('Invalid concept vector.','概念向量不完整或不合法。'));
  if(typeof d.explanation!=='string'||typeof d.extra_concepts!=='string') throw Error(t('Invalid text fields.','文本字段不合法。'));
  const b=boardOf(d); if(b.fen()!==new Chess(d.fen_before).fen()) throw Error(t('Position and move history do not match.','棋盘与历史不匹配。'));
  if(d.scope==='move'&&d.move_uci) applyUci(b,d.move_uci);
  else if(d.scope!=='position'&&d.scope!=='move') throw Error('Invalid scope');
  return inputDocument(d);
}
function newDraft(context, source, target='', scope='move') {
  if(entry()&&!meaningful(entry())) delete workspace.entries[workspace.current];
  const b=new Chess(context.initial_fen); context.moves_uci.forEach(u=>applyUci(b,u));
  const d={id:uid(),schema_version:'chess-annotation-2',catalog_version:catalog.version,scope,
    fen_before:b.fen(),move_uci:scope==='move'?(target||null):null,context:structuredClone(context),
    concepts:Object.fromEntries(catalog.concepts.map(c=>[c.id,0])),extra_concepts:'',explanation:'',
    source,engine_analysis_id:null};
  workspace.current=d.id; workspace.entries[d.id]={document:d,revision:0,dirty:true,touched_at:new Date().toISOString()};
  flipped=b.turn()==='b';preview=false; selected=null; variationStep=null;bindAvailableAnalysis();persist(); renderAll();loadEngine();
}
function changeTarget(uci, scope=doc().scope) {
  if(doc().move_uci===uci&&doc().scope===scope)return;
  if(meaningful(entry())) newDraft(doc().context,doc().source,uci,scope);
  else {doc().scope=scope;doc().move_uci=scope==='move'?(uci||null):null;doc().engine_analysis_id=null;bindAvailableAnalysis();variationStep=null;changed();renderAll();}
}
function changed() {entry().dirty=true;entry().touched_at=new Date().toISOString(); persist();renderMeta();renderRecords();}
function savedStatus() {
  if(storageError) return;
  if(saving) return message(t('Saving annotation…','正在保存标注……'));
  if(!entry().dirty && entry().receipt) return message(t('Annotation saved.','标注已保存。'),'saved');
  message(t('Draft kept on this device. Save or download when ready.','草稿已保留在本机，完成后可以保存或下载。'));
}
function renderMeta() {
  const count=Object.values(doc().concepts).reduce((a,b)=>a+b,0);
  $('selected-count').textContent=t(`${count} / ${catalog.concepts.length} selected`,`已选 ${count} / ${catalog.concepts.length}`);
  $('text-count').textContent=t(`${doc().explanation.length} characters`,`${doc().explanation.length} 字`);
  $('json-preview').textContent=JSON.stringify({scope:doc().scope,move_uci:doc().move_uci,engine_analysis_id:doc().engine_analysis_id,concepts:doc().concepts,explanation:doc().explanation},null,2);
  const c=currentAnalysis()?.candidates.find(c=>c.uci===doc().move_uci);
  const side=sideName(boardOf().turn());
  $('explanation-target').textContent=c?t(`Explain why ${side} plays ${c.san} in this position.`,`解释${side}在当前局面下为什么走 ${c.san}。`):t(`Choose a move for ${side} on the left.`,`先在左侧选择${side}的着法。`);
  $('save').disabled=saving;renderTurnFlow();savedStatus();
}
function renderTurnFlow(){
  const b=boardOf(),d=doc(),side=sideName(b.turn()),nextSide=sideName(b.turn()==='w'?'b':'w');
  const candidate=b.moves({verbose:true}).find(m=>moveUci(m)===d.move_uci);
  const terminal=b.isGameOver()||currentAnalysis()?.status==='terminal';
  let ends=false;if(candidate){const after=boardOf();applyUci(after,d.move_uci);ends=after.isGameOver();}
  $('save-next').disabled=saving||!candidate||!d.engine_analysis_id||terminal;
  $('advance').disabled=saving||!candidate||terminal;
  $('save-next').textContent=saving?t('Saving…','正在保存……'):ends?t('Save & finish game','保存并结束对局'):t(`Save & switch to ${nextSide} →`,`保存并进入${nextSide}回合 →`);
  $('advance').textContent=ends?t('Finish game without saving →','跳过本步标注，结束对局 →'):t(`Skip annotation & switch to ${nextSide} →`,`跳过本步标注，进入${nextSide}回合 →`);
  $('turn-task').textContent=terminal?t('Game over','对局已结束'):candidate?t(`Annotate ${side}’s ${candidate.san}`,`本步标注：${side} ${candidate.san}`):t(`${side} to move`,`现在轮到${side}`);
  $('turn-help').textContent=terminal?t('Start a new game to collect more annotations.','点击“新对局”继续采集标注。'):candidate?t(`Select concepts and write an explanation. “Save & switch” plays ${candidate.san} and opens ${nextSide}’s annotation. Skipping keeps any unfinished text as a local draft.`,`勾选概念并填写解释，点击右侧“保存并换边”后走出 ${candidate.san}，开始${nextSide}的标注。跳过时，已填写内容会保留为本机草稿。`):t(`Waiting for ${side}’s move suggestions.`,`正在等待${side}的候选着法。`);
  const history=b.history({verbose:true});
  $('played-moves').textContent=history.length?t('Played: ','已走：')+history.slice(-16).map(m=>`${m.before.split(' ')[5]}${m.color==='w'?'.':'…'} ${m.san}`).join('  '):t('No moves played yet. Candidate moves are previews until you switch turns.','尚未正式走子。候选着法仅供预览，换边后才会计入对局。');
  $('board').dataset.orientation=flipped?'black':'white';
}
function advanceTurn(){
  if(saving||!doc().move_uci||boardOf().isGameOver())return;
  const context=structuredClone(doc().context),move=doc().move_uci,b=boardOf();
  applyUci(b,move);context.moves_uci.push(move);newDraft(context,doc().source);
  $('turn-label').scrollIntoView({behavior:'smooth',block:'start'});
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
  const shown=variationStep?new Chess(variationStep.fen_after):boardOf();if(!variationStep&&preview&&candidate) applyUci(shown,d.move_uci);
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
  const side=sideName(b.turn()),number=b.fen().split(' ')[5];
  $('turn-label').textContent=b.isGameOver()?t('Game over','对局已结束'):preview&&candidate?t(`${number}${b.turn()==='w'?'.':'…'} ${side} · ${candidate.san} preview`,`第 ${number} 回合 · ${side} ${candidate.san} 预览`):t(`Move ${number} · ${side} to move`,`第 ${number} 回合 · ${side}行棋`);
  $('position-name').textContent=d.context.moves_uci.length?t('Game in progress','对局进行中'):d.source.startsWith('sample:')?t(samples[d.source.slice(7)].en,samples[d.source.slice(7)].zh):t('Custom position','自定义局面');
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
  $('board-message').textContent=variationStep?t(`Variation preview only. You are still annotating ${side}’s first move.`,`仅预览后续变化，当前仍在标注${side}的第一步。`):preview?t(`Preview only — explain ${side}’s move, then use “Save & switch” to start the other side’s turn.`,`这只是预览。请解释${side}这一步，再点击“保存并换边”，进入对方回合。`):t('Choose a suggested move below, explain it, then save and switch turns.','选择下方候选着法，填写解释，然后保存并换边。');
  $('fen-display').textContent=d.fen_before;
  renderTurnFlow();
}
function squareClicked(square) {
  if(preview||variationStep){toast(t('This is a preview. Save & switch turns, or skip this annotation, to play the other side.','当前是预览，请先“保存并换边”或跳过本步标注，再走对方的棋。'));return;}
  const b=boardOf(), moves=b.moves({verbose:true}).filter(m=>m.from===selected&&m.to===square);
  if(moves.length){
    if(moves.length>1){$('promotion-options').replaceChildren();for(const m of moves){const button=document.createElement('button');button.textContent=t(...pieceNames[m.promotion]);button.onclick=()=>{$('promotion-dialog').close();changeTarget(moveUci(m),'move');preview=true;renderBoard();};$('promotion-options').append(button);}$('promotion-dialog').showModal();}
    else {changeTarget(moveUci(moves[0]),'move');preview=true;renderBoard();}return;
  }
  selected=b.get(square)?.color===b.turn()?square:null;renderBoard();
}
function renderAll() {
  $('explanation').value=doc().explanation;$('extra-concepts').value=doc().extra_concepts;
  renderConcepts();renderBoard();renderMeta();renderRecords();renderConnection();renderEngine();
}
function renderConnection() {$('connection-status').textContent=connected?t('Ready','就绪'):t('Draft mode','草稿模式');$('connection-status').classList.toggle('online',connected);}
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
    const turnBoard=boardOf(d),prefix=turnBoard.fen().split(' ')[5]+(turnBoard.turn()==='w'?'. ':'… ')+sideName(turnBoard.turn())+' · ';
    title.textContent=prefix+(d.scope==='position'?t('Position','局面'):san||t('Move not selected','未选着法'));
    const meta=document.createElement('div');meta.className='record-meta'+(item.local?' draft-badge':'');meta.textContent=item.local?t('Local draft','本机草稿'):t(`Saved · version ${item.revision}`,`已保存 · 第 ${item.revision} 版`);
    const date=document.createElement('div');date.className='record-meta';date.textContent=(d.updated_at?new Date(d.updated_at).toLocaleString(lang==='zh'?'zh-CN':'en-GB'):'')+' · '+d.id.slice(0,8);
    info.append(title,meta,date);
    const body=document.createElement('div'),ex=document.createElement('div');ex.className='record-explanation';ex.textContent=d.explanation||t('Explanation not written yet.','尚未填写解释。');
    const chips=document.createElement('div');chips.className='record-tags';for(const c of tags){const chip=document.createElement('span');chip.textContent=name(c);chips.append(chip);}body.append(ex,chips);
    const open=document.createElement('button');open.className='secondary record-open';open.textContent=item.local?t('Resume draft','继续草稿'):t('Open record','查看记录');
    open.onclick=()=>{if(item.local){workspace.current=d.id;flipped=boardOf().turn()==='b';preview=false;variationStep=null;persist();renderAll();loadEngine();window.scrollTo({top:0,behavior:'smooth'});}else loadRecord(d);};
    row.append(info,body,open);list.append(row);
  }
  if(!list.childElementCount){const p=document.createElement('div');p.className='empty-records';p.textContent=t(connected?'No matching annotations yet. Save your first one above.':'Open your invitation link to see saved records. Local drafts appear here.','暂无匹配记录。使用完整邀请链接可查看已保存标注，本机草稿也会显示在这里。');list.append(p);}
}
function loadRecord(d) {
  const existing=workspace.entries[d.id];
  // Keep an unsynced version separately; never overwrite a draft with server data.
  if(existing?.dirty&&meaningful(existing)){
    const copy=structuredClone(existing);copy.document.id=uid();copy.revision=0;delete copy.pending;delete copy.receipt;workspace.entries[copy.document.id]=copy;
    toast(t('Your unsynced edits were kept as a separate draft.','未同步的修改已保留为单独草稿。'));
  }
  if(d.engine_analysis)workspace.analyses[positionKey(d)]=d.engine_analysis;
  workspace.entries[d.id]={document:inputDocument(d),revision:d.revision,dirty:false,receipt:true,server_document:d};workspace.current=d.id;flipped=boardOf().turn()==='b';preview=false;variationStep=null;selected=null;persist();renderAll();loadEngine();window.scrollTo({top:0,behavior:'smooth'});
}
function positionKey(d=doc()){return JSON.stringify([d.fen_before,d.context.initial_fen,d.context.moves_uci]);}
function currentAnalysis(){return workspace.analyses[positionKey()]||null;}
function bindAvailableAnalysis(){
  const result=currentAnalysis();if(!result||doc().schema_version!=='chess-annotation-2'||!result.candidates.length)return;
  if(!doc().move_uci)doc().move_uci=result.candidates[0].uci;
  if(result.candidates.some(c=>c.uci===doc().move_uci))doc().engine_analysis_id=result.id;
}
async function loadEngine(force=false){
  if(!entry())return;
  const key=positionKey();
  if(currentAnalysis()&&!force){renderEngine();return;}
  if(!connected||engineRequests.has(key)){renderEngine();return;}
  const payload={fen:doc().fen_before,context:structuredClone(doc().context)};
  engineErrors.delete(key);
  const request=api('/analyze',payload);engineRequests.set(key,request);renderEngine();
  try{
    const result=await request;
    if(result.fen!==payload.fen||JSON.stringify(result.context.moves_uci)!==JSON.stringify(payload.context.moves_uci))throw Error(t('The engine returned a different position. Please retry.','引擎返回了其他局面，请重试。'));
    workspace.analyses[key]=result;
    if(positionKey()===key&&!meaningful(entry()))bindAvailableAnalysis();
    persist();
  }catch(error){engineErrors.set(key,error.message);}
  finally{engineRequests.delete(key);if(positionKey()===key){renderEngine();renderBoard();renderMeta();}}
}
function selectEngineCandidate(candidate){
  const result=currentAnalysis();if(!result)return;
  if(doc().move_uci===candidate.uci&&doc().engine_analysis_id===result.id){preview=true;variationStep=null;renderBoard();return;}
  changeTarget(candidate.uci,'move');doc().schema_version='chess-annotation-2';doc().engine_analysis_id=result.id;
  preview=true;variationStep=null;selected=null;changed();renderAll();
}
function scoreText(score){return score.mate!==null?t(`Mate ${score.mate>0?'in ':'against in '}${Math.abs(score.mate)}`,`${score.mate>0?'将杀':'被将杀'} ${Math.abs(score.mate)}`):(score.cp>=0?'+':'')+(score.cp/100).toFixed(2);}
function renderEngine(){
  if(!entry())return;
  const result=currentAnalysis(),key=positionKey(),pending=engineRequests.has(key);
  $('engine-title').textContent=t(`${sideName(boardOf().turn())}’s next move`,`${sideName(boardOf().turn())}的下一步`);$('engine-refresh').disabled=pending;
  $('engine-candidates').replaceChildren();$('engine-pv').replaceChildren();
  $('engine-variation').hidden=!result?.candidates.length;
  if(pending){$('engine-status').textContent=t('Stockfish is searching this position…','Stockfish 正在分析当前局面……');return;}
  if(engineErrors.has(key)){$('engine-status').textContent=engineErrors.get(key);return;}
  if(!result){$('engine-status').textContent=connected?t('Preparing suggestions…','正在准备建议……'):t('Open your invitation link to see engine suggestions and save annotations.','打开完整邀请链接即可查看引擎建议并保存标注。');return;}
  if(result.status==='terminal'){$('engine-status').textContent=t('This game has ended. Start a new game or load another position.','对局已结束，可以开始新对局或载入其他局面。');return;}
  const side=result.score_perspective==='white'?t('White','白方'):t('Black','黑方');
  $('engine-status').textContent=t(`${result.engine.name} · scores from ${side}’s perspective. Select a move to explain.`,`${result.engine.name} · 分数从${side}视角计算。点击一个着法开始解释。`);
  for(const c of result.candidates){
    const button=document.createElement('button');button.className='engine-choice';button.dataset.uci=c.uci;button.dataset.rank=c.rank;
    const active=doc().move_uci===c.uci;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    const label=document.createElement('span');label.className='engine-rank';label.textContent=c.rank===1?t('Recommended','推荐'):t(`Alternative ${c.rank-1}`,`其他选择 ${c.rank-1}`);
    const move=document.createElement('strong');move.textContent=c.san;
    const route=document.createElement('span');route.className='engine-route';route.textContent=c.uci.slice(0,2)+' → '+c.uci.slice(2,4);
    const score=document.createElement('span');score.className='engine-score';score.textContent=scoreText(c.score);
    button.append(label,move,route,score);button.onclick=()=>selectEngineCandidate(c);$('engine-candidates').append(button);
  }
  const candidate=result.candidates.find(c=>c.uci===doc().move_uci);
  $('engine-variation').hidden=!candidate;
  if(candidate){
    $('variation-note').textContent=t('One possible continuation, not a forced sequence. Click a move to preview it.','这是一条可能的续局，不代表每步都是强制的。点击着法可预览。');
    for(const step of candidate.pv_steps){const b=document.createElement('button');b.textContent=step.move_number+(step.side==='white'?'. ':'… ')+step.san;b.onclick=()=>{variationStep=step;preview=true;selected=null;renderBoard();};$('engine-pv').append(b);}
    $('engine-budget').textContent=t(`Search depth ${candidate.depth} · up to 300,000 nodes / 3 seconds. Recommendations can change with a longer search.`,`搜索深度 ${candidate.depth} · 最多 30 万节点／3 秒。更长搜索可能改变推荐。`);
  }
}
async function shareLink(){
  if(!connected){$('connection-dialog').showModal();return;}
  try{const data=await api('/invitation');const link=new URL(data.url);link.pathname=location.pathname;link.search='';
    // Local QA uses the local collector; published pages retain the public address.
    if(['localhost','127.0.0.1'].includes(location.hostname)){link.protocol=location.protocol;link.host=location.host;}
    $('share-url').value=link.href;$('share-dialog').showModal();
    try{await navigator.clipboard.writeText(link.href);toast(t('Invitation link copied. Anyone receiving it can start annotating.','邀请链接已复制，收到的人打开即可开始标注。'));}catch{$('share-url').select();}
  }catch(error){toast(error.message);}
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
  throw Error(t('The collection is unavailable. Your draft is safe and can still be downloaded.','暂时无法连接标注服务，草稿已保留，仍可下载。'));
}
async function api(path,body,raw=false) {
  const origin=await resolveEndpoint(), headers={'X-Annotation-Client':'1'};
  const token=localStorage.getItem(TOKEN);if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined)headers['Content-Type']='application/json';
  const send=host=>fetch(host+'/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(18000)});
  let response;try{response=await send(origin);}catch{const next=await resolveEndpoint(true);if(next!==origin)response=await send(next);else throw Error(t('Connection interrupted. The draft is still on this device. Retry saving or download a backup.','连接中断。草稿仍保留在本机，请重试保存或下载备份。'));}
  if(!response.ok){if(response.status===401){connected=false;renderConnection();}
    const data=await response.json().catch(()=>({}));
    const errors={401:t('Please open the complete invitation link.','请打开完整邀请链接。'),409:t('A newer saved version exists. Your draft is safe. Open that record to compare, or use “New annotation”.','已有更新版本。草稿已保留，请打开已保存记录比较，或使用“同局面新标注”。'),422:t('Please check the position, engine suggestion and explanation.','请检查局面、引擎候选着法和解释。')};
    throw Error(lang==='zh'&&typeof data.detail==='string'?data.detail:errors[response.status]||t('The request could not be completed. Your draft is retained.','暂时无法完成请求，草稿已保留。'));
  }
  return raw?response:response.json();
}
async function refreshRecords() { const data=await api('/annotations');records=data.records;connected=true;renderConnection();renderRecords();loadEngine();return data; }
async function save({advance=false}={}) {
  if(saving)return;
  const target=entry(),d=target.document;
  if(!d.explanation.trim()){message(t('Write your explanation before saving.','请先填写解释。'),'failed');return;}
  if(d.scope==='move'&&!d.move_uci){message(t('Choose the move you are explaining.','请先选择要解释的着法。'),'failed');return;}
  if(!connected){$('connection-dialog').showModal();return;}
  if(d.schema_version==='chess-annotation-2'&&!d.engine_analysis_id){message(t('Choose an engine suggestion to link your explanation to its analysis.','请先点击引擎候选着法，将解释与引擎分析绑定。'),'failed');return;}
  if(advance&&!target.dirty&&target.receipt){advanceTurn();return;}
  const snapshot=structuredClone(d), snapshotText=JSON.stringify(snapshot);
  if(!target.pending||target.pending.text!==snapshotText)target.pending={text:snapshotText,body:{operation_id:uid(),expected_revision:target.revision,document:snapshot}};
  persist();saving=true;renderMeta();
  try{
    const receipt=await api('/annotations',target.pending.body);
    const readback=await api('/annotations/'+d.id);
    if(readback.sha256!==receipt.sha256||readback.document.revision!==receipt.document.revision)throw Error(t('The saved record changed during verification. Keep this draft and refresh records before retrying.','回读时记录发生变化，草稿已保留，请刷新服务器记录。'));
    target.revision=receipt.document.revision;target.receipt=receipt.sha256;target.server_document=receipt.document;target.dirty=JSON.stringify(target.document)!==snapshotText;delete target.pending;
    persist();records=[receipt.document,...records.filter(r=>r.id!==d.id)];connected=true;
    saving=false;renderMeta();renderConnection();renderRecords();
    if(advance&&workspace.current===d.id&&!target.dirty){
      const side=sideName(boardOf().turn());advanceTurn();
      toast(boardOf().isGameOver()?t(`${side}’s annotation saved. Game over.`,`${side}标注已保存，对局结束。`):t(`${side}’s annotation saved. Now annotate ${sideName(boardOf().turn())}’s move.`,`${side}标注已保存，现在请标注${sideName(boardOf().turn())}的着法。`));
    }else if(advance&&workspace.current===d.id&&target.dirty){message(t('The earlier text was saved, but you edited it while saving. Review your changes and save again before switching turns.','先前内容已保存，但保存期间又有修改。请检查并再次保存后换边。'),'failed');}
    else toast(t('Annotation saved.','标注已保存。'));
  }catch(error){saving=false;target.dirty=true;persist();renderMeta();message(error.message+' '+t('Not confirmed saved.','尚未确认保存成功。'),'failed');renderRecords();}
}
function download(blob,filename) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function localDocument(e){
  if(!e.dirty&&e.server_document)return e.server_document;
  const d=structuredClone(e.document),b=boardOf(d),analysis=workspace.analyses[positionKey(d)];
  d.side_to_move=b.turn()==='w'?'white':'black';d.move_san=null;
  if(d.move_uci){const moved=applyUci(b,d.move_uci);d.move_san=moved.san;}
  d.fen_after=b.fen();d.status='draft';d.label_source='human';d.causal_verification='not_performed';
  d.attribute_order=catalog.concepts.map(c=>c.id);d.attribute_vector=d.attribute_order.map(k=>d.concepts[k]);
  d.selected_concepts=catalog.concepts.filter(c=>d.concepts[c.id]);d.concept_semantics=catalog.semantics;
  d.engine_analysis=analysis&&analysis.id===d.engine_analysis_id?analysis:null;
  d.engine_action=d.engine_analysis?.candidates.find(c=>c.uci===d.move_uci)||null;
  d.action_source=d.engine_action?'stockfish':'manual_unbound';d.last_saved_revision=e.revision;
  return d;
}
function draftEnvelope(entries) {return {schema_version:'chess-annotation-backup-1',catalog,exported_at:new Date().toISOString(),
  count:entries.length,records:entries.map(localDocument),entries,engine_analyses:workspace.analyses};}
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
  for(const r of data.records||[])if(r.engine_analysis)workspace.analyses[positionKey(r)]=r.engine_analysis;
  for(const [key,a] of Object.entries(data.engine_analyses||{}))if(a&&Array.isArray(a.candidates))workspace.analyses[key]=a;
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
  '① 选择当前一方的着法':'① Choose a move for the current side',
  '② 勾选概念，填写解释':'② Select concepts and explain',
  '③ 保存并换边，继续标注':'③ Save, switch sides and repeat',
  '仅保存标注':'Save without switching',
  '观察局面 · 选择着法 · 解释理由':'POSITION · ENGINE MOVE · YOUR EXPLANATION',
  '为什么在这里走这一步？':'Why this move, in this position?',
  '查看引擎的下一步建议，选择一个着法，勾选相关概念并写下你的解释。':'Choose an engine suggestion, select the relevant concepts, and explain why the move makes sense.',
  '分享链接':'Share link', '新对局':'New game', '下一步建议':'Next move suggestions', '刷新建议':'Refresh',
  '查看可能的后续变化':'Explore a possible continuation', '探索其他着法':'Explore other moves',
  '结合当前局面，解释所选着法为什么合理、对手可能怎样应对，以及其他选择有什么不同。':'Explain why this move fits the position, how the opponent might respond, and what changes with other choices.',
  '保存标注':'Save annotation', '保存当前局面、所选引擎着法、概念勾选和你的原文解释。':'Saves the position, selected engine move, concept labels and your original explanation.',
  '搜索解释、着法或概念':'Search explanations, moves or concepts',
  '引擎推荐 · 人工解释 ·':'Engine recommendations · Human explanations ·', '访问设置':'Access settings',
  '打开邀请链接即可开始':'Open your invitation to begin',
  '请使用分享按钮复制的完整链接。已有访问码，也可以在这里输入。':'Use the complete link copied with Share link. If you already have an access code, you can enter it here.',
  '访问码':'Access code', '开始标注':'Start annotating', '分享标注链接':'Share the annotation link',
  '复制完整链接，收到的人打开即可开始。':'Send the complete link. Recipients can open it and start annotating.',
  '复制链接':'Copy link', '关闭':'Close',
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
  '下载标注':'Download annotation', '下载本机全部标注':'Download this device’s annotations',
  '点击保存后才提交为正式标注。勾选标签是人工判断，不会被标记为已经证明的因果关系。':'Save submits a human annotation. Concept labels express your judgement; they are not marked as proven causal relations.',
  '标注记录':'Annotations', '服务器记录可以重新打开；本机草稿可继续编辑或重试保存。':'Reopen saved records, or resume a local draft and retry saving.',
  '刷新记录':'Refresh', '搜索解释、标注员、着法或概念':'Search explanations, annotators, moves or concepts',
  '下载 JSON':'Download saved JSON', '下载所有本机草稿':'Download this device’s annotations', '导入 JSON 备份':'Import JSON backup',
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
  $('flip').onclick=()=>{flipped=!flipped;renderBoard();};$('before').onclick=()=>{preview=false;variationStep=null;renderBoard();};$('after').onclick=()=>{preview=true;variationStep=null;selected=null;renderBoard();};
  $('engine-refresh').onclick=()=>loadEngine(true);$('share-link').onclick=shareLink;
  $('new-game').onclick=()=>newDraft({initial_fen:initial,moves_uci:[]},'sample:initial');
  $('close-share').onclick=()=>$('share-dialog').close();
  $('copy-share').onclick=async()=>{try{await navigator.clipboard.writeText($('share-url').value);toast(t('Link copied.','链接已复制。'));}catch{$('share-url').select();toast(t('Select and copy the link above.','请选中并复制上方链接。'));}};
  $('target-move').onchange=e=>{changeTarget(e.target.value);preview=!!doc().move_uci;renderBoard();};
  $('scope').onchange=e=>changeTarget('',e.target.value);
  $('advance').onclick=advanceTurn;
  $('undo').onclick=()=>{const context=structuredClone(doc().context);context.moves_uci.pop();newDraft(context,doc().source);};
  $('fresh').onclick=()=>newDraft(doc().context,doc().source,doc().move_uci,doc().scope);
  $('explanation').oninput=e=>{doc().explanation=e.target.value;changed();};
  $('extra-concepts').oninput=e=>{doc().extra_concepts=e.target.value;changed();};
  $('load-sample').onclick=()=>{const key=$('sample').value,s=samples[key];newDraft({initial_fen:s.fen,moves_uci:s.moves},'sample:'+key,s.target);};
  $('load-fen').onclick=()=>{try{const b=new Chess($('fen-input').value.trim());newDraft({initial_fen:b.fen(),moves_uci:[]},'FEN');}catch{toast(t('Invalid FEN. Your current annotation has not changed.','FEN 不合法，当前标注未改变。'));}};
  $('load-pgn').onclick=()=>{try{const b=new Chess();b.loadPgn($('pgn-input').value);const h=b.history({verbose:true});newDraft({initial_fen:h[0]?.before||b.fen(),moves_uci:h.map(moveUci)},'PGN');}catch{toast(t('Could not read this PGN. Your annotation has not changed.','无法读取该 PGN，当前标注未改变。'));}};
  $('save').onclick=()=>save();$('save-next').onclick=()=>save({advance:true});$('export-draft').onclick=()=>exportLocal(true);$('export-local').onclick=()=>exportLocal(false);
  for(const format of ['json','jsonl','csv'])$('export-'+format).onclick=()=>exportServer(format);
  $('import-backup').onchange=async e=>{try{await importBackup(e.target.files[0]);}catch(error){toast(error.message);}finally{e.target.value='';}};
  $('record-search').oninput=renderRecords;$('view-records').onclick=()=>$('records-panel').scrollIntoView({behavior:'smooth'});
  $('refresh-records').onclick=()=>refreshRecords().catch(error=>toast(error.message));
  $('connect').onclick=()=>$('connection-dialog').showModal();$('close-connection').onclick=()=>$('connection-dialog').close();
  $('close-promotion').onclick=()=>$('promotion-dialog').close();
  $('connection-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{
    const result=await api('/login',{code:$('access-code').value});localStorage.setItem(TOKEN,result.token);$('access-code').value='';
    await refreshRecords();$('connection-dialog').close();$('login-error').classList.add('hidden');toast(t('Ready to annotate.','可以开始标注。'));
  }catch(error){$('login-error').textContent=error.message;$('login-error').classList.remove('hidden');}finally{button.disabled=false;}};
}
async function init() {
  captureStatic();translateStatic();
  catalog=await (await fetch('./static/catalog.json')).json();
  const stored=localStorage.getItem(KEY);if(stored){try{const parsed=JSON.parse(stored);for(const e of Object.values(parsed.entries))validateLocal(e.document);workspace=parsed;workspace.analyses||={};}catch{toast(t('A previous workspace could not be loaded. It was preserved as a recovery backup.','旧草稿无法载入，已保留为恢复备份。'));try{localStorage.setItem(KEY+'-recovery-'+Date.now(),stored);}catch{}}}
  bind();
  const params=new URLSearchParams(location.search),fen=params.get('fen');
  if(fen){try{const b=new Chess(fen),move=params.get('move')||'';if(move)applyUci(new Chess(fen),move);newDraft({initial_fen:b.fen(),moves_uci:[]},'analysis-demo',move);}catch{toast(t('The linked position is invalid.','链接中的局面不合法。'));}}
  if(!entry()||(!meaningful(entry())&&doc().schema_version==='chess-annotation-1'))newDraft({initial_fen:initial,moves_uci:[]},'sample:initial');else {flipped=boardOf().turn()==='b';renderAll();}
  const hash=new URLSearchParams(location.hash.slice(1)),invite=hash.get('access');if(invite){history.replaceState(null,'',location.pathname+location.search);try{const result=await api('/login',{code:invite});localStorage.setItem(TOKEN,result.token);}catch(error){toast(error.message);}}
  if(localStorage.getItem(TOKEN))try{await refreshRecords();}catch(error){connected=false;renderConnection();toast(error.message);}else renderConnection();
}
init().catch(error=>{message(t('Could not start the annotation tool: ','标注工具加载失败：')+error.message,'failed');console.error(error);});
