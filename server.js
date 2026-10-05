const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function loadEnv(file) {
  const out = { ...process.env };
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in out)) out[key] = value;
  }
  return out;
}
const ENV = loadEnv(path.join(__dirname, '.env'));
const DEFAULT_PORT = Number(ENV.PORT || 5050);
let PORT = DEFAULT_PORT;
const APP_NAME = ENV.APP_NAME || 'Lazzat FastFood';
const BOT_TOKEN = ENV.BOT_TOKEN || ENV.TELEGRAM_BOT_TOKEN || '';
const WEBAPP_URL = ENV.WEBAPP_URL || '';
const ADMIN_CHAT_ID = ENV.ADMIN_CHAT_ID || '';
const ADMIN_KEY = ENV.ADMIN_KEY || '';
const SESSION_SECRET = ENV.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'data', 'db.json');

const products = [
  { id: 'classic-burger', name: 'Klassik Burger', category: 'Burger', price: 38000, desc: 'Mol go‘shti kotleti, cheddar, salat va maxsus Lazzat sousi.', image: '/assets/burger.svg', popular: true },
  { id: 'chicken-burger', name: 'Tovuq Burger', category: 'Burger', price: 36000, desc: 'Qarsildoq tovuq, karam salati va yumshoq bulochka.', image: '/assets/chicken-burger.svg', popular: true },
  { id: 'cheese-pizza', name: 'Pishloqli Pizza', category: 'Pizza', price: 69000, desc: 'Mazali pishloq, pomidor sousi va oregano.', image: '/assets/pizza.svg', popular: true },
  { id: 'crispy-wings', name: 'Qarsildoq Wings', category: 'Gazak', price: 42000, desc: 'Qarsildoq tovuq qanotchalari, maxsus dip bilan.', image: '/assets/wings.svg', popular: false },
  { id: 'golden-fries', name: 'Oltin Fri', category: 'Gazak', price: 22000, desc: 'Issiq va qarsildoq kartoshka fri.', image: '/assets/fries.svg', popular: false },
  { id: 'fresh-cola', name: 'Muzdek Cola', category: 'Ichimlik', price: 12000, desc: 'Muzdek gazli ichimlik.', image: '/assets/cola.svg', popular: false },
  { id: 'family-combo', name: 'Oilaviy Combo', category: 'Combo', price: 119000, desc: '2 burger, katta fri, 2 ichimlik va qarsildoq qanotlar.', image: '/assets/combo.svg', popular: true },
  { id: 'mega-combo', name: 'Mega Combo', category: 'Combo', price: 149000, desc: '3 burger, 2 fri, 3 ichimlik va katta qarsildoq wings.', image: '/assets/combo.svg', popular: true }
];

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) writeDb({ users: [], orders: [] });
}
function readDb() {
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [], orders: [] }; }
}
function writeDb(data) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
}
function notFound(res) { json(res, 404, { ok: false, message: 'Topilmadi.' }); }
function clean(value, max=120) { return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max); }
function phone(value) { return String(value ?? '').trim().replace(/[^0-9+() -]/g, '').slice(0, 30); }
function money(n) { return `${Number(n).toLocaleString('uz-UZ')} so‘m`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex'); return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try { const [salt, hash] = stored.split(':'); const next = crypto.scryptSync(password, salt, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex')); }
  catch { return false; }
}
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function createSession(userId) { const payload = `${userId}.${Date.now()}`; return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`; }
function getSessionUserId(token) {
  if (!token) return null; const [raw, signature] = token.split('.'); if (!raw || !signature) return null;
  const payload = Buffer.from(raw, 'base64url').toString('utf8'); const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [userId, created] = payload.split('.'); if (!created || Date.now() - Number(created) > 1000*60*60*24*30) return null; return userId;
}
function getBearer(req) { const value = req.headers.authorization || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function authUser(req) { const id = getSessionUserId(getBearer(req)); if (!id) return null; return readDb().users.find(u => u.id === id) || null; }
function publicUser(user) { return user ? { id:user.id, name:user.name, phone:user.phone, email:user.email, telegramId:user.telegramId || null, username:user.username || '' } : null; }
function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw=''; req.on('data', c => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON')) } }); req.on('error', reject);
  });
}
function validateTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return { ok:false };
  const params = new URLSearchParams(initData); const hash=params.get('hash'); if(!hash) return {ok:false}; params.delete('hash');
  const check=[...params.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const computed=crypto.createHmac('sha256',secret).update(check).digest('hex');
  if(hash.length!==computed.length || !crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(computed))) return {ok:false};
  const authDate=Number(params.get('auth_date')||0); if(!authDate || Math.abs(Date.now()/1000-authDate)>86400) return {ok:false};
  let user=null; try{user=JSON.parse(params.get('user')||'null')}catch{}
  return user?.id ? {ok:true,user} : {ok:false};
}

function telegramRequest(method, payload) {
  return new Promise((resolve,reject)=>{
    if(!BOT_TOKEN) return resolve({ok:false,description:'Bot token sozlanmagan'});
    const body=Buffer.from(JSON.stringify(payload||{}));
    const req=https.request(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json','content-length':body.length}},r=>{
      let data=''; r.on('data',c=>data+=c); r.on('end',()=>{try{resolve(JSON.parse(data))}catch{reject(new Error('Telegram JSON xatosi'))}});
    });
    req.on('error',reject);req.write(body);req.end();
  });
}
async function notifyAdmin(order){
  if(!ADMIN_CHAT_ID||!BOT_TOKEN)return;
  const lines=order.items.map(i=>`• ${i.name} × ${i.qty} — ${money(i.lineTotal)}`).join('\n');
  const message=`🧾 <b>Yangi buyurtma #${order.id}</b>\n\n👤 ${clean(order.customer.name)}\n📞 ${clean(order.customer.phone)}\n📍 ${clean(order.customer.address)}\n💳 ${clean(order.payment)}\n\n${lines}\n\n💰 <b>${money(order.total)}</b>`;
  try{await telegramRequest('sendMessage',{chat_id:ADMIN_CHAT_ID,text:message,parse_mode:'HTML'})}catch(err){console.error('Admin notification:',err.message)}
}
let botOffset=0;
function botWebAppMarkup(){
  if(WEBAPP_URL && /^https:\/\//i.test(WEBAPP_URL)) return {inline_keyboard:[[{text:'🍔 Mini Appni ochish',web_app:{url:WEBAPP_URL}}]]};
  return undefined;
}
function botReplyKeyboard(){
  return {keyboard:[[{text:'🍔 Menyu'},{text:'🛒 Buyurtma'}],[{text:'📍 Manzil'},{text:'📞 Aloqa'}],[{text:'📦 Buyurtmam'}]],resize_keyboard:true,is_persistent:true};
}
async function sendBot(chatId,text,extra={}){
  return telegramRequest('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra});
}
async function handleTelegramMessage(message){
  const chatId=message?.chat?.id;if(!chatId)return;const raw=String(message.text||'').trim();const text=raw.toLowerCase();
  if(text.startsWith('/start') || text==='🍔 menyu' && false){
    const extra={reply_markup:botReplyKeyboard()};
    const app=botWebAppMarkup();
    const suffix=app?`\n\n📲 Pastdagi tugma orqali <b>Mini App</b>ni ham ochishingiz mumkin.`:`\n\n⚠️ Mini App hozircha faqat HTTPS manzil sozlangandan keyin ochiladi. Lokalda sayt <b>http://localhost:${PORT}</b> orqali ishlaydi.`;
    if(app) extra.reply_markup={...botReplyKeyboard()};
    await sendBot(chatId,`Assalomu alaykum, <b>${clean(message.from?.first_name||'mehmon')}</b>! 👋\n\n<b>${APP_NAME}</b>ga xush kelibsiz.\nIssiq taom tanlang, savatchaga qo‘shing va buyurtmangizni yuboring.${suffix}`,extra);
    if(app) await sendBot(chatId,'<b>Mini App</b>',{reply_markup:app});
    return;
  }
  if(text==='/menu' || text==='🍔 menyu'){
    const list=products.map(p=>`${p.popular?'⭐ ':''}<b>${clean(p.name)}</b> — ${money(p.price)}\n   <i>${clean(p.desc,90)}</i>`).join('\n');
    const app=botWebAppMarkup();
    await sendBot(chatId,`🍔 <b>${APP_NAME} menyusi</b>\n\n${list}\n\n<i>Buyurtma qilish uchun 🛒 Buyurtma tugmasini bosing.</i>`,{reply_markup:botReplyKeyboard()});
    if(app) await sendBot(chatId,'📲', {reply_markup:app});
    return;
  }
  if(text==='/order' || text==='🛒 buyurtma'){
    const app=botWebAppMarkup();
    if(app){await sendBot(chatId,'🛒 <b>Buyurtma</b>\n\nMini Appni oching va taomlarni savatchaga qo‘shing.',{reply_markup:app});}
    else{await sendBot(chatId,`🛒 <b>Buyurtma</b>\n\nMini App uchun HTTPS manzil hali sozlanmagan.\n\n💻 Lokal sayt: <b>http://localhost:${PORT}/order.html</b>\n\nBotning menyu, aloqa va buyurtma holati funksiyalari esa ishlaydi.` ,{reply_markup:botReplyKeyboard()});}
    return;
  }
  if(text==='/status' || text==='📦 buyurtmam'){
    const db=readDb(); const uid=String(message.from?.id||''); const orders=db.orders.filter(o=>o.userId && db.users.find(u=>u.id===o.userId && String(u.telegramId||'')===uid)).slice(0,3);
    if(!orders.length){await sendBot(chatId,'📦 Hozircha sizning Telegram hisobingizga bog‘langan buyurtma topilmadi.');return;}
    const list=orders.map(o=>`#${o.id} · <b>${clean(o.status)}</b> · ${money(o.total)}`).join('\n');
    await sendBot(chatId,`📦 <b>So‘nggi buyurtmalaringiz</b>\n\n${list}`);return;
  }
  if(text==='/id'){
    await sendBot(chatId,`🆔 Telegram chat ID: <code>${chatId}</code>\n\nBuni <b>ADMIN_CHAT_ID</b> sifatida .env fayliga qo‘yishingiz mumkin.`);return;
  }
  if(text==='/address' || text==='📍 manzil'){
    await sendBot(chatId,'📍 <b>Manzil</b>\n\nQarshi shahri va yaqin hududlarga yetkazib berish rejalashtirilgan. Aniq manzilni buyurtma formasida kiriting.');return;
  }
  if(text==='/contact' || text==='📞 aloqa'){
    await sendBot(chatId,'📞 <b>Aloqa</b>\n\nBuyurtma va savollar uchun shu botdan foydalaning. Muammo bo‘lsa, admin bilan bog‘laning.');return;
  }
  if(text==='/help'){
    await sendBot(chatId,'❓ <b>Yordam</b>\n\n/start — botni boshlash\n/menu — menyu\n/order — buyurtma\n/status — so‘nggi buyurtmalar\n/id — Telegram chat ID\n/address — manzil haqida\n/contact — aloqa\n/help — yordam');return;
  }
  await sendBot(chatId,'Tushunmadim 🙂 Pastdagi tugmalardan birini tanlang yoki /help buyrug‘ini yuboring.',{reply_markup:botReplyKeyboard()});
}
async function startBot(){
  if(!BOT_TOKEN){console.log('Telegram bot: token mavjud emas, sayt rejimida ishlaydi.');return;}
  try{
    const me=await telegramRequest('getMe',{});
    if(!me.ok){console.error('Telegram bot tokenini tekshirib bo‘lmadi. Sayt baribir ishlaydi.');return;}
    console.log(`Telegram bot ulandi: @${me.result.username}`);
    await telegramRequest('deleteWebhook',{drop_pending_updates:false});
    await telegramRequest('setMyCommands',{commands:[{command:'start',description:'Lazzat botini boshlash'},{command:'menu',description:'Menyuni ko‘rish'},{command:'order',description:'Buyurtma berish'},{command:'status',description:'Buyurtmalarim'},{command:'help',description:'Yordam'}]});
    await telegramRequest('setMyDescription',{description:'Lazzat FastFood — burger, pizza, fri va combo. Menyuni ko‘ring va buyurtma bering.'});
    await telegramRequest('setMyShortDescription',{short_description:'Lazzat FastFood — mazali buyurtmalar'});
    const app=botWebAppMarkup();
    if(app) await telegramRequest('setChatMenuButton',{menu_button:{type:'web_app',text:'🍔 Buyurtma',web_app:{url:WEBAPP_URL}}});
  }catch(err){console.error('Telegram sozlash:',err.message);return;}
  while(true){
    try{
      const result=await telegramRequest('getUpdates',{offset:botOffset,timeout:25,allowed_updates:['message']});
      if(!result.ok){await new Promise(r=>setTimeout(r,3000));continue;}
      for(const update of result.result||[]){botOffset=update.update_id+1;await handleTelegramMessage(update.message);}
    }catch(err){console.error('Telegram polling:',err.message);await new Promise(r=>setTimeout(r,3000));}
  }
}

async function api(req,res,url){
  const method=req.method, p=url.pathname;
  if(method==='GET'&&p==='/api/health')return json(res,200,{ok:true,app:APP_NAME,time:new Date().toISOString()});
  if(method==='GET'&&p==='/api/products')return json(res,200,{ok:true,products});
  if(method==='GET'&&p==='/api/me'){const user=authUser(req);return user?json(res,200,{ok:true,user:publicUser(user)}):json(res,401,{ok:false,message:'Avval tizimga kiring.'});}
  if(method==='POST'&&p==='/api/register'){
    let body;try{body=await parseJson(req)}catch{return json(res,400,{ok:false,message:'Ma’lumot formati noto‘g‘ri.'})}
    const name=clean(body.name,80), ph=phone(body.phone), email=clean(body.email,120).toLowerCase(), pass=String(body.password||'');
    if(name.length<2)return json(res,400,{ok:false,message:'Ismingizni kiriting.'});if(ph.length<7)return json(res,400,{ok:false,message:'Telefon raqamingizni kiriting.'});if(!/^\S+@\S+\.\S+$/.test(email))return json(res,400,{ok:false,message:'Email manzilini to‘g‘ri kiriting.'});if(pass.length<6)return json(res,400,{ok:false,message:'Parol kamida 6 belgidan iborat bo‘lsin.'});
    const db=readDb();if(db.users.some(u=>u.email===email))return json(res,409,{ok:false,message:'Bu email allaqachon ro‘yxatdan o‘tgan.'});
    const user={id:crypto.randomUUID(),name,phone:ph,email,passwordHash:hashPassword(pass),createdAt:new Date().toISOString(),telegramId:null};db.users.push(user);writeDb(db);
    return json(res,200,{ok:true,token:createSession(user.id),user:{id:user.id,name,phone:ph,email}});
  }
  if(method==='POST'&&p==='/api/login'){
    let body;try{body=await parseJson(req)}catch{return json(res,400,{ok:false,message:'Ma’lumot formati noto‘g‘ri.'})}
    const email=clean(body.email,120).toLowerCase(),pass=String(body.password||'');const user=readDb().users.find(u=>u.email===email);
    if(!user||!verifyPassword(pass,user.passwordHash))return json(res,401,{ok:false,message:'Email yoki parol noto‘g‘ri.'});
    return json(res,200,{ok:true,token:createSession(user.id),user:{id:user.id,name:user.name,phone:user.phone,email:user.email}});
  }
  if(method==='POST'&&p==='/api/telegram/session'){
    let body;try{body=await parseJson(req)}catch{return json(res,400,{ok:false,message:'Ma’lumot formati noto‘g‘ri.'})}
    const checked=validateTelegramInitData(body.initData);if(!checked.ok)return json(res,401,{ok:false,message:'Telegram sessiyasini tasdiqlab bo‘lmadi.'});
    const t=checked.user,db=readDb();let user=db.users.find(u=>u.telegramId===String(t.id));
    if(!user){user={id:crypto.randomUUID(),name:clean([t.first_name,t.last_name].filter(Boolean).join(' ')||'Telegram foydalanuvchi',80),phone:'',email:'',passwordHash:'',createdAt:new Date().toISOString(),telegramId:String(t.id),username:clean(t.username||60)};db.users.push(user)}else{user.name=clean([t.first_name,t.last_name].filter(Boolean).join(' ')||user.name,80);user.username=clean(t.username||user.username||60)}
    writeDb(db);return json(res,200,{ok:true,token:createSession(user.id),user:{id:user.id,name:user.name,phone:user.phone,email:user.email,telegramId:user.telegramId}});
  }
  if(method==='POST'&&p==='/api/orders'){
    const user=authUser(req);if(!user)return json(res,401,{ok:false,message:'Avval tizimga kiring.'});
    let body;try{body=await parseJson(req)}catch{return json(res,400,{ok:false,message:'Ma’lumot formati noto‘g‘ri.'})}
    const incoming=Array.isArray(body.items)?body.items:[],items=[];let total=0;
    for(const row of incoming){const product=products.find(x=>x.id===row.id),qty=Math.max(0,Math.min(20,Number(row.qty)||0));if(!product||qty<=0)continue;const lineTotal=product.price*qty;items.push({id:product.id,name:product.name,price:product.price,qty,lineTotal});total+=lineTotal;}
    if(!items.length)return json(res,400,{ok:false,message:'Savatcha bo‘sh.'});
    const customer={name:clean(body.customer?.name||user.name,80),phone:phone(body.customer?.phone||user.phone),address:clean(body.customer?.address,160)};
    if(customer.name.length<2)return json(res,400,{ok:false,message:'Ismni kiriting.'});if(customer.phone.length<7)return json(res,400,{ok:false,message:'Telefon raqamini kiriting.'});if(customer.address.length<5)return json(res,400,{ok:false,message:'Yetkazib berish manzilini kiriting.'});
    const payment=['cash','card','online'].includes(body.payment)?body.payment:'cash',db=readDb();const order={id:String(Date.now()).slice(-8),userId:user.id,items,total,customer,payment,status:'Qabul qilindi',createdAt:new Date().toISOString()};db.orders.unshift(order);writeDb(db);notifyAdmin(order).catch(()=>{});return json(res,200,{ok:true,order});
  }
  if(method==='GET'&&p==='/api/orders'){const user=authUser(req);if(!user)return json(res,401,{ok:false,message:'Avval tizimga kiring.'});const orders=readDb().orders.filter(o=>o.userId===user.id).slice(0,20);return json(res,200,{ok:true,orders});}
  if(method==='GET'&&p==='/api/admin/orders'){
    const key=String(req.headers['x-admin-key']||''),expected=ADMIN_KEY||sign(`admin:${ADMIN_CHAT_ID||'default'}`).slice(0,20);if(!ADMIN_KEY)return json(res,503,{ok:false,message:'ADMIN_KEY sozlanmagan.'});if(key!==ADMIN_KEY)return json(res,403,{ok:false,message:'Admin kaliti noto‘g‘ri.'});const db=readDb();return json(res,200,{ok:true,orders:db.orders.slice(0,100),users:db.users.length});
  }
  return notFound(res);
}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';if(pathname==='/order')pathname='/order.html';if(pathname==='/admin')pathname='/admin.html';
  const target=path.resolve(PUBLIC_DIR,'.'+pathname);if(!target.startsWith(PUBLIC_DIR+path.sep))return notFound(res);
  fs.stat(target,(err,st)=>{if(err||!st.isFile())return notFound(res);const ext=path.extname(target).toLowerCase();res.writeHead(200,{'content-type':MIME[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public, max-age=3600'});fs.createReadStream(target).pipe(res);});
}

ensureDb();
const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))await api(req,res,url);else serveStatic(req,res,url);}catch(err){console.error(err);if(!res.headersSent)json(res,500,{ok:false,message:'Server xatosi.'});else res.end();}
});
function listenWithFallback(port){
  const onError=err=>{if(err.code==='EADDRINUSE'){console.log(`Port ${port} band, keyingi port sinab ko‘riladi...`);server.close(()=>listenWithFallback(port+1));}else{console.error('Server ishga tushmadi:',err.message);process.exitCode=1;}};
  server.once('error',onError);
  server.listen(port,()=>{PORT=port;console.log(`${APP_NAME}: http://localhost:${PORT}`);startBot();});
}
listenWithFallback(DEFAULT_PORT);
