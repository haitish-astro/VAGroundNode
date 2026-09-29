// GroundNode Link: deterministic local coordination exercise, not aircraft control.
(function(g){
  function create(){return {now:0,seq:0,nextReservation:0,blocked:false,traffic:false,occupant:null,
    aircraft:[{id:'VH-101',type:'UAM',mode:'equipped',connected:false,capabilities:false,verified:false,operationReview:false,phase:'offline',reservation:null},
      {id:'VIS-204',type:'UAV',mode:'visitor',connected:false,capabilities:false,verified:false,operationReview:false,phase:'offline',reservation:null},
      {id:'TRACK-03',type:'Unknown',mode:'unconnected',connected:false,capabilities:false,verified:false,operationReview:false,phase:'detected',reservation:null}],messages:[]};}
  const find=(s,id)=>s.aircraft.find(a=>a.id===id);
  function log(s,a,type,text,status='received',direction='system',extra={}){
    const m={id:++s.seq,at:s.now,aircraft:a?.id||'GN-01',type,text,status,direction,...extra};s.messages.push(m);s.messages=s.messages.slice(-120);return m;
  }
  function invalidate(s,a,status,reason){
    if(!a.reservation)return;
    const r=a.reservation;r.status=status;
    const m=s.messages.find(m=>m.reservation===r.id);if(m)m.status=status;
    log(s,a,status.toUpperCase(),reason,status,'node → aircraft',{reservation:r.id});
    a.reservation=null;a.phase=s.occupant===a.id?'landed':a.connected?'holding':'offline';
  }
  function available(s,a){return !s.blocked&&!s.traffic&&(!s.occupant||s.occupant===a.id)&&!s.aircraft.some(b=>b.id!==a.id&&b.reservation);}
  function dispatch(s,id,command){
    const a=find(s,id);if(!a)return {ok:false,reason:'Unknown aircraft.'};
    const reject=reason=>{log(s,a,'REJECTED',reason,'rejected');return {ok:false,reason};};
    if(command==='obstruction'||command==='traffic'){
      const key=command==='obstruction'?'blocked':'traffic';s[key]=!s[key];
      log(s,null,command.toUpperCase(),s[key]?'Hazard active. New reservations inhibited.':'Hazard cleared. A fresh request is required.');
      if(s[key])for(const b of s.aircraft)invalidate(s,b,'revoked','Reservation revoked: '+(s.blocked?'pad obstruction':'conflicting traffic')+'. If airborne, use the aircraft contingency procedure.');
      return {ok:true};
    }
    if(a.mode==='unconnected')return reject('Detection is not a communication channel. Track only; operator coordination required.');
    if(command==='connect'){
      if(a.connected)return reject('Already connected.');a.connected=true;a.capabilities=false;a.verified=false;a.operationReview=false;a.phase=s.occupant===a.id?'landed':'connected';
      log(s,a,'SESSION',a.mode==='visitor'?'Guest operator channel established (simulated). Identity and capability review required.':'Onboard adapter session established (simulated). Exchange capabilities.');return {ok:true};
    }
    if(command==='disconnect'){
      if(!a.connected)return reject('No active link.');a.connected=false;
      invalidate(s,a,'revoked','Link lost. Reservation invalidated; acceptance cannot be assumed.');
      a.phase=s.occupant===a.id?'landed':'offline';a.capabilities=false;a.verified=false;a.operationReview=false;
      s.messages.filter(m=>m.aircraft===id&&m.status==='sent').forEach(m=>m.status='failed');
      log(s,a,'LINK_LOST','Reconnect and repeat capability checks. Physical pad occupancy is retained.','failed');return {ok:true};
    }
    if(!a.connected)return reject('Establish a supported two-way connection first.');
    if(command==='capabilities'){a.capabilities=true;if(a.mode==='equipped')a.verified=true;log(s,a,'CAPABILITIES',a.type+' profile exchanged. Demo dimensions and interface support accepted.');return {ok:true};}
    if(command==='verify'){if(a.mode!=='visitor'||!a.capabilities)return reject('Exchange visitor capabilities before operator review.');a.verified=true;log(s,a,'VISITOR_REVIEW','Operator confirmed the demo identity and supported response channel.');return {ok:true};}
    if(!a.capabilities||!a.verified)return reject('Complete capability exchange and visitor review before operations.');
    if(command==='review'){a.operationReview=true;log(s,a,'OPERATION_REVIEW','Operator recorded demo responsibility, applicable authorization and flight-readiness review. Self-attestation only; no FAA verification.');return {ok:true};}
    if(!a.operationReview)return reject('Record the operator operation review first.');
    if(command==='requestLanding'||command==='requestDeparture'){
      const operation=command==='requestLanding'?'landing':'departure';
      if(a.reservation)return reject('An active reservation already exists.');
      if(operation==='landing'&&!['connected','holding'].includes(a.phase))return reject('Landing request unavailable in this phase.');
      if(operation==='departure'&&(s.occupant!==id||!['landed','servicing'].includes(a.phase)))return reject('Departure requires confirmed pad occupancy.');
      a.operation=operation;a.phase='requestSent';log(s,a,'REQUEST',operation+' requested. Awaiting delivery to GN-01.','sent','aircraft → node',{deliverAt:s.now+.8,operation});return {ok:true};
    }
    if(command==='offer'){
      if(a.phase!=='requested')return reject('Wait for the request to be received.');
      if(!available(s,a)){a.phase=s.occupant===id?'landed':'holding';log(s,a,'HOLD','Hold: '+(s.blocked?'pad obstruction':s.traffic?'conflicting traffic':'pad occupied or reserved')+'. Submit a fresh request when available.','received','node → aircraft');return {ok:true};}
      const r={id:'R-'+(++s.nextReservation),operation:a.operation,status:'sent',expires:s.now+30};a.reservation=r;a.phase='offered';
      log(s,a,'OFFER',a.operation+' reservation '+r.id+' offered. Acceptance required within 30 seconds.','sent','node → aircraft',{deliverAt:s.now+.8,reservation:r.id});return {ok:true};
    }
    if(command==='accept'||command==='unable'){
      const r=a.reservation;if(!r||r.status!=='received')return reject('No delivered reservation is awaiting a response.');
      if(r.expires<=s.now){invalidate(s,a,'expired','Acceptance deadline elapsed.');return reject('Reservation expired.');}
      if(command==='unable'){invalidate(s,a,'rejected','Aircraft/operator declined the proposed reservation. Reservation released.');return {ok:true};}
      if(!available(s,a)){invalidate(s,a,'revoked','Conditions changed before acceptance.');return reject('Reservation is no longer available.');}
      r.status='accepted';r.expires=s.now+90;a.phase=r.operation==='landing'?'authorized':'departureAuthorized';
      const m=s.messages.find(m=>m.reservation===r.id);if(m)m.status='accepted';
      log(s,a,'ACCEPTED','Aircraft/operator accepted '+r.id+'. Valid for 90 seconds; subject to pad status.','accepted','aircraft → node',{reservation:r.id});return {ok:true};
    }
    if(command==='approach'){
      if(a.phase!=='authorized'||!a.reservation)return reject('An accepted landing reservation is required.');a.phase='approaching';log(s,a,'APPROACH','Aircraft reports approach in progress.','received','aircraft → node');return {ok:true};
    }
    if(command==='touchdown'){
      if(a.phase!=='approaching'||!a.reservation||!available(s,a))return reject('No valid coordinated approach.');s.occupant=id;a.phase='landed';a.reservation=null;log(s,a,'TOUCHDOWN','Touchdown confirmed by simulated report. Pad occupied; propulsion-safe confirmation required.','received','aircraft → node');return {ok:true};
    }
    if(command==='service'){
      if(a.phase!=='landed'||s.occupant!==id||s.blocked)return reject('Confirm touchdown and clear pad obstruction first.');a.phase='servicing';log(s,a,'SERVICE','Propulsion-safe confirmation received. Simulated service enabled.','received','aircraft → node');return {ok:true};
    }
    if(command==='departed'){
      if(a.phase!=='departureAuthorized'||!a.reservation||!available(s,a))return reject('An accepted departure reservation is required.');s.occupant=null;a.reservation=null;a.phase='connected';log(s,a,'DEPARTED','Departure reported complete. Pad released.','received','aircraft → node');return {ok:true};
    }
    return reject('Unsupported command.');
  }
  function advance(s,seconds){
    if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid elapsed time');s.now+=seconds;
    for(const m of s.messages){if(m.status!=='sent'||m.deliverAt>s.now)continue;const a=find(s,m.aircraft);if(!a?.connected){m.status='failed';continue;}m.status='received';
      if(m.type==='REQUEST'&&a.phase==='requestSent')a.phase='requested';
      if(m.type==='OFFER'&&a.reservation?.id===m.reservation)a.reservation.status='received';
    }
    for(const a of s.aircraft)if(a.reservation&&a.reservation.expires<=s.now)invalidate(s,a,'expired','Reservation expired. Reassess and submit a fresh request.');
    return s;
  }
  g.GroundNodeCoordination={create,dispatch,advance,available};
})(typeof window==='undefined'?globalThis:window);

