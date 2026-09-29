// Shared scene/mission data. Coordinates use the simulation's 10 units/metre.
(function(g) {
  const districts = [
    {name:'Medical quarter', x:-1000, y:-1200, task:'Medical delivery'},
    {name:'Riverside logistics', x:2500, y:-2600, task:'Cargo delivery'},
    {name:'Central business district', x:700, y:-3800, task:'Passenger transfer'},
    {name:'North research campus', x:-1800, y:-5100, task:'Infrastructure inspection'}
  ];
  const buildings = [];
  for(let row=0;row<11;row++) for(let col=-8;col<=8;col++) {
    const height=12+((row*17+col*col*3)%43);
    buildings.push({x:col*45,z:-85-row*52,width:26,depth:27,height});
  }
  g.VahnimCity={districts, buildings};
})(typeof window !== 'undefined' ? window : globalThis);
