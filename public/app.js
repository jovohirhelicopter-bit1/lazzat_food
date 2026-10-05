const tg = window.Telegram?.WebApp;
const state = { products: [], category: 'Hammasi', search: '', cart: {}, token: localStorage.getItem('lazzat_token') || '', user: null, authMode: 'login' };
const money = n => `${Number(n).toLocaleString('uz-UZ')} so‘m`;
const $ = s => document.querySelector(s);

function toast(message, kind='') {
  const el = $('#toast'); el.textContent = message; el.className = `toast show ${kind}`;
  clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.className='toast', 2500);
}
function setNotice(message, kind='error') { const el=$('#orderNotice'); el.textContent=message; el.className=`notice show ${kind}`; }

function telegramInit() {
  if (!tg) return;
  tg.ready(); tg.expand();
  const badge = $('#tgBadge'); badge.style.display='inline-flex';
  document.documentElement.style.setProperty('--bg', tg.themeParams?.secondary_bg_color || '#fbfaf7');
  if (tg.initData) {
    fetch('/api/telegram/session', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({initData:tg.initData})})
      .then(r=>r.json()).then(d=>{ if(d.ok){ state.token=d.token; state.user=d.user; localStorage.setItem('lazzat_token',d.token); renderAuth(); fillCustomer(); } })
      .catch(()=>{});
  }
}

function fillCustomer() {
  if (!state.user) return;
  if ($('#customerName') && !$('#customerName').value) $('#customerName').value = state.user.name || '';
  if ($('#customerPhone') && !$('#customerPhone').value) $('#customerPhone').value = state.user.phone || '';
}
async function loadUser() {
  if (!state.token) { renderAuth(); return; }
  try { const r=await fetch('/api/me',{headers:{authorization:`Bearer ${state.token}`}}); const d=await r.json(); if(d.ok){state.user=d.user;renderAuth();fillCustomer();} else logout(false); } catch { renderAuth(); }
}
function logout(show=true){ state.token='';state.user=null;localStorage.removeItem('lazzat_token');renderAuth(); if(show) toast('Tizimdan chiqdingiz.'); }

function renderAuth() {
  const root=$('#authPanel');
  if (state.user) {
    root.innerHTML=`<div class="account-chip"><div class="avatar">${(state.user.name||'L').slice(0,1).toUpperCase()}</div><div style="flex:1"><strong>${state.user.name}</strong><div class="muted" style="font-size:12px">${state.user.email || 'Telegram orqali ulangan'}</div></div><button class="pill" onclick="logout()">Chiqish</button></div>`;
    return;
  }
  root.innerHTML=`<div class="auth-switch"><button class="${state.authMode==='login'?'active':''}" onclick="state.authMode='login';renderAuth()">Kirish</button><button class="${state.authMode==='register'?'active':''}" onclick="state.authMode='register';renderAuth()">Ro‘yxatdan o‘tish</button></div>
  <form id="authForm"><div class="form-row">${state.authMode==='register'?`<div class="field"><label>Ism</label><input name="name" placeholder="Ismingiz" required></div><div class="field"><label>Telefon</label><input name="phone" placeholder="+998 90 123 45 67" required></div>`:''}</div>
  <div class="form-row"><div class="field"><label>Email</label><input type="email" name="email" placeholder="siz@email.com" required></div><div class="field"><label>Parol</label><input type="password" name="password" placeholder="Kamida 6 belgi" minlength="6" required></div></div>
  <div class="notice" id="authNotice"></div><button class="btn ${state.authMode==='login'?'btn-primary':'btn-secondary'}" style="width:100%;margin-top:12px">${state.authMode==='login'?'Kirish':'Hisob yaratish'}</button></form>`;
  $('#authForm').onsubmit=submitAuth;
}
async function submitAuth(e){
  e.preventDefault(); const data=Object.fromEntries(new FormData(e.target)); const endpoint=state.authMode==='login'?'/api/login':'/api/register';
  const note=$('#authNotice'); note.textContent='';note.className='notice';
  try{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!d.ok){note.textContent=d.message;note.className='notice show error';return;}state.token=d.token;state.user=d.user;localStorage.setItem('lazzat_token',d.token);renderAuth();fillCustomer();toast(state.authMode==='login'?'Xush kelibsiz!':'Hisob yaratildi!','success');}catch{note.textContent='Server bilan bog‘lanishda xato.';note.className='notice show error';}}

function renderCategories() {
  const cats=['Hammasi',...new Set(state.products.map(p=>p.category))];
  $('#categories').innerHTML=cats.map(c=>`<button class="cat-btn ${c===state.category?'active':''}" onclick="state.category='${c.replace(/'/g,"\\'")}';renderCategories();renderProducts()">${c}</button>`).join('');
}
function renderProducts(){
  const term=state.search.toLowerCase(); const list=state.products.filter(p=>(state.category==='Hammasi'||p.category===state.category) && (`${p.name} ${p.desc}`.toLowerCase().includes(term)));
  $('#products').innerHTML=list.length?list.map(p=>`<article class="product"><div class="product-media">${p.popular?'<span class="tag">⭐ Top</span>':''}<img src="${p.image}" alt="${p.name}"></div><h3>${p.name}</h3><div class="desc">${p.desc}</div><div class="product-bottom"><div class="price">${money(p.price)}</div><button class="add" onclick="addToCart('${p.id}')" aria-label="Savatchaga qo‘shish">+</button></div></article>`).join(''):'<div class="empty" style="grid-column:1/-1">Bu bo‘limda hozircha mahsulot topilmadi.</div>';
}
function addToCart(id){state.cart[id]=(state.cart[id]||0)+1;renderCart();toast('Savatchaga qo‘shildi ✓','success');}
function changeQty(id,delta){state.cart[id]=Math.max(0,(state.cart[id]||0)+delta);if(state.cart[id]===0)delete state.cart[id];renderCart();}
function cartItems(){return Object.entries(state.cart).map(([id,qty])=>{const p=state.products.find(x=>x.id===id);return p?{...p,qty}:null}).filter(Boolean)}
function renderCart(){
  const items=cartItems(); const total=items.reduce((s,p)=>s+p.price*p.qty,0); const count=items.reduce((s,p)=>s+p.qty,0);
  $('#emptyCart').style.display=items.length?'none':'block';$('#checkout').style.display=items.length?'block':'none';
  $('#cart').innerHTML=items.map(p=>`<div class="cart-row"><img src="${p.image}" alt="${p.name}"><div><strong>${p.name}</strong><div class="muted" style="font-size:12px">${money(p.price)}</div></div><div class="qty"><button onclick="changeQty('${p.id}',-1)">−</button><b>${p.qty}</b><button onclick="changeQty('${p.id}',1)">+</button></div></div>`).join('');
  $('#subTotal').textContent=money(total);$('#cartTotal').textContent=money(total);$('#miniCount').textContent=count;$('#miniTotal').textContent=money(total);$('#cartCountLabel').textContent=`${count} ta`;$('#miniCart').style.display=items.length?'flex':'none';
}
async function placeOrder(){
  if(!state.token){setNotice('Buyurtma berish uchun avval tizimga kiring.');$('#authPanel').scrollIntoView({behavior:'smooth'});return;}
  const items=cartItems(); const payload={items:items.map(p=>({id:p.id,qty:p.qty})),payment:$('#payment').value,customer:{name:$('#customerName').value,phone:$('#customerPhone').value,address:$('#address').value}};
  if(!payload.customer.name || !payload.customer.phone || !payload.customer.address){setNotice('Ism, telefon va manzilni to‘liq kiriting.');return;}
  const btn=$('#placeOrder');btn.disabled=true;btn.textContent='Yuborilmoqda...';
  try{const r=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${state.token}`},body:JSON.stringify(payload)});const d=await r.json();if(!d.ok){setNotice(d.message);btn.disabled=false;btn.textContent='Buyurtmani yuborish →';return;}state.cart={};renderCart();$('#orderNotice').className='notice';$('#successBox').classList.add('show');$('#successText').textContent=`Buyurtma #${d.order.id} qabul qilindi. Jami: ${money(d.order.total)}.`;$('#checkout').style.display='none';if(tg?.HapticFeedback)tg.HapticFeedback.notificationOccurred('success');btn.disabled=false;btn.textContent='Buyurtmani yuborish →';}catch{setNotice('Buyurtmani yuborishda server xatosi.');btn.disabled=false;btn.textContent='Buyurtmani yuborish →';}}

async function boot(){
  telegramInit();
  try{const r=await fetch('/api/products');const d=await r.json();state.products=d.products||[];renderCategories();renderProducts();renderCart();}catch{$('#products').innerHTML='<div class="empty" style="grid-column:1/-1">Server ishlamayapti. Terminalda `npm start` ni ishga tushiring.</div>'}
  await loadUser();
  const params=new URLSearchParams(location.search);const p=params.get('product');if(p && state.products.some(x=>x.id===p)) addToCart(p);
  $('#search').oninput=e=>{state.search=e.target.value;renderProducts()}; $('#clearSearch').onclick=()=>{$('#search').value='';state.search='';renderProducts()}; $('#placeOrder').onclick=placeOrder;
}
window.addToCart=addToCart;window.changeQty=changeQty;window.logout=logout;window.state=state;window.renderAuth=renderAuth;window.renderCategories=renderCategories;window.renderProducts=renderProducts;
boot();
