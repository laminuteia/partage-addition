// Partage l'addition : chacun met son prénom, coche ce qu'il a pris et voit ce qu'il doit.
// Toute l'addition se règle dans addition.json. Ce fichier n'a pas besoin d'être modifié.
//
// Fonctionnement :
// - Un Worker Cloudflare sert la page et une petite API (/api/...).
// - Un Durable Object garde l'état commun (qui a coché quoi). Les écritures passent
//   une par une, donc deux personnes qui cochent en même temps ne s'écrasent pas.
// - La page relit l'état toutes les 4 secondes.

import { DurableObject } from "cloudflare:workers";
import ADDITION from "../addition.json";

// Les prix passent en centimes pour éviter les erreurs d'arrondi (0,1 + 0,2 ≠ 0,3).
const centimes = (x) => Math.round(Number(x) * 100);

const LIGNES = ADDITION.lignes.map((l, i) => ({
  id: "l" + i,
  nom: String(l.nom),
  quantite: Math.max(1, Math.round(Number(l.quantite) || 1)),
  prix: centimes(l.prix),
}));

// Une « unité » = un exemplaire d'un plat. 3 cafés = 3 unités, cochables séparément.
const UNITES = LIGNES.flatMap((l) =>
  Array.from({ length: l.quantite }, (_, i) => ({ id: `${l.id}-${i + 1}`, ligne: l.id, prix: l.prix }))
);
const IDS_UNITES = new Set(UNITES.map((u) => u.id));
const TOTAL = UNITES.reduce((s, u) => s + u.prix, 0);
const MAX_PERSONNES = 60;

const nettoyerPrenom = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 30);
const memePrenom = (a, b) => a.toLowerCase() === b.toLowerCase();

export class Addition extends DurableObject {
  async lire() {
    return (await this.ctx.storage.get("etat")) || { personnes: {}, table: [] };
  }

  async traiter(methode, chemin, corps) {
    const etat = await this.lire();
    if (methode !== "POST") return etat;

    if (chemin === "/api/cocher") {
      const prenom = nettoyerPrenom(corps.prenom);
      if (!prenom) return { erreur: "prénom manquant", status: 400 };
      const unites = [...new Set((corps.unites || []).filter((u) => IDS_UNITES.has(u)))];
      const cle = Object.keys(etat.personnes).find((k) => memePrenom(k, prenom)) || prenom;
      if (!(cle in etat.personnes) && Object.keys(etat.personnes).length >= MAX_PERSONNES) {
        return { erreur: "trop de personnes", status: 400 };
      }
      etat.personnes[cle] = unites;
    } else if (chemin === "/api/table") {
      if (!IDS_UNITES.has(corps.unite)) return { erreur: "plat inconnu", status: 400 };
      const table = new Set(etat.table);
      corps.actif ? table.add(corps.unite) : table.delete(corps.unite);
      etat.table = [...table];
    } else if (chemin === "/api/retirer") {
      const prenom = nettoyerPrenom(corps.prenom);
      for (const k of Object.keys(etat.personnes)) if (memePrenom(k, prenom)) delete etat.personnes[k];
    } else {
      return { erreur: "introuvable", status: 404 };
    }

    await this.ctx.storage.put("etat", etat);
    return etat;
  }
}

const json = (d, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      // Une addition = un Durable Object. Changer le titre ou la date repart d'une addition vide.
      const nom = ADDITION.id || `${ADDITION.titre}-${ADDITION.date}`;
      const objet = env.ADDITION.get(env.ADDITION.idFromName(nom));
      const corps = req.method === "POST" ? await req.json().catch(() => ({})) : null;
      const sortie = await objet.traiter(req.method, url.pathname, corps);
      return json(sortie, sortie.status || 200);
    }
    if (url.pathname !== "/") return new Response("Introuvable", { status: 404 });
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
};

// Les données passées à la page, sans le moindre « < » (pour ne jamais fermer le <script>).
const pourScript = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
const echapper = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PAGE = `<!doctype html>
<html lang="${ADDITION.langue === "en" ? "en" : "fr"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${echapper(ADDITION.titre)}</title>
<style>
:root{--bg:#f6f3ee;--card:#fff;--ink:#1d1b18;--mute:#6f685f;--line:#e6e0d6;--acc:#c2410c;--acc2:#fff1e8;--chip:#efe9df}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--card:#1e1b18;--ink:#f1ece4;--mute:#a39b90;--line:#332e28;--acc:#fb923c;--acc2:#3a2416;--chip:#2b2621}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;padding-bottom:110px}
.wrap{max-width:560px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:4px 0 2px}.sub{color:var(--mute);font-size:14px;margin:0 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
label.lbl{font-size:13px;color:var(--mute);display:block;margin-bottom:6px}
input[type=text]{width:100%;font-size:17px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.row{display:flex;gap:10px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0}
.row input[type=checkbox]{width:24px;height:24px;accent-color:var(--acc);flex:none}
.row .main{flex:1;min-width:0}.row .nm{font-weight:600;font-size:15px}
.row .who{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{background:var(--chip);border-radius:99px;padding:1px 8px;font-size:12px;color:var(--mute)}
.chip.me{background:var(--acc2);color:var(--acc)}
.price{font-variant-numeric:tabular-nums;text-align:right;font-size:14px;white-space:nowrap}
.price small{display:block;color:var(--mute);font-size:12px}
.tbl{border:1px solid var(--line);background:transparent;color:var(--mute);border-radius:8px;font-size:12px;padding:5px 7px;flex:none}
.tbl.on{background:var(--acc);border-color:var(--acc);color:#fff}
.row.disabled .nm{color:var(--mute)}
.sum{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
.sum:first-child{border-top:0}.sum.warn{color:var(--acc)}.sum.tot{font-weight:700}
.sum .x{border:0;background:transparent;color:var(--mute);font-size:16px;padding:0 6px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 16px calc(12px + env(safe-area-inset-bottom))}
.bar .in{max-width:560px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px}
.big{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
.btn{display:inline-block;background:var(--acc);color:#fff;text-decoration:none;border:0;border-radius:10px;padding:12px 16px;font-weight:700;font-size:15px}
.kv{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.kv span{color:var(--mute);font-size:13px}.kv b{font-family:ui-monospace,Menlo,monospace;font-size:14px;word-break:break-all}
.copy{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:5px 9px;font-size:12px;flex:none}
.links .btn{width:100%;text-align:center;margin-bottom:10px}
.hint{font-size:13px;color:var(--mute);margin:0 0 6px}
.lang{float:right;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:4px 8px;font-size:13px}
h2{font-size:16px;margin:0 0 8px}
</style></head><body>
<div class="wrap">
  <button class="lang" id="lang"></button>
  <h1 id="titre"></h1>
  <p class="sub" id="t-sub"></p>

  <div class="card">
    <label class="lbl" for="prenom" id="t-prenom"></label>
    <input type="text" id="prenom" autocomplete="given-name" maxlength="30">
  </div>

  <div class="card"><h2 id="t-plats"></h2><p class="hint" id="t-aide"></p><div id="plats"></div></div>

  <div class="card"><h2 id="t-recap"></h2><div id="recap"></div></div>

  <div class="card" id="payer">
    <h2 id="t-payer"></h2>
    <div class="links" id="liens"></div>
    <div id="textes"></div>
  </div>
</div>
<div class="bar"><div class="in"><div><div style="font-size:12px;color:var(--mute)" id="t-part"></div><div class="big" id="mapart">0</div></div><a class="btn" href="#payer" id="t-bouton"></a></div></div>

<script>
const A=${pourScript({
  titre: ADDITION.titre,
  date: ADDITION.date,
  personnes: Math.max(1, Math.round(Number(ADDITION.personnes) || 1)),
  devise: ADDITION.devise || "EUR",
  langue: ADDITION.langue === "en" ? "en" : "fr",
  payeur: ADDITION.payeur || "",
  paiements: ADDITION.paiements || [],
})};
const LIGNES=${pourScript(LIGNES)}, TOTAL=${TOTAL}, N=A.personnes;
const T={
 fr:{sub:(d,t)=>"Addition du "+d+" · "+t+" · "+N+" personnes",prenom:"Ton prénom",plats:"Coche ce que tu as pris",
  aide:"Plusieurs personnes peuvent cocher le même plat : il est divisé entre elles. « Table » = partagé entre les "+N+".",
  recap:"Qui doit quoi",payer:"Rembourser "+A.payeur,part:"Ta part",bouton:"Payer",table:"Table",
  libre:"Pas encore attribué",total:"Total de l'addition",copie:"copié",copier:"copier",
  prenomDabord:"Mets ton prénom d'abord",partageTable:"partagé à "+N,retirer:"Retirer cette personne ?",
  manquent:n=>n+" × ? (table)",parPers:"/ pers.",autre:"EN"},
 en:{sub:(d,t)=>"Bill of "+d+" · "+t+" · "+N+" people",prenom:"Your first name",plats:"Tick what you had",
  aide:"Several people can tick the same dish: it is split between them. \\"Table\\" = shared by all "+N+".",
  recap:"Who owes what",payer:"Pay back "+A.payeur,part:"Your share",bouton:"Pay",table:"Table",
  libre:"Not claimed yet",total:"Bill total",copie:"copied",copier:"copy",
  prenomDabord:"Enter your name first",partageTable:"split by "+N,retirer:"Remove this person?",
  manquent:n=>n+" × ? (table)",parPers:"/ person",autre:"FR"}};
const memo={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
let langue=memo.get("langue")||A.langue;
let E={personnes:{},table:[]};
const $=id=>document.getElementById(id);
const argent=c=>new Intl.NumberFormat(langue==="fr"?"fr-FR":"en-GB",{style:"currency",currency:A.devise}).format(c/100);
const dateLisible=()=>{const d=new Date(A.date+"T12:00:00");return isNaN(d)?A.date:d.toLocaleDateString(langue==="fr"?"fr-FR":"en-GB")};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const unites=[];LIGNES.forEach(l=>{for(let i=1;i<=l.quantite;i++)unites.push({id:l.id+"-"+i,ligne:l,i})});
const moi=()=>$("prenom").value.trim().replace(/\\s+/g," ");
const maCle=()=>Object.keys(E.personnes).find(k=>k.toLowerCase()===moi().toLowerCase());
const mesUnites=()=>new Set(E.personnes[maCle()]||[]);

function parts(){
  const table=new Set(E.table),doit={};Object.keys(E.personnes).forEach(p=>doit[p]=0);
  let totalTable=0,libre=0;
  unites.forEach(u=>{
    const prix=u.ligne.prix;
    if(table.has(u.id)){totalTable+=prix;return}
    const qui=Object.keys(E.personnes).filter(p=>E.personnes[p].includes(u.id));
    if(!qui.length){libre+=prix;return}
    qui.forEach(p=>doit[p]+=prix/qui.length);
  });
  const parTete=totalTable/N;
  Object.keys(doit).forEach(p=>doit[p]+=parTete);
  return {doit,parTete,libre};
}

function afficher(){
  const t=T[langue];
  document.documentElement.lang=langue;
  $("titre").textContent=A.titre;
  $("lang").textContent=t.autre;
  $("t-sub").textContent=t.sub(dateLisible(),argent(TOTAL));
  ["prenom","plats","aide","recap","payer","part","bouton"].forEach(k=>$("t-"+k).textContent=t[k]);
  const miens=mesUnites(),table=new Set(E.table);
  $("plats").innerHTML=unites.map(u=>{
    const qui=Object.keys(E.personnes).filter(p=>E.personnes[p].includes(u.id));
    const surTable=table.has(u.id);
    const nom=u.ligne.nom+(u.ligne.quantite>1?" · "+u.i+"/"+u.ligne.quantite:"");
    const detail=surTable?t.partageTable:(qui.length>1?"÷"+qui.length+" = "+argent(Math.round(u.ligne.prix/qui.length)):"");
    const pastilles=surTable?'<span class="chip me">'+t.table+'</span>':qui.map(p=>'<span class="chip'+(p===maCle()?" me":"")+'">'+esc(p)+'</span>').join("");
    return '<div class="row'+(surTable?" disabled":"")+'"><input type="checkbox" data-u="'+u.id+'"'+(miens.has(u.id)&&!surTable?" checked":"")+(surTable?" disabled":"")+'>'+
      '<div class="main"><div class="nm">'+esc(nom)+'</div><div class="who">'+pastilles+'</div></div>'+
      '<div class="price">'+argent(u.ligne.prix)+(detail?'<small>'+detail+'</small>':'')+'</div>'+
      '<button class="tbl'+(surTable?" on":"")+'" data-t="'+u.id+'">'+t.table+'</button></div>';
  }).join("");
  const {doit,parTete,libre}=parts();
  const noms=Object.keys(doit).sort((a,b)=>a.localeCompare(b));
  let html=noms.map(p=>'<div class="sum"><span>'+esc(p)+'</span><span><b>'+argent(Math.round(doit[p]))+'</b><button class="x" data-retirer="'+esc(p)+'" aria-label="x">×</button></span></div>').join("");
  const manquent=N-noms.length;
  if(manquent>0&&parTete>0)html+='<div class="sum warn"><span>'+t.manquent(manquent)+'</span><span>'+argent(Math.round(parTete))+' '+t.parPers+'</span></div>';
  if(libre>0)html+='<div class="sum warn"><span>'+t.libre+'</span><b>'+argent(libre)+'</b></div>';
  html+='<div class="sum tot"><span>'+t.total+'</span><b>'+argent(TOTAL)+'</b></div>';
  $("recap").innerHTML=html;
  const k=maCle();
  $("mapart").textContent=argent(Math.round(k?doit[k]:parTete));
  $("liens").innerHTML=A.paiements.filter(p=>p.lien&&/^https?:\\/\\//.test(p.lien)).map(p=>'<a class="btn" target="_blank" rel="noopener" href="'+esc(p.lien)+'">'+esc(p.nom)+'</a>').join("");
  $("textes").innerHTML=A.paiements.filter(p=>p.texte).map(p=>'<div class="kv"><div><span>'+esc(p.nom)+'</span><br><b>'+esc(p.texte)+'</b></div><button class="copy" data-c="'+esc(String(p.texte).replace(/\\s+/g,""))+'">'+t.copier+'</button></div>').join("");
}

async function api(chemin,corps){
  const r=await fetch(chemin,corps?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(corps)}:{cache:"no-store"});
  if(r.ok){E=await r.json();afficher()}
}
let occupe=false;
document.addEventListener("change",async e=>{
  const u=e.target.dataset&&e.target.dataset.u;if(!u)return;
  if(!moi()){e.target.checked=false;demanderPrenom();return}
  const s=mesUnites();e.target.checked?s.add(u):s.delete(u);
  occupe=true;await api("/api/cocher",{prenom:moi(),unites:[...s]});occupe=false;
});
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-t]");
  if(t){if(!moi()){demanderPrenom();return}occupe=true;await api("/api/table",{unite:t.dataset.t,actif:!t.classList.contains("on")});occupe=false;return}
  const x=e.target.closest("[data-retirer]");
  if(x){if(confirm(T[langue].retirer+" ("+x.dataset.retirer+")")){occupe=true;await api("/api/retirer",{prenom:x.dataset.retirer});occupe=false}return}
  const c=e.target.closest("[data-c]");
  if(c){navigator.clipboard&&navigator.clipboard.writeText(c.dataset.c);const o=c.textContent;c.textContent=T[langue].copie;setTimeout(()=>c.textContent=o,1200);return}
  if(e.target.id==="lang"){langue=langue==="fr"?"en":"fr";memo.set("langue",langue);afficher()}
});
function demanderPrenom(){const n=$("prenom");n.focus();n.placeholder=T[langue].prenomDabord;n.style.borderColor="var(--acc)"}
$("prenom").value=memo.get("prenom")||"";
$("prenom").addEventListener("input",()=>{memo.set("prenom",moi());$("prenom").style.borderColor="";afficher()});
$("prenom").addEventListener("change",()=>{if(moi()&&!maCle())api("/api/cocher",{prenom:moi(),unites:[]})});
afficher();api("/api/etat");
setInterval(()=>{if(!occupe&&document.visibilityState==="visible")api("/api/etat")},4000);
</script>
</body></html>`;
