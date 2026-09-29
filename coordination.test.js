const assert=require('node:assert/strict');require('./coordination.js');const P=GroundNodeCoordination;
function setup(id='VH-101'){const s=P.create();P.dispatch(s,id,'connect');P.dispatch(s,id,'capabilities');if(id==='VIS-204')P.dispatch(s,id,'verify');P.dispatch(s,id,'review');return s;}
function request(s,id,op='Landing'){assert(P.dispatch(s,id,'request'+op).ok);P.advance(s,1);assert(P.dispatch(s,id,'offer').ok);}
function accept(s,id){P.advance(s,1);assert(P.dispatch(s,id,'accept').ok);}
let s=setup();assert(!P.dispatch(s,'VH-101','touchdown').ok);request(s,'VH-101');assert(!P.dispatch(s,'VH-101','accept').ok,'Cannot accept before delivery');accept(s,'VH-101');
assert(P.dispatch(s,'VH-101','approach').ok);assert(P.dispatch(s,'VH-101','touchdown').ok);assert.equal(s.occupant,'VH-101');assert(P.dispatch(s,'VH-101','service').ok);
request(s,'VH-101','Departure');accept(s,'VH-101');assert(P.dispatch(s,'VH-101','departed').ok);assert.equal(s.occupant,null);
s=setup('VIS-204');request(s,'VIS-204');accept(s,'VIS-204');assert.equal(s.aircraft[1].phase,'authorized');
s=P.create();P.dispatch(s,'VIS-204','connect');P.dispatch(s,'VIS-204','capabilities');assert(!P.dispatch(s,'VIS-204','requestLanding').ok,'Visitor must be reviewed');assert(!P.dispatch(s,'TRACK-03','connect').ok);
for(const hazard of ['obstruction','traffic','disconnect']){s=setup();request(s,'VH-101');accept(s,'VH-101');P.dispatch(s,'VH-101',hazard);assert.equal(s.aircraft[0].reservation,null);assert(!P.dispatch(s,'VH-101','approach').ok);}
s=setup();request(s,'VH-101');P.advance(s,31);assert.equal(s.aircraft[0].reservation,null);assert(!P.dispatch(s,'VH-101','accept').ok);
s=setup();request(s,'VH-101');accept(s,'VH-101');P.advance(s,91);assert.equal(s.aircraft[0].reservation,null);
s=setup();request(s,'VH-101');P.advance(s,1);P.dispatch(s,'VH-101','unable');assert.equal(s.aircraft[0].reservation,null);
s=setup();request(s,'VH-101');for(const c of ['connect','capabilities','verify','review'])P.dispatch(s,'VIS-204',c);request(s,'VIS-204');assert.equal(s.aircraft[1].phase,'holding');assert.equal(s.aircraft[1].reservation,null);
s=setup();P.dispatch(s,'VH-101','requestLanding');P.dispatch(s,'VH-101','disconnect');P.advance(s,2);assert.equal(s.aircraft[0].phase,'offline');assert(s.messages.some(m=>m.type==='REQUEST'&&m.status==='failed'));
s=setup();request(s,'VH-101');accept(s,'VH-101');P.dispatch(s,'VH-101','approach');P.dispatch(s,'VH-101','touchdown');P.dispatch(s,'VH-101','disconnect');assert.equal(s.occupant,'VH-101','Link loss must not erase physical occupancy');
for(let i=0;i<140;i++)P.dispatch(s,'TRACK-03','connect');assert.equal(s.messages.length,120);
console.log('PASS: equipped/visitor cycles, delivery before acceptance, unknown tracks, conflicts, expiry, link loss, occupancy and audit bounds.');

s=P.create();P.dispatch(s,'VH-101','connect');P.dispatch(s,'VH-101','capabilities');assert(!P.dispatch(s,'VH-101','requestLanding').ok,'Operator review is required');

