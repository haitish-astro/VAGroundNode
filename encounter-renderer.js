import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createSmartPad} from './pad-model.js';
import {createAircraft,createSkyEnvironment} from './aircraft-model.js';
export function createEncounterRenderer(canvas){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const scene=new THREE.Scene();scene.fog=new THREE.Fog('#c3d5de',160,420);const sky=createSkyEnvironment(renderer);scene.environment=sky.envMap;scene.add(sky.dome);
 const camera=new THREE.PerspectiveCamera(45,1,.1,1500);scene.add(camera);const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.47;controls.minDistance=20;controls.maxDistance=180;
 scene.add(new THREE.HemisphereLight('#e7f5ff','#56706b',2.8));const sun=new THREE.DirectionalLight('#fff0d7',3);sun.position.set(-40,90,25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:210});sun.shadow.bias=-.0005;scene.add(sun);
 const material=color=>new THREE.MeshStandardMaterial({color,roughness:.7});
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(800,800),material('#697f7f'));ground.rotation.x=-Math.PI/2;ground.position.y=-.06;ground.receiveShadow=true;scene.add(ground);
 const apron=new THREE.Mesh(new THREE.CircleGeometry(30,80),material('#3f555e'));apron.rotation.x=-Math.PI/2;apron.position.y=.01;apron.receiveShadow=true;scene.add(apron);
 const grid=new THREE.GridHelper(220,22,'#536c75','#627a7d');grid.position.y=.02;scene.add(grid);
 const pad=createSmartPad('GN-01 / VH-101');pad.guidance.visible=false;scene.add(pad.group);const craft=createAircraft('UAM');scene.add(craft);
 const debris=new THREE.Mesh(new THREE.BoxGeometry(1.4,.7,1.1),material('#d67546'));debris.position.set(4,1.5,1.5);debris.rotation.y=.4;debris.castShadow=true;scene.add(debris);
 const routeGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-38,31.2,-48),new THREE.Vector3(0,31.2,0),new THREE.Vector3(0,1.2,0)]);const route=new THREE.Line(routeGeo,new THREE.LineDashedMaterial({color:'#c2e4ee',dashSize:2,gapSize:2,transparent:true,opacity:.35}));route.computeLineDistances();scene.add(route);
 const screenCanvas=document.createElement('canvas');screenCanvas.width=1024;screenCanvas.height=512;const ctx=screenCanvas.getContext('2d'),texture=new THREE.CanvasTexture(screenCanvas);
 const dashboard=new THREE.Group();camera.add(dashboard);
 const panel=new THREE.Mesh(new THREE.BoxGeometry(4.8,1.25,.4),material('#0e1b28'));panel.position.set(0,-.8,-3.4);dashboard.add(panel);
 const display=new THREE.Mesh(new THREE.PlaneGeometry(2.7,.95),new THREE.MeshBasicMaterial({map:texture}));display.position.set(0,-.65,-3.18);dashboard.add(display);
 for(const x of [-2.3,2.3]){const pillar=new THREE.Mesh(new THREE.BoxGeometry(.1,4,.15),material('#223444'));pillar.position.set(x,.2,-3.5);pillar.rotation.z=x>0?-.15:.15;dashboard.add(pillar);}
 let mode='overview',rpm=0,lastTexture=-1,lastHeading=0;
 function overview(){camera.position.set(65,48,68);controls.target.set(-9,10,-13);controls.update();}
 overview();function setCamera(value){mode=value;controls.enabled=mode==='overview';dashboard.visible=mode==='cockpit';if(mode==='overview')overview();}
 setCamera('overview');const resize=new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;dashboard.scale.x=Math.min(1,camera.aspect*.82);camera.updateProjectionMatrix();});resize.observe(canvas);
 function draw(s,dt,readout){
  const a=s.link.aircraft[0];craft.position.set(s.pos.x,s.pos.y+1.2,s.pos.z);debris.visible=s.link.blocked;
  const color=s.link.blocked?'#f0a25f':a.reservation?'#76d8f0':'#75e0be';pad.ring.material.color.set(color);pad.ring.material.emissive.set(color);
  route.visible=!!a.reservation&&a.reservation.operation==='landing';craft.visible=mode!=='cockpit';
  const speed=Math.hypot(s.vel.x,s.vel.z);if(speed>.1){const desired=Math.atan2(-s.vel.x,-s.vel.z),diff=Math.atan2(Math.sin(desired-lastHeading),Math.cos(desired-lastHeading));lastHeading+=diff*(1-Math.exp(-dt*2));}craft.rotation.y=lastHeading;
  craft.rotation.x+=(Math.min(.08,speed*.007)-craft.rotation.x)*(1-Math.exp(-dt*3));
  const flying=s.pos.y>.1||s.engaged;rpm+=((flying?1:0)-rpm)*(1-Math.exp(-dt*2));craft.userData.animate(dt,rpm,{time:s.link.now,flying});
  if(mode==='follow'){const p=craft.position.clone();controls.target.lerp(p,1-Math.exp(-dt*3));camera.position.lerp(p.clone().add(new THREE.Vector3(23,14,27)),1-Math.exp(-dt*2));camera.lookAt(controls.target);}
  else if(mode==='cockpit'){camera.position.copy(craft.position).add(new THREE.Vector3(0,3.2,-1));camera.lookAt(s.pos.y>2?new THREE.Vector3(0,5,10):new THREE.Vector3(0,5,-50));}
  else controls.update();
  if(lastTexture!==s.link.seq||Math.floor(s.link.now)!==Math.floor(lastTextureTime)){lastTexture=s.link.seq;lastTextureTime=s.link.now;ctx.fillStyle='#071b29';ctx.fillRect(0,0,1024,512);ctx.fillStyle='#89d6e0';ctx.font='24px system-ui';ctx.fillText('VAHNIM LINK   /   VH-101 ↔ GN-01',40,50);ctx.fillStyle='#ebf5f8';ctx.font='bold 38px system-ui';ctx.fillText(readout.title,40,117);ctx.font='25px system-ui';ctx.fillStyle='#b5cfdb';let y=166,line='';for(const word of readout.text.split(' ')){if(ctx.measureText(line+word).width>930){ctx.fillText(line,40,y);y+=36;line='';}line+=word+' ';}ctx.fillText(line,40,y);ctx.fillStyle='#7ed8c2';ctx.font='23px system-ui';ctx.fillText(readout.status.toUpperCase(),40,350);ctx.fillStyle='#91abba';ctx.fillText('ALT '+s.pos.y.toFixed(1)+' m  |  '+(s.link.blocked?'PAD OBSTRUCTED':'PAD CLEAR'),40,410);ctx.fillText('Simulation · pilot responses on adjacent display',40,465);texture.needsUpdate=true;}
  renderer.render(scene,camera);
 }
 let lastTextureTime=-1;return {draw,setCamera};
}

