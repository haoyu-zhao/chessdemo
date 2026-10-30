'use strict';
let selectedCandidate=0, selectedAnalysisKey=null, comparisonCandidate=1;
let selectedGoal='preserve_material', trajectoryKind='pv', sampleIndex=0, evidenceRenderKey=null;
const wording=(en,zh)=>lang==='zh'?zh:en;
const eventNames={
  material_preserved:['Net material preserved','净子力不减少'],
  material_gain_ge_1:['Net gain ≥ 1 pawn','净增子力 ≥ 1'],
  net_material_loss_ge_3:['Net loss ≥ 3 pawns','净损子力 ≥ 3'],
  net_material_gain_ge_3:['Net gain ≥ 3 pawns','净增子力 ≥ 3'],
  center_control_ge_2:['Attacks ≥ 2 central squares','攻击至少两个中心格'],
  root_has_absolute_pin:['Own piece absolutely pinned','己方存在绝对牵制'],
  root_checkmated:['Original mover checkmated','原行棋方被将杀'],
  opponent_checkmated:['Opponent checkmated','对手被将杀']
};
const goalNames={preserve_material:['Preserve net material','保住净子力'],gain_material:['Gain ≥ 1 pawn net','净增至少一兵'],avoid_checkmate:['Avoid being checkmated','避免被将杀'],force_mate:['Force checkmate','强制将杀']};
function configureCausalMessages(){
  messages.en.demoC4='Try the c4 comparison · after 1.d4 d5';
  messages.zh.demoC4='分析 c4 对比示例 · 1.d4 d5 后';
  Object.assign(messages.en,{subtitle:'Compare the next moves. Understand the reasons.',thinking:'Behind this move',analysisIntro:'Move explanations from engine evidence',thinkingNow:'Searching, testing hypotheses and revising…',firstMoveTitle:'Start with your first move',firstMoveText:'Make the first move. We will compare candidate replies and explain the evidence.',original:'Position evidence',criticalLine:'Inspect a continuation',rawOutput:'Original records and model text · advanced',ready:'Engine ready',loading:'Connecting to engine',thinkingTime:'{s}s elapsed · Stockfish search and DeepSeek hypothesis verification',researchNote:'Explore the moves and their concrete consequences',helpFoot:'Monte Carlo estimates policy-dependent action effects. Bounded search checks specified goals; it does not establish unrestricted necessity.',analyze:'Analyze this position',queenMove:'Play this move',newGame:'+ New position',chooseSide:'Choose the board orientation or enter a FEN. You can move either side.',playWhite:'White at bottom',playBlack:'Black at bottom',whiteFirst:'Explore both sides',queenFirst:'Explore both sides',start:'Open position',liveHint:'Move either side. Analysis starts after the first opening move.',positionAnalysis:'Current position · {side} to move',pvHint:'Inspecting an evidence line. Select “Live position” to return.',candidate:'CANDIDATE',recommended:'RECOMMENDED MOVE',control:'LOW-RANKED CONTROL',help:['Standard games start analysis after the first move. Other FEN positions are analyzed immediately.','Each first-move intervention gets independent continuations under the same Stockfish softmax policy. All samples are kept.','Select a comparison move. Rate differences and simultaneous confidence intervals concern this policy and horizon.','Choose a goal to inspect sufficiency and necessity across every legal first move. Unknown means the search budget did not settle the result.','Replay a principal variation, a sampled trajectory or a goal-certificate branch. Download the complete JSON evidence.']});
  Object.assign(messages.zh,{subtitle:'比较下一步，读懂每个选择的依据。',thinking:'这一步的思路',analysisIntro:'依据棋局证据解释当前候选着法',thinkingNow:'正在搜索、检验假设与修订…',firstMoveTitle:'从你的第一步开始',firstMoveText:'先走第一步。系统随后比较候选应手，并解释每个选择的依据。',original:'局面证据',criticalLine:'检查一条续局',rawOutput:'原始记录与模型文字 · 高级',ready:'引擎已就绪',loading:'正在连接引擎',thinkingTime:'已等待 {s} 秒 · Stockfish 搜索与 DeepSeek 假设检验',researchNote:'展开分析，查看具体变化与依据',helpFoot:'蒙特卡洛估计固定策略下的首步干预效应。有限搜索检验指定目标，不等于证明一般意义上的必要性。',analyze:'分析当前局面',queenMove:'走这一步',newGame:'＋ 新的局面',chooseSide:'选择棋盘方向或输入 FEN。可为双方走棋。',playWhite:'白方在下',playBlack:'黑方在下',whiteFirst:'可为双方走棋',queenFirst:'可为双方走棋',start:'打开局面',liveHint:'可为双方走棋；标准开局从第一步以后开始分析。',positionAnalysis:'当前局面 · 轮到{side}',pvHint:'正在检查证据续局，点击「当前局面」返回。',candidate:'候选着法',recommended:'推荐着法',control:'较差着法对照',help:['标准开局从走完第一步开始分析；导入其他 FEN 时直接分析。','从同一局面固定不同首步，再按相同的 Stockfish softmax 策略独立采样，保留所有结果。','选择对照着法，查看事件概率差与同时置信区间；结论只针对所用策略和时域。','选择目标，查看所有合法首步的充分性与必要性检验；预算不足会显示未知。','可回放引擎主变、MC 样本或目标证明中的一个分支，并下载完整 JSON 证据。']});
}
function awaitingFirstMove(ply=viewedPly){const key=fen=>fen.split(' ').slice(0,4).join(' ');return !!game&&ply===0&&key(game.initial_fen)===key(initialFen);}
function currentCandidate(){return activeAnalysis()?.candidates?.[selectedCandidate]||null;}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function section(title){const s=element('section',undefined,'evidence-section');s.append(element('h3',title));return s;}
function paragraph(parent,text,cls='evidence-note'){parent.append(element('p',text,cls));}
function percent(n){return (n*100).toFixed(1)+'%';}
function interval(xs,suffix='%'){return xs.map(x=>(x*100).toFixed(1)).join(' … ')+suffix;}
function scoreLabel(s){return s.mate!==null?(s.mate<0?'-M':'M')+Math.abs(s.mate):(s.cp>=0?'+':'')+(s.cp/100).toFixed(2);}
function table(headers,rows){const wrap=element('div',undefined,'evidence-table-wrap'),tb=element('table',undefined,'evidence-table'),head=element('thead'),hr=element('tr');headers.forEach(h=>hr.append(element('th',h)));head.append(hr);tb.append(head);const body=element('tbody');rows.forEach(row=>{const tr=element('tr');row.forEach(value=>tr.append(element('td',value)));body.append(tr);});tb.append(body);wrap.append(tb);return wrap;}
function goalStatus(status){const labels={proven:['Proven for this goal','该目标下已证明'],refuted_within_horizon:['Refuted within this horizon','该时域内已否定'],unknown_budget:['Unknown: node budget exhausted','未知：节点预算耗尽'],necessary:['Necessary for this goal','对该目标必要'],not_necessary:['Not necessary: another move works','不必要：另有着法可达成'],goal_unreachable:['Goal unreachable: necessity not applicable','目标不可达：不作必要性判断'],unknown:['Unknown: alternatives unresolved','未知：仍有替代着法未判定'],not_checked:['Not checked','未检查']};return wording(...(labels[status]||[status,status]));}
function goalInfo(a){return selectedGoal==='force_mate'?a.causal_analysis.bounded_goal:a.causal_analysis.goal_tests[selectedGoal];}
function visibleSteps(){const c=currentCandidate();if(!c)return [];if(trajectoryKind==='counterexample')return counterexampleMove?.pv_steps||[];if(trajectoryKind==='sample')return c.samples[sampleIndex]?.steps||[];if(trajectoryKind==='goal')return c.goal_tests[selectedGoal]?.strategy_example||[];return c.pv_steps||[];}
function canCommitCandidate(){return !!game&&viewedPly===game.moves.length&&(!pvFen||trajectoryKind==='candidate');}
function previewCandidate(i){selectedCandidate=i;comparisonCandidate=i===0?1:0;sampleIndex=0;trajectoryKind='candidate';selected=null;pvIndex=0;pvFen=currentCandidate()?.pv_steps[0]?.fen_after||null;render();}
function refreshLine(){pvFen=null;pvIndex=-1;render();}
function paintEvidence(a,c){
  const root=prepareReadableLayout(a,c);
  const cfg=a.evidence_settings,contract=a.causal_analysis;
  paintConceptAgent(root,a);
  const facts=c.immediate_facts;
  paragraph(root,wording(`Stockfish: ${scoreLabel(c.score)} · ${c.engine.depth} search plies · ${c.engine.nodes.toLocaleString()} nodes. Scores use the original mover's perspective.`,`Stockfish：${scoreLabel(c.score)} · 搜索深度 ${c.engine.depth} 半回合 · ${c.engine.nodes.toLocaleString()} 节点。评分以原行棋方为视角。`));
  paragraph(root,wording(`First-move facts: ${facts.capture?'captures '+facts.capture:'no capture'}; ${facts.check?'check':'no check'}; ${facts.legal_replies} legal opponent replies.`,`首步事实：${facts.capture?'吃子（'+facts.capture+'）':'未吃子'}；${facts.check?'将军':'未将军'}；对手有 ${facts.legal_replies} 个合法应手。`));
  paintMonteCarloHeader(root,a,c);
  const cf=section(wording('Sampled outcome comparison','采样结果：换一步会改变哪些后果？'));
  const label=element('label',wording('Compare against ','对照着法 '));const select=element('select');select.id='counterfactual-choice';
  a.candidates.forEach((other,i)=>{if(i===selectedCandidate)return;const option=element('option',other.san+(other.role==='contrast_control'?wording(' · control',' · 对照'):''));option.value=i;option.selected=i===comparisonCandidate;select.append(option);});
  select.disabled=a.candidates.length<2;select.onchange=()=>{comparisonCandidate=Number(select.value);evidenceRenderKey=null;renderCausalAnalysis();};label.append(select);cf.append(label);
  const b=a.candidates[comparisonCandidate];
  paragraph(cf,wording('Same initial state and history; intervene on the first move. Δ is the selected move’s event rate minus the comparison move’s. A positive difference is not always better: it depends on the event.','保持初始局面与历史相同，只干预首步。Δ = 所选着法事件率 − 对照着法事件率。正值不一定更好，取决于事件是收益还是风险。'));
  const contrast=b?contract.pairwise_effects.find(x=>x.action===c.uci&&x.alternative===b.uci):null;
  const rows=Object.entries(eventNames).filter(([key])=>c.event_estimates[key]).map(([key,names])=>{const r=c.event_estimates[key],rb=b?.event_estimates[key],d=contrast?.events[key];const rate=x=>`${x.successes}/${x.n} · ${percent(x.estimate)}\n[${interval(x.hoeffding_95_simultaneous)}]`;return [wording(...names),rate(r),rb?rate(rb):'—',d?`${d.delta>=0?'+':''}${(d.delta*100).toFixed(1)} pp\n[${interval(d.simultaneous_95,' pp')}]\n${d.resolved?wording('Resolved','已分辨'):wording('Unresolved','未分辨')}`:'—'];});
  cf.append(table([wording('Endpoint event','终点事件'),c.san,b?.san||'—',wording('Δ · 95% interval','Δ · 95% 区间')],rows));
  paragraph(cf,wording('Material: P=1, N=B=3, R=5, Q=9; changes are relative to the starting board. Center = d4/e4/d5/e5; attacks include pinned pieces. Pins, material and center control are measured consequences, not verified strategic causes.','子力：兵=1，马/象=3，车=5，后=9；净变化相对起始局面。中心格为 d4/e4/d5/e5，攻击计数包含受牵制棋子。牵制、子力与中心控制是测得的后果，不是已证实的战略原因。'));
  if(!b)paragraph(cf,wording('Only one legal move: no alternative first-move effect can be estimated.','只有一个合法着法，无法估计与其他首步的差异。'));
  if(cfg.rollouts)root.append(cf);
  const goal=section(wording('Checking a short-term game goal','检查一个短期棋局目标'));
  const goalLabel=element('label',wording('Goal ','目标 ')),goalSelect=element('select');goalSelect.id='goal-choice';
  Object.entries(goalNames).forEach(([key,names])=>{const opt=element('option',wording(...names));opt.value=key;opt.selected=selectedGoal===key;goalSelect.append(opt);});
  goalSelect.onchange=()=>{selectedGoal=goalSelect.value;if(trajectoryKind==='goal')refreshLine();else{evidenceRenderKey=null;renderCausalAnalysis();}};goalLabel.append(goalSelect);goal.append(goalLabel);
  const gi=goalInfo(a),verdict=c.goal_tests[selectedGoal],coverage=gi.coverage;
  paragraph(goal,wording(`Horizon: ${gi.total_plies} total plies including the first move. Endpoint goals stop earlier if the game ends or a draw is claimed. “Preserve” means net material change ≥ 0; “gain” means ≥ 1.`,`时域：共 ${gi.total_plies} 个半回合（包含首步）。终局或申和时提前评价终点。“保住”指净子力变化 ≥ 0，“获得”指 ≥ 1。`));
  goal.append(table([wording('Test','检验'),wording('Result','结论')],[[wording('Sufficiency','充分性'),goalStatus(verdict.sufficiency)],[wording('Necessity','必要性'),goalStatus(verdict.necessity)]]));
  const names=verdict.alternative_certified_actions.map(uci=>a.root_moves.find(r=>r.uci===uci)?.san||uci);
  if(names.length)paragraph(goal,wording('Certified alternatives: ','同样达成目标的已证明替代着法：')+names.join(', '));
  paragraph(goal,wording(`All ${a.root_moves.length} legal first moves: ${coverage.proven} proven; ${coverage.refuted_within_horizon} refuted; ${coverage.unknown_budget} unknown; ${coverage.not_checked} unchecked.`,`全部 ${a.root_moves.length} 个合法首步：${coverage.proven} 个已证明，${coverage.refuted_within_horizon} 个已否定，${coverage.unknown_budget} 个未知，${coverage.not_checked} 个未检查。`));
  paragraph(goal,wording('Sufficient = there exists a continuation strategy for the original mover that achieves this goal against every legal opponent response. Necessary = the goal is achievable and every successful strategy must start with this move.','充分＝己方存在后续策略，能应对对手的所有合法应手并达到此目标。必要＝目标确实可达，而且所有成功策略都必须以此步开始。'));
  paragraph(goal,wording('These are bounded strategy tests, not guarantees under arbitrary later mistakes. A material sacrifice can fail a material goal yet win the game. A short-horizon success does not prove long-term safety.','这是有限时域的策略检验，不保证己方后续随意走也成功。弃子可能不满足子力目标，却赢得对局；短期成功不证明长期安全。'));
  const all=element('details');all.append(element('summary',wording('Inspect every legal first move','查看所有合法首步的判定')));all.append(table([wording('Move','着法'),wording('Sufficient','充分性'),wording('Necessary','必要性')],a.root_moves.map(row=>{const v=gi.verdicts[row.uci];return [row.san,goalStatus(v.sufficiency),goalStatus(v.necessity)];})));goal.append(all);const bounded=element('details',undefined,'agent-feedback');bounded.id='bounded-goal-details';bounded.append(element('summary',wording('Additional bounded game-goal proofs','附加的有限博弈目标证明')),goal);root.append(bounded);
  const mechanism=section(wording('Which causal questions remain open?','哪些因果问题还没有解决？'));
  paragraph(mechanism,wording('When Monte Carlo is enabled, estimated: how changing the first move changes event probabilities under the specified continuation policy. Not established: whether a motif such as a pin mediates the evaluation difference. The replay below records legal events, not an inferred causal mechanism.','开启蒙特卡洛后估计：在指定后续策略下，改变首步会怎样改变事件概率。尚未建立：某个牵制等机制是否中介了评价差异。下方回放记录合法事件，不把事件链自动当成因果机制。'));
  paragraph(mechanism,wording('PN / PS / PNS: not estimated. Independent A/B rollouts provide marginal event rates, not a joint model of the same case in two counterfactual worlds. The goal tests above are a separate, explicitly defined strategy notion of necessity and sufficiency.','PN / PS / PNS：未估计。独立的 A/B 续局提供边际事件率，并未定义“同一个样本在两个反事实世界中”的联合响应。上面的必要/充分性是另行明确定义的策略判定。'));const scope=element('details',undefined,'agent-feedback');scope.append(element('summary',wording('Limits of causal attribution','因果归因的边界')),mechanism);root.append(scope);
  $('raw-output').textContent=JSON.stringify({notation:{R:'Hypothesis round; R1 = first round',H:'Hypothesis number; R1-H1 = first hypothesis of first round',C:'Whether the selected executable condition holds',Y:'Whether the engine score meets the chosen target',epsilon:'Allowed score gap from the reference',tau:'Reference score minus allowed gap'},llm_used:a.llm_used,position:a.fen,settings:cfg,causal_analysis:contract,concept_agent:a.concept_agent},null,2);
  const rawDetails=$('raw-output').closest('details');rawDetails.id='technical-records';
  let legend=$('technical-legend');if(!legend){legend=element('p',undefined,'evidence-note');legend.id='technical-legend';$('raw-output').before(legend);}
  legend.textContent=wording('These are the original machine records. R means round; H means hypothesis. R1-H1 is the first hypothesis of the first round. C records whether the chosen condition holds, Y records whether the score qualifies. Epsilon is the allowed gap; tau is the resulting score threshold. The model’s original English rationale and wording are preserved here, not treated as program verdicts.','这里保留原始机器记录。R 表示轮次，H 表示假设编号：R1-H1 就是第一轮的第一个假设。C 表示当前条件是否成立，Y 表示评分是否达标。epsilon 是允许的评分差距，tau 是由此得到的门槛。模型原始英文理由和文字也保留在这里，它们不是程序判定本身。');
  let download=$('download-evidence');if(!download){download=element('button',wording('↓ Complete evidence JSON','↓ 完整证据 JSON'),'text-button');download.id='download-evidence';$('raw-output').parentElement.after(download);}download.textContent=wording('↓ Complete evidence JSON','↓ 完整证据 JSON');download.onclick=()=>QueenAPI.download(`/games/${game.id}/evidence?ply=${viewedPly}`,'position-evidence.json').catch(e=>toast(e.message));
  const pvSection=$('pv-section');let controls=$('trajectory-controls');if(!controls){controls=element('div',undefined,'trajectory-controls');controls.id='trajectory-controls';pvSection.insertBefore(controls,$('pv'));}controls.replaceChildren();
  const kind=element('select');kind.id='trajectory-kind';[...(trajectoryKind==='candidate'?[['candidate',wording('Candidate preview','候选首步预览')]]:[]),['pv',wording('Stockfish PV','Stockfish 主变')],['sample',wording('Monte Carlo sample','蒙特卡洛样本')],['goal',wording('Goal certificate branch','目标证明的一条分支')],...(counterexampleMove?[['counterexample',wording('Counterexample PV: ','反例 PV：')+counterexampleMove.san]]:[])].filter(([value])=>value!=='sample'||c.samples.length).forEach(([value,label])=>{const opt=element('option',label);opt.value=value;opt.selected=trajectoryKind===value;kind.append(opt);});kind.onchange=()=>{trajectoryKind=kind.value;refreshLine();};controls.append(kind);
  if(trajectoryKind==='sample'){const number=element('select');number.id='sample-index';c.samples.forEach((sample,i)=>{const opt=element('option',`#${i+1} · Δmaterial ${sample.material_delta>=0?'+':''}${sample.material_delta}`);opt.value=i;opt.selected=sampleIndex===i;number.append(opt);});number.onchange=()=>{sampleIndex=Number(number.value);refreshLine();};controls.append(number);}
  let note=$('trajectory-note');if(!note){note=element('p');note.id='trajectory-note';controls.after(note);}note.textContent=trajectoryKind==='counterexample'?wording('Finite-engine counterexample line: ','有限引擎反例变化：')+counterexampleMove.san:trajectoryKind==='sample'?wording(`Sample ${sampleIndex+1}/${c.samples.length}; stop: ${c.samples[sampleIndex].stop_reason}; this one line is not a force proof.`,`样本 ${sampleIndex+1}/${c.samples.length}；停止原因：${c.samples[sampleIndex].stop_reason}；单条续局不证明强制结果。`):trajectoryKind==='goal'?wording('One path through a validated strategy certificate. The full JSON includes every legal defensive branch.','已验证策略证书中的一条路径；完整 JSON 包含所有合法防守分支。'):wording('Finite-search principal variation; the opponent can choose another legal response.','有限搜索的主变；对手可能选择其他合法应手。');
  for(const id of expandedEvidencePanels){const panel=$(id);if(panel)panel.open=true;}
}
function renderCausalAnalysis(){
  const opening=awaitingFirstMove(),a=activeAnalysis(),pending=!opening&&game?.pending?.ply===viewedPly?game.pending:null;
  const key=a?.evidence_id||null;if(key!==selectedAnalysisKey){selectedAnalysisKey=key;resetAgentUI();selectedCandidate=0;comparisonCandidate=1;sampleIndex=0;trajectoryKind='pv';evidenceRenderKey=null;}
  const candidates=a?.candidates||[];if(selectedCandidate>=candidates.length)selectedCandidate=0;
  if(comparisonCandidate===selectedCandidate||comparisonCandidate>=candidates.length)comparisonCandidate=candidates.findIndex((_,i)=>i!==selectedCandidate);
  show('thinking-state',!!pending);show('empty-analysis',!a&&!pending);show('analysis-content',!!a&&!pending);
  $('analysis-context').textContent=t('positionAnalysis',{side:t((a?.fen||positionFen()).split(' ')[1]==='w'?'white':'black')});
  if(pending)$('thinking-time').textContent=t('thinkingTime',{s:Math.max(0,Math.floor(Date.now()/1000-pending.started))});
  if(a){
    $('state-overview').textContent=wording('Click a candidate to preview its move on the board.','点击候选着法，左侧预览这一步，下面查看解释。');
    $('candidate-choices').replaceChildren(...candidates.map((c,i)=>{const b=element('button',undefined,'candidate-choice'+(i===selectedCandidate?' active':''));b.setAttribute('aria-pressed',String(i===selectedCandidate));b.append(element('strong',c.san),element('small',scoreLabel(c.score)+(c.role==='contrast_control'?wording(' · control',' · 对照'):'')));b.onclick=()=>previewCandidate(i);return b;}));
    const c=candidates[selectedCandidate];document.querySelector('[data-i18n="recommended"]').textContent=t(c.role==='contrast_control'?'control':selectedCandidate===0?'recommended':'candidate');$('best-move').textContent=c.san;$('analysis-timing').textContent=`${a.elapsed_seconds}s`;
    const paintKey=[key,selectedCandidate,comparisonCandidate,selectedGoal,trajectoryKind,sampleIndex,lang].join('|');if(paintKey!==evidenceRenderKey){paintEvidence(a,c);evidenceRenderKey=paintKey;}
    const steps=visibleSteps();$('pv').replaceChildren(...steps.map((s,i)=>{const b=element('button',s.san);b.classList.toggle('active',pvIndex===i);b.onclick=()=>{pvFen=s.fen_after;pvIndex=i;renderBoard();renderMeta();renderCausalAnalysis();};return b;}));if(!steps.length)$('pv').append(element('span',wording('No proven strategy branch for this goal.','该目标下没有已证明的策略分支。')));
  }
  if($('analysis-details'))$('analysis-details').classList.toggle('hidden',!a||!!pending||!analysisDetailsOpen);
  if(a)syncEvidencePreview();syncCandidatePreview();
  const warnings=[game?.error,a?.warning].filter(Boolean);$('error').textContent=warnings.join('\n');show('error',!!warnings.length);show('analyze',!opening);$('analyze').textContent=t('analyze');$('analyze').disabled=opening||!game||!!game.pending||!ready||!!pvFen||game.game_over&&isLive();show('play-model',!opening&&!!game&&!game.game_over&&canCommitCandidate());$('play-model').textContent=t('queenMove');$('play-model').disabled=!!game?.pending||!ready||!currentCandidate();
}
function renderCausalMeta(){$('bottom-name').textContent=t(flipped?'black':'white');$('top-name').textContent=t(flipped?'white':'black');$('bottom-description').textContent=t('original');$('top-description').textContent=t('original');if(!game?.game_over&&!game?.pending)$('turn-label').textContent=t(positionFen().split(' ')[1]==='w'?'white':'black')+(lang==='zh'?'行棋':' to move');}

function syncCandidatePreview(){
 let box=$('candidate-preview');
 if(!box){box=element('div',undefined,'candidate-preview hidden');box.id='candidate-preview';$('board').before(box);}
 const c=currentCandidate(),active=!!(pvFen&&trajectoryKind==='candidate'&&c);
 box.classList.toggle('hidden',!active);box.replaceChildren();if(!active)return;
 box.append(element('strong',wording(`Preview ${c.san}: ${c.uci.slice(0,2)} → ${c.uci.slice(2,4)}`,`预览 ${c.san}：${c.uci.slice(0,2)} → ${c.uci.slice(2,4)}`)));
 const back=element('button',wording('Back to current position','返回当前局面'),'text-button');back.onclick=()=>{pvFen=null;pvIndex=-1;trajectoryKind='pv';render();};box.append(back);
 $('board-message').textContent=wording('Preview only. Use “Play this move” to add it to the game.','当前仅为预览；点击“走这一步”才会真正落子。');
 $('position-label').textContent=wording('Candidate preview','候选预览');
}
