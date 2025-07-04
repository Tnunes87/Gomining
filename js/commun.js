(() => {

/* ═════ 1. État & helpers ═════════════════════════════════════ */
const DB_NAME='gominingDB_v3', DB_VERSION=1;
const state={
  miners:[], investissements:[], gains:[], ventes:[],
  rates:{btc_usd:0,btc_eur:0,gmt_usd:0,gmt_eur:0,usd_eur:0,eur_usd:0},
  manual_gmt_usd: localStorage.getItem('manual_gmt_usd') || '',
  reduc         : parseFloat(localStorage.getItem('reduc') || '0.15')  // 15 % par défaut

};
const $  =(s,c=document)=>c.querySelector(s);
const $$ =(s,c=document)=>[...c.querySelectorAll(s)];
const fmt=(n,d=2)=>Number(n).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const todayISO=()=>new Date().toISOString().slice(0,10);

    /* ═════ 2. IndexedDB mini-wrapper ═════════════════════════════ */
let db=null;
function openDB(){
  if(db) return Promise.resolve(db);
  return new Promise((ok,ko)=>{
    const rq=indexedDB.open(DB_NAME,DB_VERSION);
    rq.onerror=e=>ko(e.target.error);
    rq.onupgradeneeded=e=>{
      const d=e.target.result;
      ['miners','investissements','gains','ventes'].forEach(s=>{
        if(!d.objectStoreNames.contains(s))
          d.createObjectStore(s,{keyPath:'id',autoIncrement:true});
      });
    };
    rq.onsuccess=e=>{db=e.target.result;ok(db);};
  });
}
function idb(store,mode,fn){
  return openDB().then(db=>new Promise((ok,ko)=>{
    const tx=db.transaction(store,mode), st=tx.objectStore(store);
    const rq=fn(st); rq.onsuccess=_=>ok(rq.result); rq.onerror=_=>ko(rq.error);
  }));
}
const DB={
  add :(s,d)=>idb(s,'readwrite',st=>st.add(d)),
  put :(s,d)=>idb(s,'readwrite',st=>st.put(d)),
  del :(s,i)=>idb(s,'readwrite',st=>st.delete(i)),
  all :(s)  =>idb(s,'readonly', st=>st.getAll()),
  clear     :()=>openDB().then(db=>new Promise((ok,ko)=>{
    const tx=db.transaction(['miners','investissements','gains','ventes'],'readwrite');
    ['miners','investissements','gains','ventes'].forEach(s=>tx.objectStore(s).clear());
    tx.oncomplete=_=>ok(); tx.onerror=_=>ko(tx.error);
  }))
};

/* ═════ 4. Init données / purge DB ═══════════════════════════ */

async function initData(){
  [state.miners,state.investissements,state.gains,state.ventes] =
    await Promise.all(['miners','investissements','gains','ventes'].map(DB.all));
}
async function purgeDB(){
  await DB.clear();
  state.miners=[];state.investissements=[];state.gains=[];state.ventes=[];
  populateInvFilters(); renderResume(); renderTables();
}


})();
