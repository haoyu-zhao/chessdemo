'use strict';
let agentRoundIndex=null, agentHypothesisId=null, agentConceptView=null, counterexampleMove=null;
let analysisDetailsOpen=false, analysisDetailPosition=null, expandedEvidencePanels=new Set();
function resetAgentUI(){agentRoundIndex=null;agentHypothesisId=null;agentConceptView=null;counterexampleMove=null;}
const conceptChinese={
 material_gain:'走完首步后，己方与对方的子力差至少增加 1 分。兵=1，马/象=3，车=5，后=9。',
 material_loss:'走完首步后，己方与对方的子力差至少减少 1 分；这里只比较这一步前后。',
 check:'首步是否将军，由合法棋盘规则直接判断。',
 checkmate:'首步是否已经将杀：对方被将军，而且没有合法应手。',
 no_mate_in_one_reply:'逐一尝试对手下一步的所有合法应手，检查是否有一步能将杀己方。通过检查只说明没有一步将杀，不保证更远的安全。',
 own_absolute_pin:'己方是否有棋子被绝对牵制：它离开牵制线会暴露己方国王。',
 opponent_absolute_pin:'对方是否有棋子被绝对牵制。这种牵制不自动意味着能够赢子。',
 own_attacked_undefended:'己方是否有非王棋子受到对方攻击，却没有己方棋子保护。按攻击几何关系计数，包含受牵制的攻击者，不等于对手能合法或有利地吃掉它。',
 opponent_attacked_undefended:'对方是否有非王棋子受到己方攻击，却没有对方棋子保护。这里只检测攻击关系，不证明己方可以强制赢子。',
 double_attack:'己方同一个非兵、非王棋子，是否同时攻击至少两个对方非兵棋子（可以包括王）。这是双重攻击的几何线索，不证明能获利。',
 passed_pawn:'己方是否存在通路兵：该兵前方的同列和相邻两列，没有对方兵阻挡。',
 isolated_pawn:'己方是否存在孤兵：该兵相邻两列都没有己方兵。',
 doubled_pawn:'己方是否有至少两个兵位于同一列。',
 rook_open_file:'己方是否有车占据开放线：该列没有任何一方的兵。',
 bishop_pair:'己方是否至少有两个象。这里只数象，不判断它们控制的格色，也不自动判定双象有优势。',
 central_attacks:'己方是否攻击 d4、e4、d5、e5 中至少两个不同的格子。包含受牵制棋子的攻击；这不是所有“控制中心”的完整定义。',
 restricted_replies:'对方是否只剩 1 或 2 个合法应手。没有合法应手的终局不计入，也不自动意味着己方获胜。',
 target_defended:'选定的己方棋子在首步后仍存在，且至少被一个己方棋子保护。会追踪该棋子移动后的位置；几何保护不保证不会被强制赢走。',
 target_not_capturable_next:'选定棋子在首步后仍存在，且对方下一步的所有合法着法都不能直接吃掉它。不保证数步后的安全。',
 pv_material_loss:'在所记录的引擎主变中，己方净子力是否曾比开始时少至少 1 分。它是特定续局中的观察，不参与本版首步必要性/充分性假设的验证。'
};
function conceptName(report,id){const c=report.concept_library.find(x=>x.id===id);return c?(lang==='zh'?c.name_zh:c.name):id;}
function conceptDefinition(report,id){return lang==='zh'?conceptChinese[id]:report.concept_library.find(c=>c.id===id)?.definition;}
function conditionName(h,report){const name=conceptName(report,h.concept_id)+(h.target_square?` (${h.target_square})`:'');return h.polarity==='absent'?wording(`absence of “${name}”`,`没有“${name}”这一现象`):name;}
function hypothesisName(id){const m=/^R(\d+)-H(\d+)$/.exec(id||'');if(!m)return id||'';return wording(`Round ${m[1]}, hypothesis ${m[2]}`,`第 ${m[1]} 轮的第 ${m[2]} 个假设`);}
function hypothesisQuestion(h,report){const c=conditionName(h,report);return h.test==='necessity'?wording(`Must every move that meets the score target also satisfy “${c}”?`,`评分达标的着法，是否都必须满足“${c}”？`):wording(`Does every move satisfying “${c}” meet the score target?`,`只要满足“${c}”，评分就一定达标吗？`);}
function agentStatus(s){const labels={refuted_confirmed:['Rejected: a counterexample survived rechecking','已否定：反例经复核仍成立'],candidate_counterexample_unconfirmed:['Not settled: the potential counterexample is unconfirmed','尚未确定：候选反例未被复核确认'],not_refuted_in_base_scan:['Retained as a hypothesis: no counterexample in this scan','暂时保留：本次搜索未找到反例'],not_applicable_empty_condition:['Not tested meaningfully: no move meets the premise','无法有效判断：没有着法满足检验前提'],unknown:['Not settled: some results remain unknown','尚未确定：部分结果仍未知']};return wording(...(labels[s]||[s,s]));}
function agentRerender(){evidenceRenderKey=null;renderCausalAnalysis();}
function inspectCounterexample(row){counterexampleMove=row;trajectoryKind='counterexample';pvFen=row.pv_steps[0]?.fen_after||null;pvIndex=row.pv_steps.length?0:-1;evidenceRenderKey=null;render();$('board').scrollIntoView({behavior:'smooth',block:'center'});}
function matrixRows(scan){return [...Object.values(scan.cells).flat(),...scan.unknown];}
function outcomeEntry(report,uci){return matrixRows(report.concept_views[0].matrix).find(x=>x.uci===uci);}
function witnesses(h){return h.matrix.cells[h.test==='necessity'?'C0Y1':'C1Y0'];}
function programFinding(h,report,preferredMove=null){
 const choices=witnesses(h),w=choices.find(x=>x.uci===preferredMove&&x.stable_across_budgets)||choices.find(x=>x.stable_across_budgets)||choices[0];
 const condition=conditionName(h,report);
 if(w){
  const observation=h.test==='necessity'?wording(`${w.san} does not satisfy “${condition}”, yet meets the score target.`,`${w.san} 不满足“${condition}”，评分却仍达标。`):wording(`${w.san} satisfies “${condition}”, yet misses the score target.`,`${w.san} 满足“${condition}”，评分却没有达标。`);
  return observation+' '+(w.stable_across_budgets?wording(`The classification survived a larger search. This refutes the ${h.test} claim in this comparison.`,`增加搜索预算后，这个分类仍成立，因此它推翻了本次比较中的${h.test==='necessity'?'必要性':'充分性'}主张。`):wording('This candidate counterexample has not survived both search budgets, so the verdict remains unsettled.','这个候选反例尚未在两个预算下得到一致确认，因此结论仍待确定。'));
 }
 if(h.verdict==='not_refuted_in_base_scan')return wording('All classified moves fit this implication in the base scan. The claim is retained for further testing; the search has not established it as the true cause.','本次基础搜索中，已分类的着法都没有违背这条主张。可以暂时保留它作为候选解释，但尚未证明它是真正原因。');
 if(h.verdict==='not_applicable_empty_condition')return wording('No move meets the premise of this implication. An empty set cannot provide a useful chess explanation.','没有着法满足这条主张的检验前提，不能用“没有例外”来认定它是有用的解释。');
 return wording('Some move outcomes could not be classified confidently with the available engine evidence. They are recorded as unknown.','现有引擎证据尚不足以给部分着法分类，因此保留为未知，不计作成功或失败。');
}
function plainMoveFinding(h,report,uci){
 const w=witnesses(h).find(x=>x.uci===uci&&x.stable_across_budgets),name=conditionName(h,report);
 if(!w)return '';
 return h.test==='necessity'?wording(`Even without “${name}”, ${w.san} retains a score close to the reference. The larger search agrees. So that property cannot be required for keeping a comparable evaluation here.`,`即使不具备“${name}”，${w.san} 仍然保持了接近参考的评分，增加搜索预算后也如此。所以，不能把这个属性说成保持相近评价必不可少的原因。`):wording(`${w.san} has “${name}”, but its score still falls outside the allowed gap from the reference, even after rechecking. That property alone therefore does not make a move a good choice here.`,`${w.san} 虽然具备“${name}”，评分仍低于本次允许的范围，增加搜索预算后也如此。所以，不能仅凭这个属性判断一步棋值得选。`);
}
function pieceName(name){return lang==='zh'?({pawn:'兵',knight:'马',bishop:'象',rook:'车',queen:'后',king:'王'}[name]||name):name;}
function paintMoveExplanation(root,a,c){
 const box=element('div',undefined,'final-explanation');box.id='move-explanation';
 const text=c.explanation_summary?.[lang]||c.explanation_translations?.[lang]||c.text;
 if(text){for(const part of text.split(/\n\s*\n/))paragraph(box,part,'final-paragraph');}
 else paragraph(box,wording('A concrete explanation for this move is not yet available.','这步棋暂时还没有足够具体的解释。'),'final-paragraph');
 for(const detail of c.explanation_details||[]){const item=element('section',undefined,'explanation-detail');item.dataset.kind=detail.kind;item.append(element('h4',detail.title[lang]));paragraph(item,detail.text[lang],'final-paragraph');box.append(item);}
 root.append(box);
}
function toggleAnalysisDetails(open,scroll=false){analysisDetailsOpen=open;const panel=$('analysis-details');if(!panel)return;panel.open=open;panel.classList.toggle('hidden',!open);const b=$('toggle-analysis-details');if(b){b.textContent=wording(open?'Hide analysis process':'How was this explanation checked?',open?'收起分析过程':'查看分析过程与依据');b.setAttribute('aria-expanded',String(open));}if(open&&scroll)panel.scrollIntoView({behavior:'smooth',block:'start'});}
function prepareReadableLayout(a,c){
 const prose=$('explanation'),pv=$('pv-section'),raw=$('raw-output').closest('details'),download=$('download-evidence');
 expandedEvidencePanels=analysisDetailPosition===a.fen?new Set([...document.querySelectorAll('#analysis-details details[id][open]')].map(e=>e.id)):new Set();
 if(analysisDetailPosition!==a.fen){analysisDetailsOpen=false;analysisDetailPosition=a.fen;}
 prose.className='readable-explanation';prose.replaceChildren();paintMoveExplanation(prose,a,c);
 const button=element('button',undefined,'text-button analysis-toggle');button.id='toggle-analysis-details';button.setAttribute('aria-controls','analysis-details');button.onclick=()=>toggleAnalysisDetails(!analysisDetailsOpen,true);prose.append(button);
 let panel=$('analysis-details');if(!panel){panel=element('details',undefined,'analysis-drawer');panel.id='analysis-details';document.querySelector('.studio').after(panel);}
 panel.ontoggle=null;panel.replaceChildren();const summary=element('summary',wording('Analysis process · click to collapse','分析过程与依据 · 点击收起'));panel.append(summary);
 const body=element('div',undefined,'evidence-body');body.id='analysis-detail-body';panel.append(body,pv,raw);if(download)panel.append(download);
 panel.open=analysisDetailsOpen;panel.ontoggle=()=>{if(panel.open!==analysisDetailsOpen)toggleAnalysisDetails(panel.open);};toggleAnalysisDetails(analysisDetailsOpen);return body;
}
function sectionStep(id,title){const s=section(title);s.id=id;return s;}
function paintConceptAgent(root,a){
 const report=a.concept_agent;if(!report)return;
 const intro=sectionStep('analysis-overview',wording('How this result was produced','这份解释是怎样得到的'));intro.classList.add('analysis-intro');
 paragraph(intro,wording('Start with the concrete claims behind the selected explanation. The broader property comparisons and counterexample searches follow separately. All scores refer to the original side to move.','先看当前解释引用了哪些具体事实，以及这些事实之间的联系是否成立。后面另列属性比较和反例搜索。所有评分都以被分析局面的行棋方为视角。'));
 const nav=element('nav',undefined,'analysis-nav');nav.setAttribute('aria-label',wording('Analysis steps','分析步骤'));
 for(const [id,en,zh] of [['mechanism-guide','This explanation','当前解释的依据'],['score-guide','Score target','比较标准'],['concept-guide','20 properties','20 个属性'],['pipeline-guide','Search workflow','检验流程'],['hypothesis-guide','Hypothesis revisions','假设修订'],['verifier-guide','Actual counterexamples','具体反例']]){const link=element('a',wording(en,zh));link.href='#'+id;nav.append(link);}intro.append(nav);root.append(intro);
 paintMechanismEvidence(root,a);paintScoreGuide(root,a);paintConceptGuide(root,a);paintPipelineGuide(root,a);
 const rounds=report.rounds;if(agentRoundIndex===null||agentRoundIndex>=rounds.length)agentRoundIndex=rounds.length-1;const round=rounds[agentRoundIndex];
 const history=sectionStep('hypothesis-guide',wording('4. What did the model ask, and what changed?','4. 模型提出了什么问题，之后怎样修改？'));
 paragraph(history,wording('A hypothesis is a question to test, not an accepted explanation. Round 1 contains initial questions. Round 2 contains questions proposed after feedback; every new question is checked again.','“假设”是一条等待检验的解释，不是已经成立的理由。第一轮提出初始问题；第二轮根据反例保留、撤回或修改问题，每个新问题都会重新检查。'));
 paragraph(history,wording('Necessity asks: can the score target be met without this property? Sufficiency asks: can the property be present while the score target is missed? They are different questions. Switching direction is a new test, not evidence that the reverse claim is correct.','必要性问的是：没有这个条件，还能达到评分标准吗？充分性问的是：具备这个条件，是否仍可能达不到评分标准？它们是不同的问题。把检验方向反过来，只是提出新问题，不等于反方向已成立。'));
 const label=element('label',wording('Choose a round ','选择轮次 ')),select=element('select');select.id='agent-round';rounds.forEach((r,i)=>{const opt=element('option',r.round===1?wording('First round · initial hypotheses','第一轮 · 初始假设'):wording('Second round · revised hypotheses, checked again','第二轮 · 修订假设，再次检验'));opt.value=i;opt.selected=i===agentRoundIndex;select.append(opt);});select.onchange=()=>{agentRoundIndex=Number(select.value);agentHypothesisId=null;agentConceptView=null;agentRerender();};label.append(select);history.append(label);
 if(!agentConceptView&&!round.hypotheses.some(h=>h.id===agentHypothesisId))agentHypothesisId=round.hypotheses[0]?.id||null;
 const cards=element('div',undefined,'hypothesis-cards');
 for(const h of round.hypotheses){const card=element('button',undefined,'hypothesis-card'+(h.id===agentHypothesisId&&!agentConceptView?' active':''));card.setAttribute('aria-pressed',String(h.id===agentHypothesisId&&!agentConceptView));card.append(element('strong',hypothesisName(h.id)),element('span',hypothesisQuestion(h,report)),element('small',agentStatus(h.verdict)));
  if(h.replaces_id){const previous=rounds.flatMap(r=>r.hypotheses).find(x=>x.id===h.replaces_id);const reverse=previous&&previous.concept_id===h.concept_id&&previous.target_square===h.target_square&&previous.polarity===h.polarity&&previous.test!==h.test;
   card.append(element('small',reverse?wording(`Tests the reverse direction of ${hypothesisName(h.replaces_id)}.`,`改为检验“${hypothesisName(h.replaces_id)}”的反方向。`):wording(`Replaces ${hypothesisName(h.replaces_id)} with a new question.`,`替代“${hypothesisName(h.replaces_id)}”，这是一个新问题。`)));}
  card.onclick=()=>{agentHypothesisId=h.id;agentConceptView=null;agentRerender();};cards.append(card);
 }
 history.append(cards);if(!round.hypotheses.length)paragraph(history,wording('No executable hypothesis was submitted in this round. The deterministic property comparison remains available below.','本轮没有可执行假设，仍可在下面查看程序逐项计算的属性比较。'));
 if(round.withdrawn_ids.length)paragraph(history,wording('Withdrawn questions: ','已撤回：')+round.withdrawn_ids.map(hypothesisName).join('、'));
 if(round.rejected.length)paragraph(history,wording(`${round.rejected.length} unsupported or invalid proposals were rejected before verification.`,`${round.rejected.length} 条无法执行或格式无效的提议在进入验证前被拒绝。`));
 root.append(history);
 const h=!agentConceptView?round.hypotheses.find(x=>x.id===agentHypothesisId):null;
 const view=report.concept_views.find(v=>v.id===(agentConceptView||h?.view_id))||report.concept_views.find(v=>v.varies&&v.hypothesis_enabled)||report.concept_views[0];
 paintVerifier(root,a,h,view,round);
}
function paintScoreGuide(root,a){
 const r=a.concept_agent,t=r.outcome_definition,block=sectionStep('score-guide',wording('1. What counts as a comparable move?','1. 什么叫“达到比较标准”？'));
 if(t.kind==='centipawn'){
  paragraph(block,wording(`The reference move ${a.best_move_san} scored ${scoreLabel(t.reference)}. This run allows a drop of ${(t.epsilon_cp/100).toFixed(2)} evaluation points. A score of ${scoreLabel({cp:t.tau_cp,mate:null})} or higher meets that target.`,`参考着法 ${a.best_move_san} 的评分为 ${scoreLabel(t.reference)}。本次允许比它低 ${(t.epsilon_cp/100).toFixed(2)} 个评价单位，因此评分不低于 ${scoreLabel({cp:t.tau_cp,mate:null})} 的着法，归为“评分达标”。`));
  block.append(element('div',wording(`Reference ${t.reference.cp} cp − tolerance ${t.epsilon_cp} cp = target ${t.tau_cp} cp`,`参考评分 ${t.reference.cp} cp − 允许差距 ${t.epsilon_cp} cp = 达标门槛 ${t.tau_cp} cp`),'score-example'));
  paragraph(block,wording('cp means centipawn: 100 cp is one pawn-sized evaluation unit. It is an engine scale, not a literal number of pawns lost or a winning probability. Positive is favourable to the original mover; negative favours the opponent.','cp 是百分之一兵的评价单位，100 cp 对应 1 个兵量级的评价。它是引擎的评分刻度，不表示实际少了多少兵，也不是胜率。正分偏向原行棋方，负分偏向对方。'));
  paragraph(block,wording(`The ${t.epsilon_cp} cp allowance is a chosen comparison setting, not a confidence interval or a rule of chess. Changing it may change which moves qualify and which necessity/sufficiency claims survive.`,`${t.epsilon_cp} cp 是本次设定的比较容差，不是统计置信区间，也不是国际象棋规则。改变这个设定，达标着法集合和必要性／充分性结论都可能变化。`));
 }else paragraph(block,wording('The reference has a mate score, so this comparison uses mate categories rather than a centipawn threshold. A winning mate must remain winning; a losing mate must be delayed at least as long or avoided.','参考着法出现将杀评分，本次按将杀类别比较，不换算成百分兵分。能将杀时要求保留将杀；被将杀时要求至少同样延后被杀，或避免被杀。'));
 const qualified=r.root_moves.filter(x=>outcomeEntry(r,x.uci)?.outcome===true);paragraph(block,wording(`${qualified.length} of ${r.legal_moves_covered} legal first moves currently qualify: ${qualified.map(x=>x.san).join(', ')||'none'}. A qualifying move need not produce a winning position.`,`${r.legal_moves_covered} 个合法首步中，当前有 ${qualified.length} 个达标：${qualified.map(x=>x.san).join('、')||'无'}。“达标”只是接近本次参考水平，并不表示局面一定占优。`));root.append(block);
}
function paintConceptGuide(root,a){
 const r=a.concept_agent,block=sectionStep('concept-guide',wording('2. Which chess properties are checked?','2. 一共检查哪些棋类属性？'));
 const varying=r.concept_library.filter(c=>r.concept_views.some(v=>v.concept_id===c.id&&v.varies));
 paragraph(block,wording(`The library has ${r.concept_library.length} predefined properties. Here, ${varying.length} differ between at least some first moves. A property is an observable fact; only after a separate test can it support an explanation.`,`初始库有 ${r.concept_library.length} 个预先定义的属性；本局其中 ${varying.length} 个在不同首步后出现差异。属性首先是一条可检测事实，要另外检验它与评分的关系，才能讨论解释作用。`));
 if(varying.length)paragraph(block,wording('Properties that vary here: ','本局会变化的属性：')+varying.map(c=>conceptName(r,c.id)).join('、')+'。');
 paragraph(block,wording('Several good moves may share an advantage. Failing to find one property that uniquely singles out a move does not mean there are no concepts, nor that only a unique move can be explained. A property true after every move cannot distinguish those moves here.','多个好走法可以共享同一个优点。“未找到能唯一识别某步的单个属性”，不等于没有概念，也不意味着必须找出唯一好棋才能解释。一个属性若在所有着法后都成立，就无法区分这些着法。'));
 const library=element('details',undefined,'concept-library');library.id='concept-library';library.append(element('summary',wording(`Read all ${r.concept_library.length} definitions and their limits`,`查看全部 ${r.concept_library.length} 个属性：定义、范围与局限`)));
 const groups=[['Material','子力',['material_gain','material_loss','own_attacked_undefended','opponent_attacked_undefended']],['King and forcing replies','国王与应手',['check','checkmate','no_mate_in_one_reply','restricted_replies']],['Tactical relationships','战术关系',['own_absolute_pin','opponent_absolute_pin','double_attack','target_defended','target_not_capturable_next']],['Structure and placement','兵结构与子力位置',['passed_pawn','isolated_pawn','doubled_pawn','rook_open_file','bishop_pair','central_attacks']],['Continuation observation','续局观察',['pv_material_loss']]];
 const grid=element('div',undefined,'concept-groups');for(const [en,zh,ids] of groups){const group=element('section',undefined,'concept-group');group.append(element('h4',wording(en,zh)));const list=element('dl');for(const id of ids){const c=r.concept_library.find(x=>x.id===id);if(!c)continue;const varies=varying.some(x=>x.id===id);list.append(element('dt',conceptName(r,id)+(varies?wording(' · varies here',' · 本局有差异'):'')),element('dd',conceptDefinition(r,id)));}group.append(list);grid.append(group);}library.append(grid);
 const targets=[...new Set(r.concept_views.map(v=>v.target_square).filter(Boolean))];paragraph(library,wording(`Target-specific checks currently inspect up to four own non-pawn, non-king pieces, prioritising attacked or pinned pieces. In this position: ${targets.join(', ')||'none'}. The other static detectors inspect the whole board.`,`针对指定棋子的两项检查，目前优先选择受攻击或受牵制的己方非兵、非王棋子，最多 4 个。本局目标为：${targets.join('、')||'无'}。其他静态检测器检查整个棋盘。`));
 paragraph(library,wording('The PV material-loss property is an observation along one recorded continuation. The remaining 19 definitions support first-move tests. New model-proposed mechanisms stay pending until independently validated.','“PV 中观察到子力损失”只描述一条已记录续局；其余 19 个定义可用于首步检验。模型提出的新机制在独立验证前保持待验证状态。'));block.append(library);root.append(block);
}
function paintPipelineGuide(root,a){
 const r=a.concept_agent,cfg=a.evidence_settings,block=sectionStep('pipeline-guide',wording('3. Who does each part of the work?','3. 整个流程由谁完成？'));
 const steps=[
  [wording('Enumerate every legal first move','枚举所有合法首步'),wording(`Python reconstructs the board and history and lists all ${r.legal_moves_covered} legal first moves. Each branch starts from exactly the same position.`,`Python 还原棋盘与历史，列出全部 ${r.legal_moves_covered} 个合法首步。每条分支都从同一个局面出发，只更换第一步。`)],
  [wording('Search and compare','搜索与比较评分'),wording(`Stockfish searches each move independently with ${cfg.root_nodes.toLocaleString()} nodes, then ${cfg.verify_nodes.toLocaleString()} nodes. A node is a search work unit, not a completed game. The completed-iteration score and its matching legal continuation are retained.`,`Stockfish 对每个首步分别搜索，先用 ${cfg.root_nodes.toLocaleString()} 节点筛查，再用 ${cfg.verify_nodes.toLocaleString()} 节点评分。节点是搜索工作量，不是一盘完整棋。系统保留已完成搜索层的评分及其对应合法变化。`)],
  [wording('Compute properties and propose questions','计算属性，提出解释假设'),wording('Python computes the registered properties after every first move and extracts captures, checks and material changes from engine lines. DeepSeek receives that evidence and chooses explicit necessity or sufficiency questions to test.','Python 对每个首步后的棋盘运行属性检测器，并从引擎变化中提取吃子、将军、子力变化。DeepSeek 读取这些证据，提出可以明确检验的必要性或充分性问题。')],
  [wording('Search for counterexamples','程序寻找反例'),wording(`The verifier scans every legal first move for the condition that would refute each claim. It prioritises potential counterexamples and threshold cases, then rechecks up to ${r.verification.moves.length} moves with ${r.verification.nodes_per_rechecked_move.toLocaleString()} nodes each, including the reference.`,`Verifier 对全部合法首步检查“什么情况会推翻这条主张”，优先挑出候选反例及门槛附近着法。当前一轮复核了 ${r.verification.moves.length} 个着法，每步 ${r.verification.nodes_per_rechecked_move.toLocaleString()} 节点，包含参考着法。`)],
  [wording('Give feedback and re-test revisions','反馈给模型，再检验修订'),wording('Python reports the scores, detected properties and exact failed implication. DeepSeek can withdraw, retain or revise a hypothesis. Revised hypotheses go through the same program again; there are at most two hypothesis rounds.','Python 返回评分、属性检测结果，以及被反例推翻的是哪条主张。DeepSeek 可以撤回、保留或修改假设。修订后的假设再次经过同一程序，最多两轮。')],
  [wording('Assemble the explanation','整理最终说明'),wording('DeepSeek writes the final move explanation using usable, piece-specific claims and checked links. The same text is stored for display and dataset export. Python and Stockfish perform the verification; the model does not judge itself.','DeepSeek 根据可用的具体棋子命题和已经检验的联系，生成最终解释；同一份文字用于页面和数据导出。验证由 Python + Stockfish 完成，不由模型自行裁判。')]
 ];
 if(!r.agent.llm_used)paragraph(block,wording('For this particular run, the model was unavailable and preset property questions were used instead. All available chess checks were still performed by the program.','这次运行中模型未参与，系统使用预设的属性问题进行检查；可用的棋局验证仍由程序完成。'));
 else paragraph(block,wording(`This record contains ${r.rounds.length} hypothesis rounds${r.agent.cached?' and reuses an earlier result':''}. The original model messages and usage are retained in the advanced record.`,`本份记录包含 ${r.rounds.length} 轮假设检验${r.agent.cached?'，本次复用了已生成的结果':''}。模型原始文字和用量保存在高级记录中。`));
 if(r.agent.error)paragraph(block,wording('Some model stages were unavailable; the completed engine and program checks are retained. See the advanced record for status.','部分模型步骤未能完成，已经得到的引擎证据和程序检验仍然保留。具体状态见高级记录。'));
 const list=element('ol',undefined,'pipeline-steps');for(const [title,body] of steps){const li=element('li');li.append(element('strong',title),element('p',body));list.append(li);}block.append(list);root.append(block);
}
function paintVerifier(root,a,h,view,round){
 const report=a.concept_agent,scan=h?.matrix||view.matrix,condition=h||{concept_id:view.concept_id,target_square:view.target_square,polarity:'present'};
 const block=sectionStep('verifier-guide',wording('5. Inspect the actual program check','5. 这条假设具体是怎么验证的？'));
 const label=element('label',wording('Inspect a property ','切换检查的属性 ')),picker=element('select');picker.id='concept-choice';for(const v of report.concept_views){const opt=element('option',conceptName(report,v.concept_id)+(v.target_square?' · '+v.target_square:''));opt.value=v.id;opt.selected=v.id===view.id;picker.append(opt);}picker.onchange=()=>{agentConceptView=picker.value;agentHypothesisId=null;agentRerender();};label.append(picker);block.append(label);
 paragraph(block,wording('Current condition: ','本次条件：')+conditionName(condition,report));paragraph(block,conceptDefinition(report,view.concept_id));
 if(h){const answer=element('div',undefined,'verifier-answer');answer.id='verifier-feedback';answer.append(element('strong',hypothesisQuestion(h,report)));paragraph(answer,programFinding(h,report));block.append(answer);}
 if(view.scope==='trajectory')paragraph(block,wording('This property is observed on an engine line only. Its table is an observational comparison; it is not admitted as a verified first-move hypothesis.','这一属性只来自引擎主变观察。下面的表格仅作对照，不将它纳入已验证的首步假设。'));
 if(scan.constant_concept)paragraph(block,wording('This condition is the same after every legal first move. It cannot distinguish the moves in this position.','这一条件在全部合法首步后都相同，无法在本局中区分着法。'));
 paragraph(block,wording('For each move, Python first checks whether the chosen condition holds. It separately checks whether the engine score reaches the target. These two yes/no answers produce the following four groups.','对每个着法，Python 先判断是否满足当前条件，再独立判断引擎评分是否达标。把这两个“是／否”答案组合起来，就得到下面四组。'));
 const titles={C1Y1:['Condition met · score target met','满足条件 · 评分达标','Consistent with the claim, but does not prove it.','与主张相容，但单独这一格不能证明主张。'],C0Y1:['Condition absent · score target met','不满足条件 · 评分达标','Potential counterexamples to necessity: the target is met without the condition.','必要性的候选反例：没有这个条件也达标。'],C1Y0:['Condition met · score target missed','满足条件 · 评分未达标','Potential counterexamples to sufficiency: the condition alone is not enough.','充分性的候选反例：有这个条件仍不够。'],C0Y0:['Condition absent · score target missed','不满足条件 · 评分未达标','Both are absent; this alone does not establish causation.','条件和好结果都没有；这本身不能证明因果关系。']};
 const grid=element('div',undefined,'counterfactual-grid');for(const [key,t] of Object.entries(titles)){const cell=element('div',undefined,'counterfactual-cell');cell.dataset.cell=key;cell.append(element('strong',wording(t[0],t[1])+` · ${scan.cells[key].length}`),element('p',wording(t[2],t[3])));const moves=element('div',undefined,'counterfactual-moves');for(const row of scan.cells[key]){const marker=row.stable_across_budgets?' ✓':row.recheck_score?' ?':' ·';const b=element('button',row.san+' '+scoreLabel(row.score)+marker);b.dataset.uci=row.uci;b.title=wording('View its legal continuation','查看它的合法续局');b.onclick=()=>inspectCounterexample(row);moves.append(b);}if(!scan.cells[key].length)moves.append(element('span',wording('No moves in this group','本组没有着法')));cell.append(moves);grid.append(cell);}block.append(grid);
 paragraph(block,wording('✓ The score classification agreed in both searches. ? The recheck changed it or left it unresolved. · This move was not rechecked. Clicking a move opens its engine line.','✓ 两次搜索的评分分类一致。? 复核后分类变化或仍无法确定。· 没有进一步复核。点击着法可以查看引擎续局。'));
 block.append(table([wording('Question','检验问题'),wording('Program conclusion','程序结论')],[[wording('Is the condition necessary to meet the target?','达标是否必须满足这个条件？'),agentStatus(scan.necessity)],[wording('Is this condition sufficient to meet the target?','满足条件是否足以达标？'),agentStatus(scan.sufficiency)]]));
 if(h&&witnesses(h).length){const fb=round.feedback.find(f=>f.hypothesis_id===h.id),base=fb?.level_1_numerical.base_threshold||report.outcome_definition,high=fb?.level_1_numerical.recheck_threshold||report.recheck_threshold;const example=element('div',undefined,'recheck-example');example.append(element('h4',wording('Trace a counterexample through both searches','沿着一个反例核对两次搜索')));
 const witness=witnesses(h).find(x=>x.stable_across_budgets)||witnesses(h)[0];paragraph(example,wording(`For ${witness.san}: the condition is ${witness.concept?'met':'not met'}. The base score is ${scoreLabel(witness.score)}; ${base.kind==='centipawn'?'the base target is '+scoreLabel({cp:base.tau_cp,mate:null}):'the mate-category target applies'}.`,`以 ${witness.san} 为例：它${witness.concept?'满足':'不满足'}当前条件。基础评分 ${scoreLabel(witness.score)}；${base.kind==='centipawn'?'当时的达标门槛为 '+scoreLabel({cp:base.tau_cp,mate:null}):'按将杀类别判断'}。`));
 if(witness.recheck_score)paragraph(example,wording(`The larger search scores it ${scoreLabel(witness.recheck_score)}; ${high.kind==='centipawn'?'the independently rechecked reference gives a new target of '+scoreLabel({cp:high.tau_cp,mate:null}):'the rechecked mate-category target applies'}. ${witness.stable_across_budgets?'Its classification stayed the same.':'Its classification was not confirmed at both budgets.'}`,`增加预算后，它的评分为 ${scoreLabel(witness.recheck_score)}；${high.kind==='centipawn'?'参考着法也重新搜索，因此新的门槛是 '+scoreLabel({cp:high.tau_cp,mate:null}):'使用复核后的将杀类别标准'}。${witness.stable_across_budgets?'两次评分分类一致。':'两次评分分类未得到一致确认。'}`));else paragraph(example,wording('This candidate was not selected for the larger search, so it remains unconfirmed.','这个候选没有被选入更高预算复核，所以仍未确认。'));block.append(example);}
 if(scan.unknown.length)paragraph(block,wording(`${scan.unknown.length} moves remain unknown and are excluded from the four classified groups.`,`${scan.unknown.length} 个着法仍为未知，没有被放入四个已分类组。`));
 paragraph(block,wording('Several moves can share the condition and meet the target. This means the reference move is not unique; it does not refute necessity of the condition. A larger engine search supports a counterexample but is not an exhaustive proof of all future play.','若有其他着法同时满足条件并达标，只能说明参考着法并非唯一选择，不能据此否定这个条件的必要性。更深搜索为反例提供支持，但不是对所有未来变化的穷尽证明。'));root.append(block);
}
function paintMonteCarloHeader(root,a,c){
 const cfg=a.evidence_settings,block=sectionStep('monte-carlo-guide',wording('6. What does Monte Carlo add?','6. 蒙特卡洛额外分析什么？'));
 paragraph(block,wording('The checks above compare all first moves using engine scores. Monte Carlo asks a different question: if we fix a first move and then sample many reasonable continuations for both sides, how often does each defined outcome occur?','前面的检验用引擎评分比较全部首步。蒙特卡洛额外问：固定第一步后，让双方按规定策略走出许多条合理续局，某种后果会出现多少次？'));
 if(!cfg.rollouts){paragraph(block,wording('Monte Carlo was not run for this result. No sampled probabilities are used in the explanation above. Enable it to compare material losses, checks and other endpoint events across the selected moves.','本次尚未运行蒙特卡洛，因此上面的说明没有使用采样概率。开启后，可以比较所选候选着法在多条续局中的子力损失、终点将杀等事件。'));const b=element('button',wording('Add Monte Carlo sampling','补充蒙特卡洛采样'),'secondary');b.id='run-monte-carlo';b.disabled=!!game?.pending;b.onclick=()=>ask(false,viewedPly,true);block.append(b);}
 else{paragraph(block,wording(`Each selected move gets ${cfg.rollouts} independent samples, including ${c.san}. A sample lasts at most ${cfg.horizon} plies including the first move; one ply is one player's move.`,`包括 ${c.san} 在内，每个选中的候选着法都有 ${cfg.rollouts} 条独立样本。每条最多 ${cfg.horizon} 个半回合（含首步）；半回合就是任意一方走一步。`));paragraph(block,wording(`At each later turn, Stockfish searches ${cfg.policy_nodes} nodes and supplies up to ${cfg.policy_topk} choices. Moves over ${cfg.max_loss_cp} cp behind the best are excluded. The better remaining moves are sampled more often, using softmax temperature ${cfg.temperature_cp} cp. All outcomes are retained.`,`在每个后续回合，Stockfish 用 ${cfg.policy_nodes} 节点给出最多 ${cfg.policy_topk} 个候选。落后最佳超过 ${cfg.max_loss_cp} cp 的着法被排除，其余着法中评分较好的被抽到的概率更高；使用温度 ${cfg.temperature_cp} cp 的 softmax 规则。所有抽出的结果都会保留。`));paragraph(block,wording('A sample stops at game end or a claimable draw. The percentages below describe this policy and horizon, not perfect-play winning chances. The 95% intervals show sampling uncertainty; a difference interval spanning zero cannot establish which action has the higher event rate.','终局或可申和时提前停止。下面的百分比描述这套策略和时域，不是双方最优对弈的胜率。95% 区间表示采样不确定性；差值区间跨过零时，尚不能确定哪一步的事件率更高。'));}root.append(block);
}

function syncEvidencePreview(){
 $('counterexample-preview')?.remove();
 if(!pvFen||trajectoryKind!=='counterexample'||!counterexampleMove||!$('move-explanation'))return;
 const box=element('div',undefined,'counterexample-preview');box.id='counterexample-preview';
 box.append(element('strong',wording(`Previewing the ${counterexampleMove.san} comparison line`,`正在预览 ${counterexampleMove.san} 的对照变化`)));
 paragraph(box,wording('The board shows this continuation. Your actual game has not changed.','棋盘正在展示这条续局，实际对局没有改变。'));
 const moves=element('div',undefined,'pv');counterexampleMove.pv_steps.forEach((step,i)=>{const b=element('button',step.san);b.classList.toggle('active',pvIndex===i);b.onclick=()=>{pvFen=step.fen_after;pvIndex=i;render();};moves.append(b);});box.append(moves);
 const back=element('button',wording('Return to the analysed position','返回被分析的局面'),'text-button');back.onclick=()=>{pvFen=null;pvIndex=-1;render();};box.append(back);$('move-explanation').prepend(box);
}

function paintMechanismEvidence(root,a){
 const report=a.concept_agent,c=currentCandidate(),plan=report.move_mechanisms?.find(p=>p.move_uci===c?.uci);if(!plan)return;
 const block=sectionStep('mechanism-guide',wording('The concrete mechanism behind this explanation','这段解释对应的具体机制'));
 paragraph(block,wording('The displayed paragraph is the generated explanation stored with this candidate. Below are its executable claims and separately checked links. An unchanged property is not automatically an explanation of the move.','右侧段落是为当前候选着法生成并保存的解释。下面逐项列出其可执行命题和单独检验的联系。一个没有发生变化的属性，不会自动成为这步棋的理由。'));
 const names={vacates_square:'腾出格子',attacks_square:'攻击指定格',opens_line:'打开指定线路',absolute_pin:'指定棋子被绝对牵制',legal_capture:'指定吃子是否合法',passed_pawn:'指定兵是否为通路兵',bishop_pair:'拥有异色格双象',gives_check:'将军',checkmate:'将杀',castles:'王车易位',material_gain:'首步净得子力',line_material_gain:'此续局中净得子力',line_material_loss:'此续局中净丢子力',forced_material_gain:'限定步数内强制净得子力'};
 const labels={verified:'事实成立',falsified:'与棋盘事实不符',unknown:'尚无法判断',invalid_arguments:'棋子或参数不匹配',unsupported_attribute:'当前不支持',verified_rule:'规则机制通过检验',observed_only:'仅为这条续局中的观察',unverified_relation:'联系尚未验证'};
 block.append(table([wording('Claim','命题'),wording('Exact target','具体对象'),wording('Check result','检验结果')],plan.claims.map(h=>[`${h.id} · ${lang==='zh'?(names[h.attribute]||h.attribute):h.attribute}`,`${h.color==='white'?wording('White','白方'):wording('Black','黑方')} · ${[h.square,h.target_square].filter(Boolean).join(' → ')||c.san} · ${wording('ply','第')}${h.at_ply}${lang==='zh'?'个半回合后':''}`,(lang==='zh'?(labels[h.status]||h.status):h.status)+(h.actual_value===true?wording(' · value: true',' · 实测：是'):h.actual_value===false?wording(' · value: false',' · 实测：否'): '')])));
 block.append(table([wording('Link','联系'),wording('Result','结果')],plan.relations.map(r=>[`${r.from_id==='move'?c.san:r.from_id} → ${r.to_id} (${r.relation})`,lang==='zh'?(labels[r.status]||r.status):r.status])));
 paragraph(block,wording('Claim labels such as H1 or F1 identify rows in this table only. A true or false value is the detected property; passing a check means it matches the proposed value. creates/removes means the move makes the property appear/disappear; enables names a separately checked link.', 'H1、F1 等只是本表中命题的编号。下面显示属性实际为真还是为假；“事实成立”表示结果符合提出的命题。creates/removes 表示这步棋使属性出现或消失；enables 表示两个命题之间还需单独检查的联系。'));
 paragraph(block,wording('The checked links currently cover clearing a blocker to open a slider line, that open line establishing an attack, and a king pin making a specific capture illegal. Other links remain unverified. This does not establish which property uniquely determines the position value.','当前能检查的联系包括：移开阻挡子打开线路、线路打开后形成攻击、绝对牵制使某个具体吃子不合法。其他联系仍标为未验证。这不等于证明某个属性单独决定了局面优劣。'));
 paragraph(block,wording('The same explanation text is exported as the training target. Verification and model provenance are separate fields. Free-form prose still needs semantic review before entering a trusted training set.','导出的训练目标与页面解释使用同一份文字。验证记录和模型来源单独保存。自由生成的整段文字仍需要语义审查，才能进入可信训练集。'));root.append(block);
}
