(() => {
  'use strict';
  const profiles = [
    ['legacy_selected_sprint','candidate_selected_sprint','candidate_all_work','candidate_team_fallback_selected_sprint'],
    ['candidate_selected_sprint','candidate_all_work','candidate_team_fallback_selected_sprint','legacy_selected_sprint'],
    ['candidate_all_work','candidate_team_fallback_selected_sprint','legacy_selected_sprint','candidate_selected_sprint'],
    ['candidate_team_fallback_selected_sprint','legacy_selected_sprint','candidate_selected_sprint','candidate_all_work'],
    ['legacy_selected_sprint','candidate_team_fallback_selected_sprint','candidate_all_work','candidate_selected_sprint'],
  ];
  const steps = profiles.flatMap((order, round) => order.flatMap(profile =>
    ['refresh','reuse'].map(cacheIntent => ({ round: round + 1, profile, cacheIntent }))));
  const form = document.querySelector('#campaign-form');
  const component = document.querySelector('#component-group');
  const team = document.querySelector('#team-group');
  const sprint = document.querySelector('#sprint-id');
  const run = document.querySelector('#run');
  const abortButton = document.querySelector('#abort');
  const status = document.querySelector('#status');
  const progress = document.querySelector('#progress');
  const download = document.querySelector('#download');
  let campaignId = null;
  let activeController = null;
  const stopCodes = {auth_required:'oauth_unavailable',account_disabled:'oauth_unavailable',auth_connection_revoked:'oauth_unavailable',
    auth_connection_stale:'oauth_unavailable',csrf_required:'csrf_unavailable',invalid_measurement_scope:'invalid_campaign',
    measurement_sprint_required:'invalid_scope',measurement_group_not_found:'invalid_scope',measurement_shared_groups_required:'invalid_scope',
    measurement_config_source_required:'invalid_scope',measurement_board_invalid:'invalid_scope',measurement_project_scope_required:'invalid_scope',
    measurement_components_required:'invalid_scope',measurement_team_scope_required:'invalid_scope',measurement_field_config_invalid:'invalid_scope',
    measurement_sprint_invalid:'invalid_scope',measurement_config_changed:'configuration_drift',measurement_membership_changed:'membership_drift',
    measurement_data_changed:'content_drift',measurement_cache_miss:'cache_miss',measurement_campaign_busy:'campaign_busy',
    measurement_campaign_expired:'campaign_expired',measurement_scope_too_large:'scope_ceiling',measurement_unrepresentative_scope:'unrepresentative_scope',
    measurement_projection_invalid:'candidate_incomplete',measurement_rate_limited:'rate_limited',measurement_jira_failed:'jira_rejected',
    measurement_breaker_contaminated:'breaker_contaminated',config_storage_unavailable:'storage_unavailable',
    measurement_memory_unavailable:'memory_sample_unavailable',measurement_deadline_exceeded:'sample_deadline'};
  function stopCode(value) { return stopCodes[value] || value || 'invalid_campaign'; }

  function setStatus(value) { status.textContent = value; }
  function requestHeaders(csrf) {
    const value = {'X-Requested-With':'jira-execution-planner'};
    if (csrf) value['X-CSRF-Token'] = csrf;
    return value;
  }
  async function csrf(signal) {
    const response = await fetch('/api/auth/csrf', {signal, credentials:'same-origin'});
    const body = await response.json();
    if (!response.ok || typeof body.csrfToken !== 'string') throw new Error('csrf_unavailable');
    return body.csrfToken;
  }
  async function post(path, body, signal) {
    const token = await csrf(signal);
    const response = await fetch(path, {method:'POST', signal, credentials:'same-origin',
      headers:{...requestHeaders(token),'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('invalid_campaign'); }
    if (!response.ok) throw new Error(stopCode(parsed.error));
    return {body:parsed, timing:response.headers.get('Server-Timing')};
  }
  function timingObject(header) {
    const map = {'config':'config','cache':'cache','epic-index':'epicIndex','sprint-membership':'sprintMembership',
      'bootstrap-children':'bootstrapChildren','remaining-children':'remainingChildren','shape':'shape','total':'total'};
    const result = {};
    for (const token of String(header || '').split(',')) {
      const match = token.trim().match(/^([a-z-]+);dur=(\d+(?:\.\d+)?)$/);
      if (!match || !map[match[1]] || Object.hasOwn(result,map[match[1]])) throw new Error('invalid_campaign');
      result[map[match[1]]] = Number(match[2]);
    }
    if (Object.keys(result).length !== 8) throw new Error('invalid_campaign');
    return result;
  }
  function legacyMetrics(product, tech, wallMs, transport, descriptor) {
    const teamIds=new Set(descriptor.teamIds.map(String));
    const teamLabels=new Set(descriptor.teamLabels.map(value=>String(value).trim().toLowerCase()).filter(Boolean));
    const issueMap=new Map(), detailMap=new Map(), scopeMap=new Map();
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for (const body of [product,tech]) {
      const filtered=(body.issues||[]).filter(issue=>teamIds.has(String(issue?.fields?.teamId||issue?.fields?.team?.id||'')));
      for (const issue of filtered) {
        const key=String(issue?.key||'').trim().toUpperCase();
        if (!key) continue;
        if (issueMap.has(key)&&!same(issueMap.get(key),issue)) throw new Error('candidate_incomplete');
        if (!issueMap.has(key)) issueMap.set(key,issue);
      }
      const referenced=new Set(filtered.map(issue=>String(issue?.fields?.epicKey||'').trim().toUpperCase()).filter(Boolean));
      for (const [rawKey,detail] of Object.entries(body.epics||{})) {
        const key=String(rawKey).trim().toUpperCase(); if(!referenced.has(key)) continue;
        if (detailMap.has(key)&&!same(detailMap.get(key),detail)) throw new Error('candidate_incomplete');
        if (!detailMap.has(key)) detailMap.set(key,detail);
      }
      for (const epic of body.epicsInScope||[]) {
        const labels=new Set((epic?.labels||[]).map(value=>String(value).trim().toLowerCase()).filter(Boolean));
        if (descriptor.teamIds.length===0 || (epic?.teamId && !teamIds.has(String(epic.teamId))) && ![...labels].some(value=>teamLabels.has(value))) continue;
        const key=String(epic?.key||'').trim().toUpperCase(); if(key&&!scopeMap.has(key)) scopeMap.set(key,epic);
      }
    }
    const groups=new Map();
    for (const issue of issueMap.values()) {
      const key=String(issue?.fields?.epicKey||'NO_EPIC').trim().toUpperCase()||'NO_EPIC';
      if(!groups.has(key)) groups.set(key,{epic:detailMap.get(key)||null,children:new Set()});
      groups.get(key).children.add(String(issue.key).trim().toUpperCase());
    }
    for(const [key,epic] of scopeMap) {
      if(!groups.has(key)) groups.set(key,{epic:detailMap.get(key)||epic,children:new Set()});
      else if(!groups.get(key).epic) groups.get(key).epic=detailMap.get(key)||epic;
    }
    const visible=[...groups.values()].filter(group=>group.epic);
    const epicCount=visible.length;
    const childCount=visible.reduce((sum,group)=>sum+group.children.size,0);
    const metricNames = ['wallMs','indexReadyMs','bootstrapColumnReadyMs','fullReadyMs','stageMs','serverTimingMs',
      'candidateEpicCount','epicCount','fetchedChildCount','childCount','bootstrapChildCount','productChildCount',
      'techChildCount','otherChildCount','projectCount','componentCount','teamCount','columnCount','terminalEpicCount',
      'unmappedEpicCount','emptyEpicCount','maxPagesPerSearch','maxBatchesPerColumn','jiraLogicalRequestCount',
      'jiraCatalogCallCount','jiraSearchCallCount','jiraPageCount','jiraBatchCount','jiraAttemptCount','jiraRetryCount',
      'jiraFailureAttemptCount','jiraRateLimitCount','jiraFastFailCount','jiraRetrySleepMs','jiraRetryAfterMs',
      'jiraResponseBytes','jiraFailedResponseBytes','oauthRefreshCount','oauthAttemptCount','oauthRetryCount',
      'oauthRateLimitCount','shapedResponseBytes','candidateCacheBytes','metadataCacheBytes','maxBatchSize',
      'maxConcurrency','maxEncodedRequestBytes','memoryPeakDeltaBytes','memoryRetainedDeltaBytes','metricAvailability',
      'legacyCapped','legacyDenominator','complete','membershipStable','contentStable','ceilingHeadroomLow'];
    const metrics = Object.fromEntries(metricNames.map(name => [name,null]));
    const capped = [product,tech].some(body => Number(body.total) > (body.issues || []).length || (body.issues || []).length >= 250);
    Object.assign(metrics, transport, {wallMs,epicCount,childCount,
      legacyDenominator:epicCount+childCount,legacyCapped:capped,metricAvailability:'legacy_partial'});
    return metrics;
  }
  async function legacyPair(descriptor, step, signal) {
    const base = new URLSearchParams({sprint:String(descriptor.sprintId),team:'all',groupId:descriptor.groupId,
      teamIds:descriptor.teamIds.join(','),teamLabels:descriptor.teamLabels.join(','),purpose:'dashboard',
      refresh:String(descriptor.refresh)});
    const started = performance.now();
    const lane = async project => {
      const query = new URLSearchParams(base); query.set('project',project);
      const response = await fetch('/api/tasks-with-team-name?'+query, {signal,credentials:'same-origin',
        headers:{...requestHeaders(),'X-Measurement-Campaign':campaignId,'X-Measurement-Step':String(step)}});
      const body = await response.json();
      if (!response.ok) throw new Error(stopCode(body.error));
      return body;
    };
    const pair = await Promise.all([lane('product'),lane('tech')]);
    return {pair,wallMs:Math.round((performance.now()-started)*10)/10};
  }
  async function runCampaign(event) {
    event.preventDefault(); run.disabled=true; abortButton.disabled=false; download.hidden=true;
    const rounds = profiles.map((_, index) => ({round:index+1,samples:[]}));
    try {
      const beginController = new AbortController(); activeController=beginController;
      const begin = (await post('/api/dev/eng-board-measurement/control', {action:'begin',componentGroupId:component.value,
        teamGroupId:team.value,sprintId:Number(sprint.value)}, beginController.signal)).body;
      campaignId=begin.campaignId;
      for (let index=0; index<steps.length; index++) {
        const row=steps[index]; progress.value=index; setStatus(`Running ${index+1} of 40…`);
        const controller=new AbortController(); activeController=controller;
        const timer=setTimeout(()=>controller.abort('sample_deadline'),30000);
        try {
          const reserve=(await post('/api/dev/eng-board-measurement/control', {action:'continue',phase:'reserve',campaignId,step:index},controller.signal)).body;
          let sample;
          if (row.profile==='legacy_selected_sprint') {
            const legacy=await legacyPair(reserve.legacyRequest,index,controller.signal);
            const finish=(await post('/api/dev/eng-board-measurement/control', {action:'continue',phase:'finish',campaignId,step:index},controller.signal)).body;
            sample={profile:row.profile,cacheIntent:row.cacheIntent,candidateCacheState:'not_applicable',
              metadataCacheState:'unverified',result:'success',metrics:legacyMetrics(...legacy.pair,legacy.wallMs,finish.transport,reserve.legacyRequest)};
          } else {
            const started=performance.now();
            const response=await post('/api/dev/eng-board-measurement/sample',{campaignId,step:index},controller.signal);
            const metrics=response.body.sample.metrics;
            metrics.wallMs=Math.round((performance.now()-started)*10)/10;
            metrics.serverTimingMs=timingObject(response.timing);
            const finish=(await post('/api/dev/eng-board-measurement/control',{action:'continue',phase:'finish',campaignId,step:index},controller.signal)).body;
            for (const [key,value] of Object.entries(finish.transport)) if (metrics[key] !== value) throw new Error('invalid_campaign');
            sample=response.body.sample;
          }
          rounds[row.round-1].samples.push(sample);
        } finally { clearTimeout(timer); }
      }
      const endController=new AbortController(); activeController=endController;
      await post('/api/dev/eng-board-measurement/control',{action:'end',campaignId},endController.signal);
      const result={schemaVersion:2,result:'complete',deadlineMode:'cooperative',configSource:'workspace_db',
        componentNamePolicy:'broadcast_exact_name',authorizedScope:'configured_product_tech_28d',
        legacyComparison:'context_only',rounds};
      const blob=new Blob([JSON.stringify(result)],{type:'application/json'});
      download.href=URL.createObjectURL(blob); download.download='eng-board-measurement-v2.json'; download.hidden=false;
      progress.value=40; setStatus('Complete: STOP deadline_bound_unproven. Schema v2 cannot authorize rollout.');
    } catch (error) {
      const reason=activeController?.signal?.reason;
      const code=reason==='sample_deadline'?'sample_deadline':reason==='user_aborted'?'user_aborted':stopCode(error&&error.message);
      setStatus(code==='sample_deadline'?'FAIL sample_deadline':`STOP ${code}`);
      if (campaignId) {
        try { const controller=new AbortController(); setTimeout(()=>controller.abort(),5000);
          await post('/api/dev/eng-board-measurement/control',{action:'abort',campaignId},controller.signal); } catch (_) {}
      }
    } finally { campaignId=null; activeController=null; run.disabled=false; abortButton.disabled=true; }
  }
  async function loadOptions() {
    try {
      const response=await fetch('/api/dev/eng-board-measurement/options',{credentials:'same-origin'});
      const body=await response.json(); if (!response.ok) throw new Error(body.error || 'invalid_scope');
      for (const row of body.groups) {
        if (row.profileEligibility.includes('candidate_selected_sprint')) component.add(new Option(row.label,row.id));
        if (row.profileEligibility.includes('candidate_team_fallback_selected_sprint')) team.add(new Option(row.label,row.id));
      }
      setStatus('Ready. Select both configured Departments and enter a numeric sprint id.');
    } catch (error) { setStatus(`STOP ${error && error.message || 'invalid_scope'}`); run.disabled=true; }
  }
  form.addEventListener('submit',runCampaign);
  abortButton.addEventListener('click',()=>{ if(activeController) activeController.abort('user_aborted'); });
  loadOptions();
})();
