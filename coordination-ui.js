(() => {
  const P=GroundNodeCoordination,$=id=>document.getElementById(id);let state=P.create(),selected='VH-101',draft=null,lastAudit='',lastTime=performance.now();
  const labels={offline:'Offline',connected:'Connected',holding:'Holding',requestSent:'Request sent',requested:'Request received',offered:'Offer awaiting acceptance',authorized:'Landing accepted',approaching:'Approach reported',landed:'Landed',servicing:'Servicing',departureAuthorized:'Departure accepted',detected:'Detected · no channel'};
  function clearReview(){['reviewPilot','reviewAirspace','reviewReadiness'].forEach(id=>$(id).checked=false);}
  ['reviewPilot','reviewAirspace','reviewReadiness'].forEach(id=>$(id).onchange=()=>render());
  function notice(text,error=false){$('actionNotice').textContent=text;$('actionNotice').classList.toggle('error',error);}
  function act(command){const result=P.dispatch(state,selected,command);notice(result.ok?state.messages.at(-1)?.text||'Updated.':result.reason,!result.ok);render();}
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>act(b.dataset.action));
  document.querySelectorAll('[data-aircraft]').forEach(b=>b.onclick=()=>{selected=b.dataset.aircraft;draft=null;clearReview();$('draftResult').textContent='No draft prepared.';notice(selected==='TRACK-03'?'This is a visual track only. No supported communication channel; no reservation can be issued.':'Selected '+selected+'. Follow the connection and request steps in the Aircraft Client.');render();});
  $('toggleObstruction').onclick=()=>act('obstruction');$('toggleTraffic').onclick=()=>act('traffic');
  $('resetSession').onclick=()=>{state=P.create();selected='VH-101';draft=null;clearReview();lastTime=performance.now();$('requestInput').value='';$('draftResult').textContent='No draft prepared.';notice('Exercise reset. Connect an aircraft to begin.');render();};
  $('prepareRequest').onclick=()=>{
    const text=$('requestInput').value.toLowerCase().trim(),landing=/\b(land|landing|arrive|arrival)\b/.test(text),departure=/\b(depart|departure|takeoff|take off)\b/.test(text);
    if(landing===departure||/\b(not|never|cancel|don't|do not)\b/.test(text)){draft=null;$('draftResult').textContent='Intent unclear. Use a single explicit landing or departure request.';}
    else{draft={aircraft:selected,command:landing?'requestLanding':'requestDeparture'};$('draftResult').textContent=`Review: ${selected} → GN-01 / ${landing?'REQUEST LANDING':'REQUEST DEPARTURE'}. Sending creates a request, not permission.`;}render();
  };
  $('requestInput').oninput=()=>{draft=null;$('draftResult').textContent='Text changed. Prepare a new draft.';render();};
  $('sendDraft').onclick=()=>{if(draft?.aircraft===selected){const command=draft.command;draft=null;act(command);}};
  $('exportSession').onclick=()=>{const blob=new Blob([JSON.stringify({protocol:'groundnode-concept/0.2',simulated:true,elapsedSeconds:state.now,aircraft:state.aircraft,messages:state.messages},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='groundnode-coordination-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function render(){
    const a=state.aircraft.find(a=>a.id===selected),r=a.reservation,ready=a.connected&&a.capabilities&&a.verified&&a.operationReview;
    $('regulatoryProfile').textContent=a.mode==='unconnected'?'Unknown aircraft: operating category not established.':a.type==='UAM'?'Powered-lift / UAM research profile. Aircraft and operation-specific certification and approvals remain to be established.':'Small-UAS research profile. Review Part 107 applicability, Remote ID and required authorization or waivers.';
    $('reviewState').textContent=a.operationReview?'Demo review recorded · not independently verified':'Not recorded · self-attestation only';
    ['reviewPilot','reviewAirspace','reviewReadiness'].forEach(id=>{const input=$(id);input.disabled=a.operationReview||a.mode==='unconnected';if(a.operationReview)input.checked=true;});
    document.querySelectorAll('[data-aircraft]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.aircraft===selected)));
    const allowed={connect:a.mode!=='unconnected'&&!a.connected,disconnect:a.connected,capabilities:a.connected&&!a.capabilities,verify:a.connected&&a.mode==='visitor'&&a.capabilities&&!a.verified,
      review:a.connected&&a.capabilities&&a.verified&&!a.operationReview&&['reviewPilot','reviewAirspace','reviewReadiness'].every(id=>$(id).checked),
      requestLanding:ready&&!r&&['connected','holding'].includes(a.phase),requestDeparture:ready&&!r&&state.occupant===a.id&&['landed','servicing'].includes(a.phase),
      offer:ready&&a.phase==='requested',accept:ready&&r?.status==='received',unable:ready&&r?.status==='received',approach:ready&&a.phase==='authorized',touchdown:ready&&a.phase==='approaching',service:ready&&a.phase==='landed'&&!state.blocked,departed:ready&&a.phase==='departureAuthorized'};
    document.querySelectorAll('[data-action]').forEach(b=>b.disabled=!allowed[b.dataset.action]);
    $('sendDraft').disabled=!draft||!allowed[draft.command];$('exportSession').disabled=!state.messages.length;
    $('aircraftName').textContent=a.id;$('sessionPhase').textContent=labels[a.phase]||a.phase;
    $('aircraftMode').textContent=a.mode==='equipped'?'UAM · onboard adapter simulation':a.mode==='visitor'?'UAV · guest operator channel':'Unknown aircraft · identity not established';
    $('connectionBadge').textContent=a.connected?'Link established':'No active link';
    $('modeExplanation').textContent=a.mode==='equipped'?'The aircraft adapter exchanges structured requests. Its own flight controller remains responsible for flight.':a.mode==='visitor'?'This UAV has no GroundNode adapter. A compatible operator channel carries its requests and acknowledgements after ground-side review.':'Detection alone cannot deliver instructions. This track is outside the approach sector; an operator must establish a supported channel before coordinating operations.';
    $('checkLink').textContent=a.connected?'Established':'No supported session';$('checkCapabilities').textContent=a.capabilities?'Exchanged (demo)':'Awaiting exchange';$('checkVisitor').textContent=a.mode==='visitor'?(a.verified?'Operator reviewed':'Required'):a.mode==='unconnected'?'Operator coordination needed':'Adapter path';
    $('checkPad').textContent=state.blocked?'Obstructed':state.traffic?'Traffic conflict':P.available(state,a)?'Available':'Occupied or reserved';
    $('nodeState').textContent=state.blocked?'Obstructed':state.traffic?'Traffic conflict':state.occupant?'Occupied':state.aircraft.some(b=>b.reservation)?'Reserved':'Available';$('occupant').textContent=state.occupant||'None';$('reservationOwner').textContent=state.aircraft.find(b=>b.reservation)?.id||'None';
    $('padRing').setAttribute('stroke',state.blocked?'#ffae79':state.traffic?'#f3cf80':'#75dcc5');$('debris').toggleAttribute('hidden',!state.blocked);$('conflictTrack').toggleAttribute('hidden',!state.traffic);
    $('toggleObstruction').setAttribute('aria-pressed',String(state.blocked));$('toggleObstruction').textContent=state.blocked?'Clear pad obstruction':'Add pad obstruction';$('toggleTraffic').setAttribute('aria-pressed',String(state.traffic));$('toggleTraffic').textContent=state.traffic?'Clear conflicting traffic':'Add conflicting traffic';
    $('requestTitle').textContent=a.phase==='requestSent'?'Request in transit':a.phase==='requested'?`${a.id} requests ${a.operation}`:r?`${r.operation} / ${r.id}`:'No request awaiting assessment';
    $('requestDetail').textContent=a.phase==='requested'?'Assess checks to offer a reservation, or return HOLD if conditions prevent it.':a.mode==='visitor'&&!a.verified?'Guest identity and response channel require operator review.':'Ground offers a reservation; the aircraft must explicitly accept it.';
    const latest=[...state.messages].reverse().find(m=>m.aircraft===selected&&['REVOKED','EXPIRED','REJECTED','LINK_LOST'].includes(m.type));
    $('messageStatus').textContent=r?r.status:latest?latest.status:'No reservation';$('messageStatus').className='status-chip '+(r?.status||latest?.status||'');
    $('instruction').textContent=r?`${r.id} · ${r.operation.toUpperCase()} at GN-01. ${r.status==='sent'?'Offer sent; awaiting delivery.':r.status==='received'?'Received. Accept or decline the proposed reservation.':'Accepted by aircraft/operator. Report the next operation step.'}`:a.phase==='landed'?'Touchdown confirmed. Pad remains occupied.':a.phase==='servicing'?'Service active. Request departure when ready.':latest?.text||'No active pad reservation.';
    $('reservationTimer').textContent=r?`${Math.max(0,Math.ceil(r.expires-state.now))} s remaining · ${r.status==='accepted'?'operation':'response'} deadline`:'No active deadline';
    const key=state.seq+'|'+state.messages.map(m=>m.status).join(',');if(key!==lastAudit){lastAudit=key;$('coordinationAudit').replaceChildren(...state.messages.slice().reverse().map(m=>{const row=document.createElement('tr');for(const value of [m.at.toFixed(1)+' s',m.aircraft,m.direction,m.type+' · '+m.text]){const td=document.createElement('td');td.textContent=value;row.append(td);}const td=document.createElement('td'),badge=document.createElement('span');badge.className='status-chip '+m.status;badge.textContent=m.status;td.append(badge);row.append(td);return row;}));}
  }
  setInterval(()=>{const now=performance.now(),before=state.seq;P.advance(state,(now-lastTime)/1000);lastTime=now;if(state.seq!==before)notice(state.messages.at(-1).text,true);render();},250);
  render();
})();

