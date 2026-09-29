// Integration lab: live mirror of city telemetry received from another tab of the same browser (BroadcastChannel).
const byId=id=>document.getElementById(id);
const sources=new Map();let selected='',lastKey='';
const channel='BroadcastChannel' in window?new BroadcastChannel('vahnim-groundnode-telemetry'):null;
if(!channel)byId('liveStatus').textContent='Cross-tab telemetry unavailable';
if(channel)channel.onmessage=({data})=>{
  if(data?.kind!=='snapshot'||!Array.isArray(data.fleet)||!Array.isArray(data.comms))return;
  if(!sources.has(data.session)){const option=document.createElement('option');option.value=data.session;option.textContent=data.session;byId('source').append(option);if(!selected){byId('source').options[0].remove();selected=data.session;byId('source').value=selected;}}
  sources.set(data.session,{...data,received:Date.now()});updateLive();
};
byId('source').onchange=()=>{selected=byId('source').value;lastKey='';updateLive();};
function updateLive(){
  const s=sources.get(selected);if(!s)return;
  byId('liveStatus').textContent=Date.now()-s.received>3000?'Stale · source inactive':s.paused?'Simulation paused':s.hidden?'Source tab hidden':'Receiving simulation';
  byId('padStatus').replaceChildren(...(s.pads||[]).map(p=>{const line=document.createElement('div');line.textContent=`${p.name} · ${p.occupancy} · ${p.queue} waiting`;return line;}));
  byId('fleet').replaceChildren(...s.fleet.map(d=>{const row=document.createElement('tr');for(const v of [d.callsign,d.state,`${d.altitude.toFixed(1)} m`,`${d.battery.toFixed(0)}%`]){const td=document.createElement('td');td.textContent=v;row.append(td);}return row;}));
  const key=selected+'|'+s.comms.at(-1)?.id;if(key===lastKey)return;lastKey=key;
  byId('liveLog').replaceChildren(...s.comms.slice(-25).reverse().map(e=>{const li=document.createElement('li'),b=document.createElement('b'),span=document.createElement('span');b.textContent=`${(e.tick*.033).toFixed(1)}s · ${e.channel.toUpperCase()} · ${e.direction==='toDrone'?'NODE → AIR':'AIR → NODE'}`;span.textContent=e.text;li.append(b,span);return li;}));
}
setInterval(updateLive,1000);
