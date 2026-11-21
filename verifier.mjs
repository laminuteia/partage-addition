// Vérifie addition.json avant la mise en ligne : champs présents, prix lisibles,
// et surtout que la somme des lignes donne bien le total du ticket.
// Lancer : npm run verifier
import { readFileSync } from "node:fs";

const a = JSON.parse(readFileSync(new URL("./addition.json", import.meta.url), "utf8"));
const erreurs = [];
const c = (x) => Math.round(Number(x) * 100);

if (!a.titre) erreurs.push("« titre » manquant");
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ""))) erreurs.push("« date » doit s'écrire AAAA-MM-JJ, par ex. 2026-11-21");
if (!(Number.isInteger(a.personnes) && a.personnes > 0)) erreurs.push("« personnes » doit être un nombre entier, par ex. 6");
if (!/^[A-Z]{3}$/.test(String(a.devise || ""))) erreurs.push("« devise » doit être un code à 3 lettres, par ex. EUR");
if (!a.payeur) erreurs.push("« payeur » manquant : le prénom de la personne qui a payé");
if (!Array.isArray(a.lignes) || !a.lignes.length) erreurs.push("« lignes » est vide");

let somme = 0;
(a.lignes || []).forEach((l, i) => {
  const n = `ligne ${i + 1} (${l.nom || "sans nom"})`;
  if (!l.nom) erreurs.push(`${n} : « nom » manquant`);
  if (!(Number.isInteger(l.quantite) && l.quantite > 0)) erreurs.push(`${n} : « quantite » doit être un entier`);
  if (!(Number(l.prix) > 0)) erreurs.push(`${n} : « prix » doit être le prix d'UN exemplaire, par ex. 4.5`);
  somme += c(l.prix) * (l.quantite || 0);
});

for (const p of a.paiements || []) {
  if (p.lien && !/^https?:\/\//.test(p.lien)) erreurs.push(`paiement « ${p.nom} » : le lien doit commencer par https://`);
  if (p.lien && /exemple\.com/.test(p.lien)) erreurs.push(`paiement « ${p.nom} » : remplace le lien d'exemple par le tien`);
  if (p.texte && /0000 0000/.test(p.texte)) erreurs.push(`paiement « ${p.nom} » : remplace le texte d'exemple par le tien`);
}

if (a.total_ticket !== undefined && c(a.total_ticket) !== somme) {
  erreurs.push(`la somme des lignes (${(somme / 100).toFixed(2)}) ne donne pas le total du ticket (${Number(a.total_ticket).toFixed(2)}) : relis les quantités et les prix`);
}

if (erreurs.length) {
  console.error("addition.json à corriger :\n- " + erreurs.join("\n- "));
  process.exit(1);
}
console.log(`addition.json est bon : ${a.lignes.length} lignes, total ${(somme / 100).toFixed(2)} ${a.devise}, ${a.personnes} personnes.`);
