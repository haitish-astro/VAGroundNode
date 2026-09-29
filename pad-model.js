import * as THREE from 'three';
// Shared product geometry for the city simulation and the standalone concept viewer.
export function createSmartPad(name='GN-01 / CONCEPT') {
  const group=new THREE.Group(), systems=Array.from({length:5},(_,i)=>{const g=new THREE.Group();g.userData.system=i;group.add(g);return g;});
  const mat=(color,metalness=.3)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.48});
  const slate=mat('#253e4e'), surface=mat('#77949e'), white=mat('#e1eceb'), orange=mat('#ec793b'), glass=mat('#143b50',.65);
  const light=new THREE.MeshStandardMaterial({color:'#70e4c4',emissive:'#70e4c4',emissiveIntensity:.8});
  function mesh(p,geo,m,x=0,y=0,z=0){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;}
  const box=(p,w,h,d,m,x,y,z)=>mesh(p,new THREE.BoxGeometry(w,h,d),m,x,y,z);
  const ringAt=(p,r,t,m,x,y,z)=>{const o=mesh(p,new THREE.TorusGeometry(r,t,8,80),m,x,y,z);o.rotation.x=Math.PI/2;return o;};
  const [comms,sensors,guidance,power,deck]=systems;
  mesh(deck,new THREE.CylinderGeometry(12,12.4,1,80),slate,0,.5,0);
  mesh(deck,new THREE.CylinderGeometry(11.65,11.65,.12,80),surface,0,1.06,0);
  for(let i=0;i<16;i++){const a=i*Math.PI/8;const seam=box(deck,.025,.015,2.1,slate,Math.sin(a)*10.5,1.13,Math.cos(a)*10.5);seam.rotation.y=a;box(deck,.35,.08,.35,slate,Math.sin(a)*11.8,1.06,Math.cos(a)*11.8);}
  for(let i=0;i<12;i++){const a=i*Math.PI/6;const vent=box(deck,1.6,.18,.08,glass,Math.sin(a)*12.1,.45,Math.cos(a)*12.1);vent.rotation.y=a;}
  const ring=ringAt(guidance,10.6,.09,light,0,1.17,0);
  for(let i=0;i<24;i++){const a=i*Math.PI/12;mesh(guidance,new THREE.SphereGeometry(.12,8,6),light,Math.sin(a)*11.7,1.17,Math.cos(a)*11.7);}
  const bays=new THREE.Group();guidance.add(bays);
  for(const [x,z] of [[-6.5,0],[0,-2],[6.5,0]]){ringAt(bays,2.8,.035,white,x,1.15,z);for(const dx of [-.65,.65])box(bays,.16,.02,1.5,white,x+dx,1.15,z);box(bays,1.3,.02,.16,white,x,1.15,z);}
  const centerMark=new THREE.Group();guidance.add(centerMark);
  for(const x of [-1.7,1.7])box(centerMark,.55,.025,4.8,white,x,1.17,1);
  box(centerMark,3.4,.025,.55,white,0,1.17,1);
  for(const x of [-9,9]){box(sensors,1.2,.38,.8,slate,x,1.32,7);mesh(sensors,new THREE.SphereGeometry(.24,16,10),glass,x,1.44,6.6);mesh(sensors,new THREE.SphereGeometry(.08,8,6),light,x+.38,1.45,6.59);}
  box(power,2.2,3.6,2.2,orange,13.8,1.8,0);box(power,2.6,.15,2.6,slate,13.8,3.7,0);
  box(power,1.55,1.05,.06,slate,13.8,2.6,1.13);box(power,1.1,.12,.07,light,13.8,2.65,1.17);
  for(let i=0;i<6;i++)box(power,1.5,.06,.07,slate,13.8,.7+i*.16,1.14);
  box(power,.09,.6,.08,white,14.66,1.8,1.14);
  mesh(power,new THREE.CylinderGeometry(.18,.18,.1,16),slate,12.65,1.3,0).rotation.z=Math.PI/2;
  // Equipment and conduits remain outside the touchdown footprint.
  box(power,1.5,.12,.35,slate,12.9,.15,-1.6);
  mesh(comms,new THREE.CylinderGeometry(.12,.18,5,12),white,13.8,6.2,0);
  box(comms,.7,1.3,.5,white,13.8,6.7,0);box(comms,3,.12,.18,slate,13.8,7.8,0);
  for(const x of [12.5,15.1])mesh(comms,new THREE.CylinderGeometry(.06,.06,1,10),white,x,8.3,0);
  mesh(comms,new THREE.SphereGeometry(.19,12,8),light,13.8,8.8,0);
  const label=document.createElement('canvas');label.width=512;label.height=128;const ctx=label.getContext('2d');ctx.fillStyle='#193340';ctx.fillRect(0,0,512,128);ctx.fillStyle='#ffae79';ctx.textAlign='center';ctx.font='bold 45px system-ui';ctx.fillText('GROUNDNODE',256,57);ctx.fillStyle='#dbe9ec';ctx.font='22px system-ui';ctx.fillText(name.toUpperCase(),256,100);
  const badge=mesh(deck,new THREE.PlaneGeometry(6,1.5),new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(label),roughness:.6}),0,1.145,7.8);badge.rotation.x=-Math.PI/2;
  return {group,systems,ring,guidance:bays,centerMark};
}

