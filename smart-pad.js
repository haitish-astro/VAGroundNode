const systems=[
['Communications & local coordination','Discover nearby aircraft, exchange capabilities, sequence requests and publish pad status. A local coordinator would keep an auditable record of the exchange.','Radio transport, identity, cybersecurity, lost-link behavior and aircraft adapters.'],
['Landing-area awareness','Candidate cameras or ranging sensors could check occupancy and detect obstructions. Environmental sensing could inform whether the pad is available.','Sensor selection, visibility limits, false detections, weather and safe responses.'],
['Guidance & status lighting','A recognizable landing reference and perimeter lighting could support final alignment and communicate pad status. The demo ring turns blue during takeoff or landing and amber when a queue exists.','Visual markers, approach visibility, lighting conventions and aircraft localization.'],
['Power & service interface','An equipment cabinet could house local computing, power protection and an aircraft-specific service interface. Service should follow touchdown and propulsion-safe confirmation.','Connector compatibility, battery requirements, thermal management, interlocks and maintenance.'],
['Landing deck & modular structure','A defined touchdown surface with drainage, maintainable modules and equipment kept clear of rotor envelopes. Shared UAV markings represent the demo layout.','Aircraft loads, rotor downwash, surface friction, access, spacing and installation needs.']];
function selectSystem(index){
  if(!Number.isInteger(index)||index<0||index>=systems.length)return;
  document.querySelectorAll('[data-system]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.system)===index)));
  const [title,body,research]=systems[index];const h=document.createElement('h3'),p=document.createElement('p'),r=document.createElement('p');h.textContent=title;p.textContent=body;r.className='small';r.textContent='Research: '+research;document.getElementById('systemDetail').replaceChildren(h,p,r);
  window.dispatchEvent(new CustomEvent('pad-system-selected',{detail:index}));
}
document.getElementById('systems').onclick=e=>{const button=e.target.closest('[data-system]');if(button)selectSystem(Number(button.dataset.system));};
window.addEventListener('pad-system-picked',e=>selectSystem(e.detail));
