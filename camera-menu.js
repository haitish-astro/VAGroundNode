(() => {
  const trigger=document.getElementById('cameraTrigger'),menu=document.getElementById('cameraMenu'),select=document.getElementById('cameraMode');
  const items=[...menu.querySelectorAll('[data-view]')];
  function close(restore=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(restore)trigger.focus();}
  function open(){menu.hidden=false;trigger.setAttribute('aria-expanded','true');(items.find(b=>b.dataset.view===select.value)||items[0]).focus();}
  function sync(){document.getElementById('cameraLabel').textContent=select.selectedOptions[0].textContent;items.forEach(b=>b.setAttribute('aria-checked',String(b.dataset.view===select.value)));}
  trigger.onclick=()=>menu.hidden?open():close();
  trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}};
  items.forEach(b=>b.onclick=()=>{select.value=b.dataset.view;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);});
  menu.onkeydown=e=>{
    const current=items.indexOf(document.activeElement);let next=current;
    if(e.key==='Escape'){e.preventDefault();close(true);return;}
    if(e.key==='Tab'){close();return;}
    if(e.key==='ArrowDown')next=(current+1)%items.length;
    else if(e.key==='ArrowUp')next=(current-1+items.length)%items.length;
    else if(e.key==='Home')next=0;else if(e.key==='End')next=items.length-1;else return;
    e.preventDefault();items[next].focus();
  };
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.camera-picker'))close();});
  document.addEventListener('focusin',e=>{if(!e.target.closest('.camera-picker'))close();});
  select.addEventListener('change',sync);

  sync();
})();

