// GroundNode concept protocol. Local demonstration only; not a flight-control API.
(function (g) {
  function create() { return { phase:'offline', blocked:false, seq:0, log:[] }; }
  function send(s, command) {
    let type='REJECT', detail='Command is not valid in the current state.';
    if(command==='reset') { Object.assign(s,create()); return s; }
    if(command==='obstacle') {
      s.blocked=!s.blocked;
      if(s.blocked && s.phase==='cleared') s.phase='holding';
      type=s.blocked?'PAD_BLOCKED':'PAD_CLEAR'; detail=s.blocked?'Clearance revoked. Hold position; landing unavailable.':'Landing area clear. Request a fresh clearance.';
    } else if(command==='disconnect' && s.phase!=='offline') {
      s.phase='offline'; type='LINK_LOST'; detail='Session and clearance invalidated. Aircraft must use its own lost-link contingency.';
    } else if(command==='discover' && s.phase==='offline') {
      s.phase='discovered'; type='NODE_ADVERTISEMENT'; detail='GN-01 · UAM exclusive / 3 UAV bays · protocol concept v0.1';
    } else if(command==='register' && s.phase==='discovered') {
      s.phase='registered'; type='SESSION_ACCEPTED'; detail='DEMO-01 capability exchange accepted. Identity verification is a proposed future adapter.';
    } else if(command==='request' && ['registered','holding'].includes(s.phase)) {
      s.phase=s.blocked?'holding':'cleared';type=s.blocked?'HOLD':'LANDING_CLEARANCE';detail=s.blocked?'Pad obstruction. Hold and request again when clear.':'Demo bay reserved for DEMO-01. Approach permitted in this sandbox.';
    } else if(command==='touchdown' && s.phase==='cleared' && !s.blocked) {
      s.phase='landed';type='TOUCHDOWN_ACK';detail='Touchdown reported. Propulsion-safe confirmation required before service.';
    } else if(command==='service' && s.phase==='landed') {
      s.phase='servicing';type='SERVICE_READY';detail='Simulated propulsion-safe confirmation received. Service handoff enabled.';
    }
    s.log.push({sequence:++s.seq, aircraft:'DEMO-01', node:'GN-01', command, type, detail, phase:s.phase});
    s.log=s.log.slice(-60);return s;
  }
  g.GroundNodeProtocol={create,send};
})(typeof window==='undefined'?globalThis:window);
