/*
═══════════════════════════════════════════════════════════════════════════════
  GoMining v3.6.8 – app.js
  Structure pédagogique et commentaires pour compréhension et apprentissage
═══════════════════════════════════════════════════════════════════════════════

  Ce fichier contient toute la logique de l'application GoMining (version simple).
  Il est organisé en grands blocs thématiques, chacun précédé d'un titre clair.
  Chaque fonction ou section importante est commentée pour expliquer son rôle.
  → Désormais, chaque ligne ou presque est commentée pour faciliter l'apprentissage !

  Table des matières (recherche rapide avec Ctrl+F) :
    1. État global & helpers
    2. Accès base de données (IndexedDB)
    3. Récupération des taux (API + manuel)
    4. Affichage des capsules de taux
    5. Calculs utilitaires
    6. Rendu UI (tuiles, tableaux, mineurs)
    7. Filtres et tables
    8. Modales (fenêtres pop-up)
    9. Gestion des clics globaux
   10. Initialisation et bootstrap

═══════════════════════════════════════════════════════════════════════════════
*/

// ═════ 1. État global & helpers ════════════════════════════════════════════
// --- Déclaration du nom et version de la base IndexedDB utilisée
const DB_NAME = 'gominingDB_v3', DB_VERSION = 1; // Nom et version de la base locale
// --- État principal de l'application (toutes les données utiles en mémoire)
const state = {
  miners: [],              // Liste des mineurs (objets, chaque mineur a id, power, eff, cost, date)
  investissements: [],     // Liste des investissements (liés à un mineur ou à GMT)
  gains: [],               // Liste des gains (récoltes de satoshis)
  ventes: [],              // Liste des ventes (revente de satoshis)
  rates: {                 // Taux de change et cours
    btc_usd: 0,            // Cours du Bitcoin en USD
    btc_eur: 0,            // Cours du Bitcoin en EUR
    gmt_usd: 0,            // Cours du GMT en USD (manuel)
    gmt_eur: 0,            // Cours du GMT en EUR (calculé)
    usd_eur: 0,            // Taux de conversion USD → EUR
    eur_usd: 0             // Taux de conversion EUR → USD
  },
  manual_gmt_usd: localStorage.getItem('manual_gmt_usd') || '', // Valeur GMT entrée manuellement (stockée localement)
  reduc: parseFloat(localStorage.getItem('reduc') || '0.15')    // Réduction sur les frais (par défaut 15%)
};
// --- Helpers DOM (sélecteurs rapides)
const $  = (s, c = document) => c.querySelector(s);           // Sélecteur unique CSS (ex: $('#id'))
const $$ = (s, c = document) => [...c.querySelectorAll(s)];   // Sélecteur multiple CSS (ex: $$('.classe'))
// --- Helpers de formatage numérique
const fmt = (n, d = 2) => Number(n).toLocaleString('fr-FR', { // Formate un nombre en français avec d décimales
  minimumFractionDigits: d, maximumFractionDigits: d
});
const todayISO = () => {
  const date = new Date();
  const jour = date.getDate().toString().padStart(2, '0');
  const mois = (date.getMonth() + 1).toString().padStart(2, '0');
  const annee = date.getFullYear();
  return `${jour}-${mois}-${annee}`;
}; // Renvoie la date du jour au format JJ-MM-AAAA

/* ═════ 2. IndexedDB mini-wrapper ═════════════════════════════ */
// Ce bloc gère l'accès à la base de données locale (IndexedDB) pour stocker
// et retrouver les mineurs, investissements, gains et ventes.
let db = null; // Référence à la base ouverte (null tant qu'on n'a pas ouvert)
function openDB() {
  if (db) return Promise.resolve(db); // Si déjà ouverte, on la réutilise
  return new Promise((ok, ko) => {    // Sinon, on ouvre la base
    const rq = indexedDB.open(DB_NAME, DB_VERSION); // Ouverture de la base
    rq.onerror = e => ko(e.target.error);           // Gestion des erreurs
    rq.onupgradeneeded = e => {                     // Création des tables si besoin
      const d = e.target.result;
      ['miners', 'investissements', 'gains', 'ventes'].forEach(s => {
        if (!d.objectStoreNames.contains(s))        // Si la table n'existe pas
          d.createObjectStore(s, { keyPath: 'id', autoIncrement: true }); // On la crée
      });
    };
    rq.onsuccess = e => { db = e.target.result; ok(db); }; // Succès : on garde la référence
  });
}
function idb(store, mode, fn) {
  // Petite fonction utilitaire pour faire une opération sur un store (table)
  return openDB().then(db => new Promise((ok, ko) => {
    const tx = db.transaction(store, mode), st = tx.objectStore(store); // Transaction et store
    const rq = fn(st); // On applique la fonction passée (add, put, getAll...)
    rq.onsuccess = _ => ok(rq.result); // Succès : on renvoie le résultat
    rq.onerror = _ => ko(rq.error);   // Erreur : on renvoie l'erreur
  }));
}
const DB = {
  add: (s, d) => idb(s, 'readwrite', st => st.add(d)),    // Ajoute un objet dans la table s
  put: (s, d) => idb(s, 'readwrite', st => st.put(d)),    // Met à jour un objet dans la table s
  del: (s, i) => idb(s, 'readwrite', st => st.delete(i)), // Supprime un objet par id
  all: (s)    => idb(s, 'readonly', st => st.getAll()),   // Récupère tous les objets d'une table
  clear: ()   => openDB().then(db => new Promise((ok, ko) => { // Vide toutes les tables
    const tx = db.transaction(['miners', 'investissements', 'gains', 'ventes'], 'readwrite');
    ['miners', 'investissements', 'gains', 'ventes'].forEach(s => tx.objectStore(s).clear());
    tx.oncomplete = _ => ok(); tx.onerror = _ => ko(tx.error);
  }))
};

/* ═════ 3. Taux CoinGecko + valeur GMT 100 % manuelle ═════════ */

state.manual_gmt_usd = localStorage.getItem('manual_gmt_usd') || '';

async function fetchRates(){
  try{
    /* ── 1) BTC + EUR via CoinGecko ─────────────────────────── */
    const url = 'https://api.coingecko.com/api/v3/simple/price' +
                '?ids=bitcoin&vs_currencies=usd,eur';
    const data = await (await fetch(url)).json();

    state.rates.btc_usd = data.bitcoin?.usd || 0;
    state.rates.btc_eur = data.bitcoin?.eur || 0;

    /* conversion USD ↔ EUR (servira à BTC-EUR, GMT-EUR, etc.) */
    if(state.rates.btc_usd && state.rates.btc_eur){
      state.rates.usd_eur = state.rates.btc_eur / state.rates.btc_usd;
      state.rates.eur_usd = 1 / state.rates.usd_eur;
    }

    /* ── 2) GMT toujours tiré du localStorage (valeur manuelle) */
    state.rates.gmt_usd = +state.manual_gmt_usd || 0;
    state.rates.gmt_eur = state.rates.usd_eur
      ? state.rates.gmt_usd * state.rates.usd_eur
      : 0;

  }catch(e){
    console.warn('CoinGecko KO', e);
  }finally{
    /* réaffiche capsules + tuiles dès que les données sont prêtes */
    if(typeof renderCapsules === 'function') renderCapsules();
    if(typeof renderResume   === 'function') renderResume();
  }
}


/* ═════ Capsules de cours (Résumé) ═════ */

/*** Format FR (virgule, 2 décimales max) ***/
const fr = n => Number(n).toLocaleString('fr-FR', {maximumFractionDigits:2, minimumFractionDigits:0});

/*** État local interface ***/
const ratesUI = { invert:false };

/* ── devise selon le libellé ─────────────────────────────── */
function getDevise(label){
  return label.endsWith('USD') ? '$' : '€';
}

/* ── fabrique une capsule ────────────────────────────────── */
const pill = (label,val,editable=false)=>{
  const dev = getDevise(label);
  return editable
  ? `<span class="rate-pill editable">
       <strong>${label}</strong>
       <input id="gmtInput" type="text" inputmode="decimal"
              value="${val.toFixed(4).replace('.',',')}">
       <span class="devise">${dev}</span>
     </span>`
  : `<span class="rate-pill">
       <strong>${label}</strong>
       <span class="rate-val">${fr(val)}</span>
       <span class="devise">${dev}</span>
     </span>`;
};



/*** Bouton rond inverse ***/
const invertBtn = `
  <span id="invert-btn" class="pill-btn" title="Inverser">
    <span data-feather="refresh-cw"></span>
  </span>`;

/*** Rendu principal ***/
function renderCapsules(){
  const bar = document.getElementById('rate-bar');
  if(!bar) return;

  const { btc_usd, gmt_usd, usd_eur, eur_usd } = state.rates;
  const btc_eur = btc_usd && usd_eur ? btc_usd * usd_eur : 0;
  const gmt_eur = gmt_usd && usd_eur ? gmt_usd * usd_eur : 0;

  const capsules = !ratesUI.invert
    ? [                                     //  mode NORMAL
        pill('BTC-USD', btc_usd),
        pill('GMT-USD', gmt_usd, true),      //  seul champ éditable
        pill('EUR-USD', eur_usd)
      ]
    : [                                     //  mode INVERSÉ
        pill('BTC-EUR', btc_eur),
        pill('GMT-EUR', gmt_eur),            //  plus éditable
        pill('USD-EUR', usd_eur)
      ];

  bar.innerHTML = capsules.join('') + `
    <span id="invert-btn" class="pill-btn" title="Inverser">
      <span data-feather="refresh-cw"></span>
    </span>`;

  if(window.feather) feather.replace();
  attachCapsuleEvents();
}


/*** écouteurs *****************************************************/
function attachCapsuleEvents(){

  /* bouton Inverser */
  document.getElementById('invert-btn').onclick = ()=>{
    ratesUI.invert = !ratesUI.invert;
    renderCapsules();
  };

  /* champ GMT (présent uniquement en mode normal) */
  const inp = document.getElementById('gmtInput');
  if(!inp) return;

  const commit = ()=>{
    const num = Number(inp.value.trim().replace(/,/g,'.'));
    if(!num || num<=0) return;

    state.rates.gmt_usd   = num;             // stocke en USD
    state.manual_gmt_usd  = num;
    localStorage.setItem('manual_gmt_usd', num);
    if(state.rates.usd_eur)
      state.rates.gmt_eur = num * state.rates.usd_eur;

    renderCapsules();                        // capsules instantanément
    if(typeof renderResume==='function') renderResume(); // tuiles
  };

  inp.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); commit(); inp.blur(); }
  });
  inp.addEventListener('blur', commit);
}




/*** appel après la mise à jour des taux ***/
fetchRates().then(renderCapsules);

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

/* ═════ 5. Calculs utilitaires ══════════════════════════════ */
function nextMinerId(){const s=new Set(state.miners.map(m=>m.id));let i=1;while(s.has(i))i++;return i;}
const minerExtraCost=id=>state.investissements.filter(i=>i.minerId===id&&!['GMT','CREATION'].includes(i.cat)).reduce((t,i)=>t+i.cost,0);
const minerTotalCost=m=>m.cost+minerExtraCost(m.id);

/* ═════ 6. Rendu UI (tuiles, tableaux, mineurs) ═══════════════════════════ */
/* helper : génère UNE tuile HTML
   t     = titre          (ex. « Puissance totale »)
   icon  = nom Feather    (ex. « cpu »)
   value = contenu centré (texte ou nombre)
   small = <small> optionnel                                          */
const tile = (t, icon, value = '', small = '') => `
  <div class="tile">
    <span class="tile-icon" data-feather="${icon}"></span>
    <h4>${t}</h4>
    <div class="value">${value}</div>
    ${small ? `<small>${small}</small>` : ''}
  </div>`;

function renderResume(){


  // ---------- tuile BTC ----------
  const btcTile = `<div class="tile tile-currency"><h4>BTC</h4><div class="value"><span>${fmt(state.rates.btc_usd,0)}</span><span class="currency">$</span></div><small><span>${fmt(state.rates.btc_eur,0)}</span><span class="currency">€</span></small></div>`;

  // ---------- tuile GMT ----------
  const man  = state.manual_gmt_usd;
  const hasAPI = !man && state.rates.gmt_usd;
  const gmtTile = hasAPI
    ? `<div class="tile tile-currency"><h4>GMT</h4><div class="value"><span>${fmt(state.rates.gmt_usd,2)}</span><span class="currency">$</span></div><small><span>${fmt(state.rates.gmt_eur,2)}</span><span class="currency">€</span></small></div>`
    : `<div class="tile tile-currency" style="position:relative"><h4>GMT</h4><div class="value"><span>N/D</span>${man ? `<span class=\"currency\">$${fmt(man,2)}</span>` : ''}</div><small>Prix manuel $</small><button id="gmtEdit" class="btn" style="position:absolute;top:6px;right:6px"><span data-feather="edit-2"></span></button><input id="gmtInput" type="number" step="0.0001" style="width:90%;margin-top:4px;padding:6px;border:none;border-radius:6px;background:rgba(255,255,255,.15);color:#fff;display:none;" value="${man}"></div>`;

  // ---------- tuile USD/EUR ----------
  const usdTile = `<div class="tile tile-currency"><h4>USD / EUR</h4><div class="value"><span>${state.rates.usd_eur?fmt(state.rates.usd_eur,4):'N/D'}</span><span class="currency">€</span></div><small><span>${state.rates.eur_usd?fmt(state.rates.eur_usd,4):''}</span><span class="currency">$</span></small></div>`;

  $('#rate-tiles').innerHTML=[btcTile,gmtTile,usdTile].join('');

  refreshIcons();

$('#gmtEdit')?.addEventListener('click', () => {
  const inp = $('#gmtInput');
  if (inp) { inp.style.display = 'block'; inp.focus(); }
});

$('#gmtInput')?.addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  state.manual_gmt_usd = (isFinite(v) && v > 0) ? v.toString() : '';

  if (state.manual_gmt_usd) {
    localStorage.setItem('manual_gmt_usd', state.manual_gmt_usd);
    state.rates.gmt_usd = +state.manual_gmt_usd;
    state.rates.gmt_eur = state.rates.usd_eur
                          ? state.rates.gmt_usd * state.rates.usd_eur : 0;
  } else {
    localStorage.removeItem('manual_gmt_usd');
    state.rates.gmt_usd = state.rates.gmt_eur = 0;
  }
  renderResume();
  renderTables();
});



/* ---------- agrégats résumé + tuile Prévisionnel ------------- */
const TH      = state.miners.reduce((s,m)=>s+m.power,0);
const avgEff  = TH ? state.miners.reduce((s,m)=>s+m.power*m.eff,0)/TH : 0;

/* coût total TH = création + ajouts TH/W-TH */
const creationCost = state.miners.reduce((s,m)=>s+m.cost,0);
const thInvestCost = state.investissements
                      .filter(i=>i.cat==='TH'||i.cat==='W/TH')
                      .reduce((s,i)=>s+i.cost,0);
const pricePerTH   = TH ? (creationCost + thInvestCost) / TH : 0;

/* --------- prévisionnel Gains / Frais ------------------------ */
/* gains €/jour = TH × 50 sats × cours BTC-EUR */
const gainDayEUR   = TH * 50 * 1e-8 * state.rates.btc_eur;

/* frais : service + élec (formules Numbers) */
const r  = 1 - state.reduc;                              // réduction
const gU = state.rates.gmt_usd || 1;  // évite /0
const gE = state.rates.gmt_eur;
const servicePerTH = (0.0089 / gU)           * r * gE;
const elecPerTH    = ((0.05*24*avgEff)/gU/1000) * r * gE;
const costDayEUR   = (servicePerTH + elecPerTH) * TH;

const benefDayEUR  = gainDayEUR - costDayEUR;

/* déclinaisons mois / an */
const gainMonthEUR  = gainDayEUR  * 30;
const gainYearEUR   = gainDayEUR  * 365;
const costMonthEUR  = costDayEUR  * 30;
const costYearEUR   = costDayEUR  * 365;
const benefMonthEUR = benefDayEUR * 30;
const benefYearEUR  = benefDayEUR * 365;

/* --------- investissement, ROI, ventes ----------------------- */
const invMiner = state.miners.reduce((s,m)=>s+minerTotalCost(m),0);
const invGMT   = state.investissements.filter(i=>i.cat==='GMT').reduce((s,i)=>s+i.cost,0);
const invTot   = invMiner + invGMT;

const gainSat  = state.gains.reduce((s,g)=>s+g.sats,0);
const gainEUR  = gainSat/1e8 * state.rates.btc_eur;
const roiPct   = invTot ? (gainEUR / invTot) * 100 : 0;

const entGMT   = state.gains.reduce((s,g)=>s+(g.service||0)+(g.elec||0),0);
const entEUR   = entGMT * (state.rates.gmt_eur || 0);

const salesSat = state.ventes.reduce((s,v)=>s+v.sats,0);
const salesEUR = state.ventes.reduce((s,v)=>s+v.montant,0);

/* --------- tuile Prévisionnel (3/5) --------------------------- */
const forecastTile = `
  <div class="tile forecast-tile">
    <span class="summary-badge" data-feather="bar-chart"></span>

    <!-- titre seul -->
    <h4>Prévisionnel</h4>

    <!-- champ réduction DÉPLACÉ sous le titre -->
    <div class="reduc-line">
      réduction :
      <input type="number" id="reducInput"
             step="0.1" min="0" max="100"
             value="${(state.reduc*100).toFixed(2)}"> %
    </div>

    <table class="pv-table">
      <thead><tr><th></th><th>Jour</th><th>Mois</th><th>Année</th></tr></thead>
      <tbody>
        <tr><td>Gains</td>
            <td>${fmt(gainDayEUR,2)} €</td>
            <td>${fmt(gainMonthEUR,2)} €</td>
            <td>${fmt(gainYearEUR,2)} €</td></tr>
        <tr><td>Frais</td>
            <td>${fmt(costDayEUR,2)} €</td>
            <td>${fmt(costMonthEUR,2)} €</td>
            <td>${fmt(costYearEUR,2)} €</td></tr>
        <tr><td><strong>Bénéfices</strong></td>
            <td><strong>${fmt(benefDayEUR,2)} €</strong></td>
            <td><strong>${fmt(benefMonthEUR,2)} €</strong></td>
            <td><strong>${fmt(benefYearEUR,2)} €</strong></td></tr>
      </tbody>
    </table>
  </div>`;

/* --------- tuile Seuil de rentabilité (2/5) ------------------- */
let seuilTxt = '∞';
if (benefYearEUR > 0) {
  const y = invTot / benefYearEUR;
  const a = Math.floor(y);
  const m = Math.floor((y - a) * 12);
  const j = Math.round(((y - a) * 12 - m) * 30);
  seuilTxt = `${a} ${a>1 ? 'ans' : 'an'}, ${m} ${m>1 ? 'mois' : 'mois'} et ${j} ${j>1 ? 'jours' : 'jour'}`;
}

/* calcul local du pourcentage ROI annuel (bénéfices / investissement) */
const roiCirclePct = invTot ? (benefYearEUR / invTot) * 100 : 0;

/* tuile HTML */
const breakEvenTile = `
  <div class="tile break-even-tile">
    <span class="summary-badge" data-feather="clock"></span>
    <h4>Seuil de rentabilité</h4>
    <div class="value break-even-value">${seuilTxt}</div>
    <div class="roi-circle">${fmt(roiCirclePct,1)}%</div>
  </div>`;


/* === tuiles Résumé (icône au-dessus du titre) =============== */
const makeTile = (title, icon, main, small = '') => `
  <div class="tile">
    <span class="tile-icon" data-feather="${icon}"></span>
    <h4>${title}</h4>
    <div class="value">${main}</div>
    ${small ? `<small>${small}</small>` : ''}
  </div>`;


$('#resume-tiles').innerHTML = [

  makeTile('Puissance', 'cpu',
           `${fmt(TH,0)} TH`,
           `${fmt(avgEff,1)} W/TH · ${fmt(pricePerTH,2)} €/TH`),

  makeTile('Entretien', 'tool',
           `${fmt(entGMT,0)} GMT`,
           `${fmt(entEUR,2)} €`),

  makeTile('Investissement', 'dollar-sign',
           `${fmt(invTot,2)} €`,
           `ROI ${fmt(roiPct,1)} %`),

  makeTile('Gains', 'trending-up',
           `${fmt(gainSat,0)} sats`,
           `${fmt(gainEUR,2)} €`),

  makeTile('Ventes', 'check-circle',
           `${fmt(salesSat,0)} sats`,
           `${fmt(salesEUR,2)} €`),

/* prévisionnel  ➜ icône calendrier */
forecastTile,

/* seuil de rentabilité ➜ icône horloge */
breakEvenTile

].join('');


/* écouteur pour la réduction (%) -------------------------------- */
$('#reducInput')?.addEventListener('change', e=>{
  const v = parseFloat(e.target.value);   // valeur saisie en POURCENT
  if (isFinite(v) && v >= 0 && v <= 100) {
    state.reduc = v / 100;                // on stocke la fraction (0–1)
    localStorage.setItem('reduc', state.reduc.toString());
  }
  e.target.value = (state.reduc*100).toFixed(2);   // nouvelle ligne
  // ré-affiche toujours XX,X %
  renderResume();
  renderTables();
});



/* ————— tuiles mineurs ——————————————— */
renderMiners();

}
function renderMiners(){
  $('#miners-grid').innerHTML = state.miners.map(m=>`
    <div class="tile miner-card">
      <span class="miner-badge">${m.id}</span>
      <ul style="margin-top:8px;line-height:1.35">
        <li>${m.power} TH</li><li>${m.eff} W/TH</li>
        <li>${fmt(minerTotalCost(m),2)} €</li><li><small>${m.date}</small></li>
      </ul>
    </div>`).join('');
}

/* ═════ 7. Filtres et tables ═══════════════════════════ */
function populateInvFilters(){
  const years=[...new Set(state.investissements.map(i=>i.date.slice(0,4)))].sort();
  $('#filter-year').innerHTML='<option value="">Année</option>'+years.map(y=>`<option>${y}</option>`).join('');
  $('#filter-month').innerHTML='<option value="">Mois</option>'+
    Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${String(m).padStart(2,'0')}">${m}</option>`).join('');
}
let invFilter={year:'',month:''};
$('#filter-year').addEventListener('change',e=>{invFilter.year=e.target.value;renderTables();});
$('#filter-month').addEventListener('change',e=>{invFilter.month=e.target.value;renderTables();});

const tbodyInv = () => state.investissements
  .filter(i=>(!invFilter.year||i.date.startsWith(invFilter.year))&&(!invFilter.month||i.date.slice(5,7)===invFilter.month))
  .map(i=>`<tr><td>${i.date}</td><td>${i.minerId||'GMT'}</td><td>${i.cat==='CREATION'?'Création':i.cat}</td>
           <td>${i.qty}</td><td>${fmt(i.cost,2)}</td><td>${fmt(i.cost/i.qty,2)}</td>
           <td><button class="btn" data-type="inv-edit" data-id="${i.id}"><span data-feather="edit-2"></span></button>
               <button class="btn danger" data-type="inv-del" data-id="${i.id}"><span data-feather="trash-2"></span></button></td></tr>`).join('');
const tbodyGain= () => state.gains.map(g=>`<tr><td>${g.date}</td><td>${g.sats}</td><td>${g.service}</td><td>${g.elec}</td>
           <td><button class="btn" data-type="gain-edit" data-id="${g.id}"><span data-feather="edit-2"></span></button>
               <button class="btn danger" data-type="gain-del" data-id="${g.id}"><span data-feather="trash-2"></span></button></td></tr>`).join('');
const tbodySale= () => state.ventes.map(s=>`<tr><td>${s.date}</td><td>${s.sats}</td><td>${fmt(s.montant,2)} €</td>
           <td><button class="btn" data-type="sale-edit" data-id="${s.id}"><span data-feather="edit-2"></span></button>
               <button class="btn danger" data-type="sale-del" data-id="${s.id}"><span data-feather="trash-2"></span></button></td></tr>`).join('');

function renderTables(){
  $('#invest-table').innerHTML = tbodyInv();
  $('#gain-table' ).innerHTML = tbodyGain();
  $('#sale-table' ).innerHTML = tbodySale();
  $('#debug-json').textContent=JSON.stringify(state,null,2);
  refreshIcons();
}

/* ═════ 8. Modales (fenêtres pop-up) ════════ */
function showModal(html,onSubmit){
  const ov=$('#modal-overlay'), box=$('#modal-content');
  box.innerHTML=html; ov.classList.remove('hidden'); refreshIcons();
  ov.addEventListener('click',e=>{if(e.target===ov) closeModal();},{once:true});
  box.querySelector('.cancel')?.addEventListener('click',closeModal);
  box.querySelector('form')?.addEventListener('submit',async e=>{
    e.preventDefault(); await onSubmit(new FormData(e.target)); closeModal();
  });
}
const closeModal = () => $('#modal-overlay').classList.add('hidden');

/* ═════ 9. Modales Invest / Gain / Sale ══════════════════════ */
/* ---- helper champs invest ---- */
function investFields(edit,mode){
  if(mode==='new') return`
    <label>Puissance (TH)<input type="number" step="0.01" name="power" value="${edit?.power||''}" required></label>
    <label>Efficacité (W/TH)<input type="number" step="0.01" name="eff" value="${edit?.eff||''}" required></label>
    <label>Coût<input type="number" step="0.01" name="cost" value="${edit?.cost||''}" required></label>`;
  if(mode==='gmt') return`
    <label>Quantité<input type="number" step="0.01" name="qty" value="${edit?.qty||''}" required></label>
    <label>Coût<input type="number" step="0.01" name="cost" value="${edit?.cost||''}" required></label>`;
  const selectedTH  = (edit?.cat ?? 'TH') === 'TH'   ? 'selected' : '';
const selectedWTH = (edit?.cat ?? 'TH') === 'W/TH' ? 'selected' : '';
return `
  <div style="margin-bottom:6px">Catégorie&nbsp;:
    <button type="button" class="cat-btn ${selectedTH}"  data-cat="TH">TH</button>
    <button type="button" class="cat-btn ${selectedWTH}" data-cat="W/TH">W/TH</button>
    <input type="hidden" name="cat" value="${edit?.cat||'TH'}">
  </div>
  <label>Quantité<input type="number" step="0.01" name="qty"  value="${edit?.qty||''}" required></label>
  <label>Coût<input type="number" step="0.01" name="cost" value="${edit?.cost||''}" required></label>`;

}

/* ---- Modale INVEST ---------------------------------------- */
function openInvestModal(edit=null){
  const minerBtns=state.miners.map(m=>`<button type="button" class="btn miner-btn" data-m="${m.id}">${m.id}</button>`).join('');
  const selRow=`${minerBtns}<button type="button" class="btn round primary" data-m="new" title="Ajouter un mineur"><span data-feather="plus-circle"></span></button><button type="button" class="btn gmt-btn" data-m="gmt">GMT</button>`;
  let sel=edit?(edit.minerId||'gmt'):null;
  let mode=sel==='new'?'new':sel==='gmt'?'gmt':sel?'exist':null;

  showModal(`
    <h3>${edit?'Modifier':'Nouvel'} investissement</h3>
    <form>
      <label>Date<input type="date" name="date" value="${edit?edit.date:todayISO()}" required></label>
      <div id="selRow" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${selRow}</div>
      <div id="dyn">${mode?investFields(edit,mode):''}</div>
      <div class="modal-actions"><button type="button" class="btn cancel">Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`,
  async fd=>{
    const date=fd.get('date');

    /* UPDATE */
    if(edit){
      if(sel==='gmt'){
        edit.date=date; edit.qty=+fd.get('qty'); edit.cost=+fd.get('cost'); await DB.put('investissements',edit);
      }else{
        const miner=state.miners.find(m=>m.id==sel);
        if(edit.cat==='TH')   miner.power-=edit.qty;
        if(edit.cat==='W/TH') miner.eff  +=edit.qty;

        const qty=+fd.get('qty'), cost=+fd.get('cost'), cat=fd.get('cat');
        if(cat==='TH')   miner.power+=qty;
        if(cat==='W/TH') miner.eff=Math.max(1,miner.eff-qty);
        await DB.put('miners',miner);

        edit.date=date; edit.qty=qty; edit.cost=cost; edit.cat=cat;
        await DB.put('investissements',edit);
      }
    }
    /* CREATE */
    else{
      if(sel==='new'){
        const id=nextMinerId();
        const newM={id,power:+fd.get('power'),eff:+fd.get('eff'),cost:+fd.get('cost'),date};
        await DB.add('miners',newM); state.miners.push(newM);
        const inv={date,minerId:id,cat:'CREATION',qty:newM.power,cost:newM.cost};
        inv.id=await DB.add('investissements',inv); state.investissements.push(inv);
      }else if(sel==='gmt'){
        const inv={date,minerId:0,cat:'GMT',qty:+fd.get('qty'),cost:+fd.get('cost')};
        inv.id=await DB.add('investissements',inv); state.investissements.push(inv);
      }else{
        const miner=state.miners.find(m=>m.id==sel);
        const cat=fd.get('cat'), qty=+fd.get('qty'), cost=+fd.get('cost');
        if(cat==='TH')   miner.power+=qty;
        if(cat==='W/TH') miner.eff=Math.max(1,miner.eff-qty);
        await DB.put('miners',miner);
        const inv={date,minerId:+sel,cat,qty,cost};
        inv.id=await DB.add('investissements',inv); state.investissements.push(inv);
      }
    }
    populateInvFilters(); renderResume(); renderTables();
  });

  /* sélection dynamique */
  setTimeout(()=>{
    const selDiv = $('#selRow');
    const dyn    = $('#dyn');
    const upd = id => {
      sel  = id;
      mode = id==='new' ? 'new' : id==='gmt' ? 'gmt' : 'exist';
      // Ajout de la classe invest-fields sur le conteneur dynamique
      dyn.className = 'invest-fields';
      dyn.innerHTML = investFields(edit, mode);
      // Boutons catégorie TH / W-TH
      const btns = dyn.querySelectorAll('.cat-btn');
      btns.forEach(b=>{
        b.addEventListener('click', ev=>{
          const val = ev.currentTarget.dataset.cat;
          dyn.querySelector('input[name="cat"]').value = val;
          btns.forEach(x=>x.classList.toggle('selected', x===ev.currentTarget));
        });
      });
      // Surbrillance du bouton sélectionné
      selDiv.querySelectorAll('.miner-btn, .round.primary, .gmt-btn')
            .forEach(b=>b.classList.toggle('selected', b.dataset.m == id));
    };
    if (sel) upd(sel); // pré-sélection si on édite un investissement
    selDiv.addEventListener('click', e=>{
      const btn = e.target.closest('button[data-m]');
      if(btn) upd(btn.dataset.m);
    });
  },0);
}

/* ---- Modale GAIN ----------------------------------------- */
function openGainModal(edit=null){
  showModal(`
    <h3>${edit?'Modifier':'Nouveau'} gain</h3>
    <form>
      <label>Date<input type="date" name="date" value="${edit?edit.date:todayISO()}" required></label>
      <label>Satoshis<input type="number" name="sats" value="${edit?.sats||''}" required></label>
      <label>Service<input type="number" step="0.01" name="service" value="${edit?.service||''}" required></label>
      <label>Électricité<input type="number" step="0.01" name="elec" value="${edit?.elec||''}" required></label>
      <div class="modal-actions"><button type="button" class="btn cancel">Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`,
  async fd=>{
    const date=fd.get('date'), sats=+fd.get('sats'), svc=+fd.get('service'), elc=+fd.get('elec');
    if(edit){
      edit.date=date; edit.sats=sats; edit.service=svc; edit.elec=elc;
      edit.valeur_eur=sats/1e8*state.rates.btc_eur; edit.cout_entretien_eur=(svc+elc)*state.rates.gmt_eur;
      await DB.put('gains',edit);
    }else{
      const g={date,sats,service:svc,elec:elc,
        valeur_eur:sats/1e8*state.rates.btc_eur,
        cout_entretien_eur:(svc+elc)*state.rates.gmt_eur};
      g.id=await DB.add('gains',g); state.gains.push(g);
    }
    renderResume(); renderTables();
  });
}

/* ---- Modale SALE ----------------------------------------- */
function openSaleModal(edit=null){
  showModal(`
    <h3>${edit?'Modifier':'Nouvelle'} vente</h3>
    <form>
      <label>Date<input type="date" name="date" value="${edit?edit.date:todayISO()}" required></label>
      <label>Satoshis vendus<input type="number" name="sats" value="${edit?.sats||''}" required></label>
      <label>Montant<input type="number" step="0.01" name="montant" value="${edit?.montant||''}" required></label>
      <div class="modal-actions"><button type="button" class="btn cancel">Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`,
  async fd=>{
    const date=fd.get('date'), sats=+fd.get('sats'), mnt=+fd.get('montant');
    if(edit){ edit.date=date; edit.sats=sats; edit.montant=mnt; await DB.put('ventes',edit);}
    else{const v={date,sats,montant:mnt};v.id=await DB.add('ventes',v);state.ventes.push(v);}
    renderResume(); renderTables();
  });
}

/* ═════ 10. Gestion clics globaux (DEL/EDIT) ═══════════════ */
async function globalClickHandler(e){
  const btn=e.target.closest('button[data-type]'); if(!btn) return;
  const {type,id}=btn.dataset;
  if(type==='inv-edit')  return openInvestModal(state.investissements.find(i=>i.id==id));
  if(type==='gain-edit') return openGainModal(state.gains.find(i=>i.id==id));
  if(type==='sale-edit') return openSaleModal(state.ventes.find(i=>i.id==id));

  if(!confirm('Supprimer ?')) return;

  if(type==='inv-del'){
    const inv=state.investissements.find(i=>i.id==id);
    if(inv.cat==='CREATION'){
      await DB.del('miners',inv.minerId);
      state.miners=state.miners.filter(m=>m.id!==inv.minerId);
      const linked=state.investissements.filter(i=>i.minerId===inv.minerId);
      for(const l of linked) await DB.del('investissements',l.id);
      state.investissements=state.investissements.filter(i=>i.minerId!==inv.minerId);
    }else{
      const miner=state.miners.find(m=>m.id==inv.minerId);
      if(miner){
        if(inv.cat==='TH')   miner.power-=inv.qty;
        if(inv.cat==='W/TH') miner.eff  +=inv.qty;
        await DB.put('miners',miner);
      }
      await DB.del('investissements',+id);
      state.investissements=state.investissements.filter(i=>i.id!=id);
    }
  }
  if(type==='gain-del'){await DB.del('gains',+id);  state.gains =state.gains.filter(g=>g.id!=id);}
  if(type==='sale-del'){await DB.del('ventes',+id); state.ventes=state.ventes.filter(s=>s.id!=id);}
  renderResume(); renderTables();
}

/* ═════ 11. Icônes, écouteurs, bootstrap ═══════════════════ */
function refreshIcons(){window.feather?.replace();}
(function(){const s=document.createElement('script');s.src='https://unpkg.com/feather-icons';s.onload=refreshIcons;document.head.append(s);})();
$('#add-invest-btn').addEventListener('click',()=>openInvestModal());
$('#add-gain-btn')  .addEventListener('click',()=>openGainModal());
$('#add-sale-btn')  .addEventListener('click',()=>openSaleModal());
$('#reset-db-btn')  .addEventListener('click',()=>{if(confirm('Tout effacer ?')) purgeDB();});
$('#export-json-btn').addEventListener('click',()=>{
  const b=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='gomining.json'; a.click(); URL.revokeObjectURL(u);
});
/* ───── Import JSON ───────────────────────────────── */
$('#import-json-btn').addEventListener('click', async () => {

  /* 1. Sélecteur de fichier .json */
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.click();

  picker.onchange = async () => {
    const file = picker.files[0];
    if (!file) return;

    try {
      /* 2. Lecture + parse */
      const text  = await file.text();
      const data  = JSON.parse(text);

      /* 3. Validation minimale */
      const tables = ['miners','investissements','gains','ventes'];
      if (!tables.every(t => Array.isArray(data[t]))) {
        alert('Fichier incompatible ou incomplet.'); return;
      }

      /* 4. Confirmation + import */
      if (!confirm('Importer ces données et ÉCRASER la base actuelle ?')) return;

      await DB.clear();                       // purge l’IndexedDB
      for (const t of tables)
        for (const row of data[t]) await DB.add(t, row);

      /* 5. Rafraîchissement complet de l’UI */
      await initData();
      populateInvFilters();
      renderResume();
      renderTables();
      alert('Import terminé ✔');
    } catch (err) {
      console.error(err);
      alert('Erreur pendant l’import.');
    }
  };
});

document.body.addEventListener('click',globalClickHandler);
$$('.toggle').forEach(t=>t.addEventListener('click',()=>$('#'+t.dataset.target).classList.toggle('open')));

/* ─ bootstrap ─ */
(async()=>{
  await fetchRates();
  await initData();
  populateInvFilters();
  renderResume();
  renderTables();
})();
