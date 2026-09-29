// One aircraft, one pad: automatic ground coordination + illustrative flight dynamics.
(function(g){
 const P=g.GroundNodeCoordination,id='VH-101';
 function event(s,type,text){s.link.messages.push({id:++s.link.seq,at:s.link.now,aircraft:id,type,text,status:'received',direction:'system'});s.link.messages=s.link.messages.slice(-120);}
 function create(){const link=P.create();link.aircraft=link.aircraft.filter(a=>a.id===id);const s={link,pos:{x:-38,y:30,z:-48},vel:{x:0,y:0,z:0},engaged:false,stage:'hold',intent:null,assessAt:0,landedAt:null,launchAt:0,complete:false};
  for(const c of ['connect','capabilities','review'])P.dispatch(link,id,c);
  link.messages.at(-1).text='Scenario preflight review preset for demonstration only. No real identity or operating authorization verified.';
  link.blocked=true;event(s,'PAD_INSPECTION','Synthetic pad inspection: obstruction present. GroundNode will hold landing requests.');return s;}
 const aircraft=s=>s.link.aircraft[0];
 function command(s,c){const a=aircraft(s);let result;
  if(c==='fly'){
   if(a.phase==='authorized'&&a.reservation){s.engaged=true;s.stage='align';event(s,'FLIGHT_MODE','Pilot engaged simulated approach guidance. Acceptance alone does not move the aircraft.');return {ok:true};}
   if(a.phase==='departureAuthorized'&&a.reservation){s.engaged=true;s.stage='launch';s.launchAt=s.link.now+2;event(s,'FLIGHT_MODE','Pilot engaged simulated departure. Rotor spool-up in progress.');return {ok:true};}
   return {ok:false,reason:'Accept a valid reservation first.'};
  }
  if(c==='reconnect'){for(const x of ['connect','capabilities','review']){result=P.dispatch(s.link,id,x);if(!result.ok)return result;}event(s,'SCENARIO_REVIEW','Demo reconnect checks completed. Pilot must request a new reservation.');return {ok:true};}
  result=P.dispatch(s.link,id,c);
  if(result.ok&&s.link.messages.at(-1)?.text==='Hazard cleared. A fresh request is required.')s.link.messages.at(-1).text='Hazard cleared. GroundNode will reassess any open request; a new reservation still requires acceptance.';
  if(result.ok){if(c==='requestLanding'){s.intent='landing';s.complete=false;}if(c==='requestDeparture')s.intent='departure';if(['unable','disconnect'].includes(c))s.intent=null;}
  return result;
 }
 function velocityStep(s,key,target,limit,accel,dt){const err=target-s.pos[key],desired=Math.sign(err)*Math.min(limit,Math.sqrt(2*accel*Math.abs(err)),Math.abs(err)*.9);s.vel[key]+=Math.max(-accel*dt,Math.min(accel*dt,desired-s.vel[key]));s.pos[key]+=s.vel[key]*dt;}
 function step(s,dt){
  P.advance(s.link,dt);const a=aircraft(s),last=s.link.messages.at(-1);
  if(last?.type==='EXPIRED')s.intent=null;
  if(a.phase==='requested'){
   if(!s.assessAt)s.assessAt=s.link.now+1;
   if(s.link.now>=s.assessAt){P.dispatch(s.link,id,'offer');s.assessAt=0;if(a.phase==='holding'||(a.phase==='landed'&&s.intent==='departure')){s.link.messages.at(-1).text='Hold: pad or approach unavailable. GroundNode is monitoring the open request and will reassess when conditions permit.';event(s,'MONITOR','GroundNode is monitoring this request. Reassessment will follow when pad conditions permit.');}}
  }else s.assessAt=0;
  if(s.intent&&a.connected&&!a.reservation&&P.available(s.link,a)&&['holding','landed','servicing'].includes(a.phase)){
   const r=P.dispatch(s.link,id,s.intent==='landing'?'requestLanding':'requestDeparture');if(r.ok)event(s,'REASSESS','GroundNode requeued the open request after conditions changed.');
  }
  const valid=a.reservation?.status==='accepted';
  if(s.engaged&&!valid){s.engaged=false;s.stage=s.link.occupant===id?'landed':'recover';}
  if(a.phase==='authorized'&&s.engaged)P.dispatch(s.link,id,'approach');
  let target={...s.pos};
  if(s.engaged&&a.phase==='approaching'){
   if(s.stage==='align'){target={x:0,y:30,z:0};if(Math.hypot(s.pos.x,s.pos.z)<.12&&Math.hypot(s.vel.x,s.vel.z)<.15&&Math.abs(s.pos.y-30)<.12&&Math.abs(s.vel.y)<.15)s.stage='descend';}
   if(s.stage==='descend')target={x:0,y:0,z:0};
  }else if(s.engaged&&a.phase==='departureAuthorized'){
   if(s.link.now<s.launchAt)target={x:0,y:0,z:0};else{target={x:0,y:30,z:0};if(s.pos.y>29.5)s.stage='outbound';if(s.stage==='outbound')target={x:42,y:30,z:-55};}
  }else if(s.link.occupant===id){target={x:0,y:0,z:0};}
  else{target=s.pos.y<29.5?{x:s.pos.x,y:30,z:s.pos.z}:{x:-38,y:30,z:-48};}
  for(const k of ['x','z'])velocityStep(s,k,target[k],7,1.8,dt);
  velocityStep(s,'y',target.y,target.y<s.pos.y?(s.pos.y<2?.45:2.2):3,1.2,dt);
  s.pos.y=Math.max(0,s.pos.y);
  if(s.engaged&&a.phase==='approaching'&&s.stage==='descend'&&Math.hypot(s.pos.x,s.pos.z)<.08&&s.pos.y<.025&&Math.abs(s.vel.y)<.06){
   if(P.dispatch(s.link,id,'touchdown').ok){s.pos={x:0,y:0,z:0};s.vel={x:0,y:0,z:0};s.engaged=false;s.stage='landed';s.intent=null;s.landedAt=s.link.now;}
  }
  if(a.phase==='landed'&&s.landedAt!==null&&s.link.now-s.landedAt>3&&!s.link.blocked){P.dispatch(s.link,id,'service');s.landedAt=null;}
  if(s.engaged&&a.phase==='departureAuthorized'&&s.stage==='outbound'&&Math.hypot(s.pos.x-42,s.pos.z+55)<.2){if(P.dispatch(s.link,id,'departed').ok){s.intent=null;s.engaged=false;s.complete=true;s.stage='complete';}}
  if(s.complete){s.vel={x:0,y:0,z:0};}
 }
 function advance(s,dt){if(!Number.isFinite(dt)||dt<0)throw Error('Invalid elapsed time');while(dt>1e-8){const chunk=Math.min(dt,1/60);if(!s.complete)step(s,chunk);else P.advance(s.link,chunk);dt-=chunk;}return s;}
 g.GroundNodeEncounter={create,command,advance,aircraft};
})(typeof window==='undefined'?globalThis:window);


