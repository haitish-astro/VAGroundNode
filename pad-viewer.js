const host=document.getElementById('padViewer'),status=document.getElementById('viewStatus');
document.querySelectorAll('.viewer-controls button,.viewer-controls select').forEach(el=>el.disabled=true);
try {
  const THREE=await import('three');
  const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
  const {createSmartPad}=await import('./pad-model.js');
  const canvas=document.getElementById('padCanvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#142430');
  const camera=new THREE.PerspectiveCamera(38,1,.1,180),controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;controls.minDistance=14;controls.maxDistance=70;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.7;
  const pad=createSmartPad();scene.add(pad.group);pad.guidance.visible=false;
  scene.add(new THREE.HemisphereLight('#e3f4ff','#23313a',2.7));
  const sun=new THREE.DirectionalLight('#ffe9d3',3);sun.position.set(-15,30,20);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:80});sun.shadow.bias=-.001;scene.add(sun);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({color:'#142430',roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.05;floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(70,35,'#325165','#243f50');scene.add(grid);
  // Each system owns its highlight materials; selection never recolors another group.
  pad.systems.forEach(g=>{const materials=new Map();g.traverse(o=>{if(!o.isMesh)return;if(!materials.has(o.material)){const m=o.material.clone();m.userData.baseEmissive=m.emissive.clone();m.userData.baseIntensity=m.emissiveIntensity;materials.set(o.material,m);}o.material=materials.get(o.material);});});
  let selected=0,exploded=false;
  const names=['Communications mast','Landing-area sensors','Guidance & lights','Power & service cabinet','Landing deck'];
  function select(index){selected=index;pad.systems.forEach((g,i)=>g.traverse(o=>{if(!o.isMesh)return;const m=o.material;if(i===index){m.emissive.set('#d47832');m.emissiveIntensity=.24;}else{m.emissive.copy(m.userData.baseEmissive);m.emissiveIntensity=m.userData.baseIntensity;}}));status.textContent=`0${index+1} / ${names[index]} selected`;}
  function home(){camera.position.set(31,25,36);controls.target.set(2,2,0);controls.update();}
  home();select(Number(document.querySelector('[data-system][aria-pressed=true]')?.dataset.system)||0);
  document.getElementById('homeView').onclick=()=>{controls.autoRotate=false;document.getElementById('rotateView').setAttribute('aria-pressed','false');home();};
  document.getElementById('topView').onclick=()=>{controls.autoRotate=false;document.getElementById('rotateView').setAttribute('aria-pressed','false');camera.position.set(2,48,.1);controls.target.set(2,0,0);controls.update();};
  document.getElementById('explodeView').onclick=e=>{exploded=!exploded;e.currentTarget.setAttribute('aria-pressed',String(exploded));e.currentTarget.textContent=exploded?'Assemble model':'Exploded view';};
  document.getElementById('rotateView').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.currentTarget.setAttribute('aria-pressed',String(controls.autoRotate));};
  document.getElementById('padLayout').onchange=e=>{pad.guidance.visible=e.target.value==='uav';pad.centerMark.visible=!pad.guidance.visible;};
  window.addEventListener('pad-system-selected',e=>select(e.detail));
  const ray=new THREE.Raycaster();let start=null;
  canvas.addEventListener('pointerdown',e=>start={x:e.clientX,y:e.clientY});
  canvas.addEventListener('click',e=>{if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(pad.systems,true).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}return true;});if(!hit)return;let o=hit.object;while(o&&o.userData.system===undefined)o=o.parent;if(o)window.dispatchEvent(new CustomEvent('pad-system-picked',{detail:o.userData.system}));});
  const resize=new ResizeObserver(()=>{const r=host.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();});resize.observe(host);
  const heights=[4,3,1.8,1,0];let visible=true,last=performance.now();
  new IntersectionObserver(entries=>visible=entries[0].isIntersecting).observe(host);
  function frame(now){requestAnimationFrame(frame);const dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now;if(document.hidden||!visible)return;pad.systems.forEach((g,i)=>g.position.y+=((exploded?heights[i]:0)-g.position.y)*(1-Math.exp(-dt*5)));controls.update(dt);renderer.render(scene,camera);}
  requestAnimationFrame(frame);
  document.querySelectorAll('.viewer-controls button,.viewer-controls select').forEach(el=>el.disabled=false);
} catch(error) {
  status.textContent='3D unavailable — use the annotated diagram below.';
  document.getElementById('diagramFallback').open=true;
  document.querySelectorAll('.viewer-controls button,.viewer-controls select').forEach(el=>el.disabled=true);
  console.error('Pad viewer could not initialize:',error);
}



