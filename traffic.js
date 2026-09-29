// Predictive right-of-way plus a swept-volume safety interlock.
(function(g) {
  const airborne = d => !['idle','charging','swapping','uploading','redeploying','awaitingDeparture'].includes(d.state);
  const radius = d => d.aircraftType === 'UAM' ? 100 : 26;
  const halfHeight = d => d.aircraftType === 'UAM' ? 25 : 12;
  function separation(a,b) {return {h:radius(a)+radius(b)+8,v:halfHeight(a)+halfHeight(b)+8};}
  function closest(p,v,horizon) {
    const vv=v.x*v.x+v.y*v.y+v.z*v.z;
    const t=vv>1e-9 ? Math.max(0,Math.min(horizon,-(p.x*v.x+p.y*v.y+p.z*v.z)/vv)) : 0;
    return Math.hypot(p.x+t*v.x,p.y+t*v.y,p.z+t*v.z);
  }
  function plan(state,log) {
    state.metrics.conflictResolutions ??= 0; state.metrics.safetyStops ??= 0;
    for(let i=0;i<state.drones.length;i++) for(let j=i+1;j<state.drones.length;j++) {
      const a=state.drones[i],b=state.drones[j];
      if(!airborne(a)&&!airborne(b)) continue;
      const s=separation(a,b);
      const p={x:(a.pos.x-b.pos.x)/(s.h+40),y:(a.pos.y-b.pos.y)/(s.h+40),z:(a.altitude-b.altitude)/(s.v+20)};
      const v={x:(a.velocity.x-b.velocity.x)/(s.h+40),y:(a.velocity.y-b.velocity.y)/(s.h+40),z:(a.verticalSpeed-b.verticalSpeed)/(s.v+20)};
      if(closest(p,v,5)>=1) continue;
      // Landing aircraft have priority. An airborne en-route aircraft yields.
      const eligible = d=>airborne(d)&&!['takeoff','docking'].includes(d.state);
      const yieldDrone=eligible(b)?b:eligible(a)?a:null;
      if(!yieldDrone || yieldDrone.avoidUntil>state.tick) continue;
      const other=yieldDrone===a?b:a;
      yieldDrone.avoidPoint={...yieldDrone.pos};
      yieldDrone.avoidAltitude=Math.max(yieldDrone.altitude,other.altitude)+180;
      yieldDrone.trafficFloor=yieldDrone.avoidAltitude;
      yieldDrone.avoidUntil=state.tick+180;
      state.metrics.conflictResolutions++;
      log(state,{stationName:'Traffic coordination',callsign:yieldDrone.callsign,direction:'toDrone',channel:'safety',text:`${yieldDrone.callsign} yield to ${other.callsign}: brake and climb to ${(yieldDrone.avoidAltitude/10).toFixed(0)} m. Separation advisory.`});
    }
  }
  function guard(state,previous) {
    // Repeat when stopping one craft changes another pair's swept path.
    for(let pass=0;pass<state.drones.length;pass++) {
      let changed=false;
      for(let i=0;i<state.drones.length;i++) for(let j=i+1;j<state.drones.length;j++) {
        const a=state.drones[i],b=state.drones[j];
        if(!airborne(a)&&!airborne(b)) continue;
        const pa=previous.get(a.id),pb=previous.get(b.id),s=separation(a,b);
        const p={x:(pa.x-pb.x)/s.h,y:(pa.y-pb.y)/s.h,z:(pa.z-pb.z)/s.v};
        const v={x:((a.pos.x-pa.x)-(b.pos.x-pb.x))/s.h,y:((a.pos.y-pa.y)-(b.pos.y-pb.y))/s.h,z:((a.altitude-pa.z)-(b.altitude-pb.z))/s.v};
        if(closest(p,v,1)>=1 || Math.hypot(p.x,p.y,p.z)<.9999) continue;
        for(const d of [a,b]) {
          const old=previous.get(d.id);
          const sign=d===a?1:-1;
          const closing=sign*(p.x*(d.pos.x-old.x)/s.h+p.y*(d.pos.y-old.y)/s.h+p.z*(d.altitude-old.z)/s.v);
          if(closing>=0) continue; // Allow the yielding aircraft to move away.
          if(d.pos.x!==old.x||d.pos.y!==old.y||d.altitude!==old.z) {
            d.pos={x:old.x,y:old.y};d.altitude=old.z;d.velocity={x:0,y:0};d.verticalSpeed=0;d.acceleration={x:0,y:0}; changed=true;
            state.metrics.safetyStops++;
          }
        }
      }
      if(!changed) break;
    }
  }
  g.VahnimTraffic={plan,guard,separation,closest};
})(typeof window!=='undefined'?window:globalThis);

