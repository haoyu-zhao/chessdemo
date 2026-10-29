'use strict';
// A narrow extension of the original Chess Studio, with the same board and history.
let selectedCandidate = 0;
let selectedAnalysisKey = null;

function configureCausalMessages() {
  Object.assign(messages.en, {
    subtitle:'Explore this position. Compare the ideas behind your next moves.',
    thinking:'Understanding this position', analysisIntro:'Candidate moves and their consequences',
    thinkingNow:'Exploring the continuations…', firstMoveTitle:'What would you play here?',
    firstMoveText:'Start a position, then compare the recommended moves and their explanations. You can move either side to explore what happens next.',
    original:'Position analysis', criticalLine:'If you play this move',
    rawOutput:'View supporting analysis', ready:'Analysis ready', loading:'Connecting to analysis',
    thinkingTime:'{s}s elapsed · Comparing the alternatives and their continuations',
    researchNote:'Explanations use searched and sampled continuations. They remain open to verification.',
    helpFoot:'Stockfish evaluates the moves. Counterfactual sampling supplies evidence for the explanations.',
    noPv:'No continuation is available.', analyze:'Analyze this position', queenMove:'Play this move',
    newGame:'+ New position', chooseSide:'Choose your board orientation, or enter a position below. You can explore moves for either side.',
    playWhite:'White at bottom', playBlack:'Black at bottom', whiteFirst:'Explore both sides', queenFirst:'Explore both sides',
    start:'Open position', liveHint:'Move either side to explore a new position. Its explanation updates automatically.',
    positionAnalysis:'Current position · {side} to move', pvHint:'Exploring a candidate continuation. Select “Live position” to return.',
    candidate:'CANDIDATE', recommended:'FIRST CHOICE', positionReady:'Position overview',
    help:['Open a new position or paste a FEN. The analysis describes that exact board.',
          'Compare up to three candidate moves. Select one to read its reasoning and preview its continuation.',
          'Move either side on the board, or select “Play this move”. The new position gets its own analysis.',
          'Use the history and arrows to revisit a position and its saved explanation.',
          'Download JSON for the position analyses. Supporting evidence includes the pipeline’s sampling and search settings.']
  });
  Object.assign(messages.zh, {
    subtitle:'理解当前局面，比较下一步的不同选择。', thinking:'当前局面的思路',
    analysisIntro:'候选着法，以及它们会带来什么', thinkingNow:'正在比较后续变化…',
    firstMoveTitle:'这个局面，你会怎么走？',
    firstMoveText:'打开一个局面，查看推荐着法和逐项解释。你可以移动任一方棋子，探索不同选择的后果。',
    original:'当前局面分析', criticalLine:'如果走这一步', rawOutput:'查看分析依据',
    ready:'分析已就绪', loading:'正在连接分析服务', thinkingTime:'已等待 {s} 秒 · 正在比较候选着法与后续变化',
    researchNote:'解释基于搜索和采样续局，仍可结合棋盘与变化线核对。',
    helpFoot:'Stockfish 评价候选着法，反事实采样管线为解释提供证据。', noPv:'暂无可回放的变化线。',
    analyze:'分析当前局面', queenMove:'走这一步', newGame:'＋ 新的局面',
    chooseSide:'选择棋盘方向，或在下方输入 FEN。你可以为双方走棋，探索局面。',
    playWhite:'白方在下', playBlack:'黑方在下', whiteFirst:'可为双方走棋', queenFirst:'可为双方走棋',
    start:'打开局面', liveHint:'可为双方走棋。每走一步，都会分析新的局面。',
    positionAnalysis:'当前局面 · 轮到{side}', pvHint:'正在预览候选变化。点击「当前局面」返回。',
    candidate:'候选着法', recommended:'优先推荐', positionReady:'局面判断',
    help:['打开新的局面，或输入 FEN；解释对应当前棋盘。',
          '比较最多三个候选着法，点击切换解释与后续变化。',
          '可为双方走棋，也可点击「走这一步」；新的局面会自动得到分析。',
          '使用棋谱和箭头回看，查看每个局面保存的解释。',
          'JSON 包含各局面的解释；分析依据中保留了搜索、采样与验证设置。']
  });
}

function currentCandidate() {
  return activeAnalysis()?.candidates?.[selectedCandidate] || null;
}

function renderCausalAnalysis() {
  const analysis = activeAnalysis();
  const pending = game?.pending?.ply === viewedPly ? game.pending : null;
  const key = analysis?.evidence_id || null;
  if (key !== selectedAnalysisKey) { selectedAnalysisKey = key; selectedCandidate = 0; }
  const candidates = analysis?.candidates || [];
  if (selectedCandidate >= candidates.length) selectedCandidate = 0;
  show('thinking-state', !!pending);
  show('empty-analysis', !analysis && !pending);
  show('analysis-content', !!analysis && !pending);
  const fen = analysis?.fen || positionFen();
  $('analysis-context').textContent = t('positionAnalysis', {side:t(fen.split(' ')[1]==='w'?'white':'black')});
  if (pending) $('thinking-time').textContent = t('thinkingTime',{s:Math.max(0,Math.floor(Date.now()/1000-pending.started))});
  if (analysis) {
    $('state-overview').textContent = analysis.state_summary || analysis.text;
    $('candidate-choices').replaceChildren(...candidates.map((candidate, i) => {
      const button = document.createElement('button');
      button.className = 'candidate-choice' + (i===selectedCandidate?' active':'');
      button.setAttribute('aria-pressed', String(i===selectedCandidate));
      const score = candidate.score.mate === null ? (candidate.score.cp/100).toFixed(2).replace(/^(?!-)/,'+') : 'M'+candidate.score.mate;
      const name = document.createElement('strong'); name.textContent = candidate.san;
      const value = document.createElement('small'); value.textContent = score;
      button.append(name, value);
      button.onclick = () => {selectedCandidate=i;pvFen=null;pvIndex=-1;render();};
      return button;
    }));
    const candidate = candidates[selectedCandidate];
    document.querySelector('[data-i18n="recommended"]').textContent = t(selectedCandidate===0?'recommended':'candidate');
    $('best-move').textContent = candidate?.san || analysis.best_move_san;
    $('analysis-timing').textContent = `${analysis.elapsed_seconds}s`;
    $('explanation').textContent = candidate?.text || analysis.text;
    $('raw-output').textContent = JSON.stringify({position:analysis.fen,candidate,
      settings:analysis.evidence_settings,root_ranking_stable:analysis.root_ranking_stable,
      language_model:analysis.explanation_model},null,2);
    const steps = candidate?.pv_steps || [];
    $('pv').replaceChildren(...steps.map((step,i)=>{
      const button=document.createElement('button');button.textContent=step.label||step.san;
      button.classList.toggle('active',pvIndex===i);
      button.onclick=()=>{pvFen=step.fen_after;pvIndex=i;renderBoard();renderMeta();renderCausalAnalysis();};
      return button;
    }));
  }
  const warnings=[game?.error,analysis?.warning].filter(Boolean);
  $('error').textContent=warnings.join('\n');show('error',warnings.length>0);
  $('analyze').textContent=t('analyze');
  $('analyze').disabled=!game||!!game.pending||!ready||!!pvFen||game.game_over&&isLive();
  show('play-model',!!game&&!game.game_over&&isLive());
  $('play-model').textContent=t('queenMove');
  $('play-model').disabled=!!game?.pending||!ready||!currentCandidate();
}

function renderCausalMeta() {
  $('bottom-name').textContent=t(flipped?'black':'white');
  $('top-name').textContent=t(flipped?'white':'black');
  $('bottom-description').textContent=t('original');
  $('top-description').textContent=t('original');
  if(!game?.game_over&&!game?.pending) $('turn-label').textContent=t(positionFen().split(' ')[1]==='w'?'white':'black')+(lang==='zh'?'行棋':' to move');
}
