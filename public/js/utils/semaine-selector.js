// ============================================================
// Util reutilisable : selecteur de semaine (courante + cloturees)
// ============================================================
// Usage typique sur une page :
//
//   import { initSemaineSelector } from '../utils/semaine-selector.js';
//
//   const sel = await initSemaineSelector('#selecteur-semaine', {
//     storageKey: 'ventes-semaine',
//     onChange: ({ weekKey, debut, fin, statut, isCurrent, semaine }) => {
//       rechargerAvec(debut, fin, isCurrent);
//     }
//   });
//
// L'option selectionnee est restauree depuis sessionStorage au chargement
// (cle = storageKey). Si la semaine en cache n'existe plus, fallback "current".
// ============================================================

import { listSemaines } from '../api.js';
import {
  startOfWeekRP, endOfWeekRP, weekRangeFromKey, weekIsoLabel, weekIsoNumber
} from './formatters.js';

const STATUT_LABEL = {
  'cloturee':           'Clôturée',
  'cloturee-manuelle':  'Clôturée (manuelle)',
  'cloturee-partielle': 'Clôture partielle'
};

function fmtDateShort(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function fmtDateLong(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Construit le payload livre au onChange (utilise par le caller pour recharger)
function buildPayload(weekKey, semaine) {
  if (!weekKey || weekKey === 'current') {
    const debut = startOfWeekRP();
    const fin = endOfWeekRP();
    return {
      weekKey: 'current',
      debut, fin,
      statut: 'en-cours',
      statutLabel: 'En cours',
      isCurrent: true,
      semaine: null
    };
  }
  // Privilegie les dates exactes du doc Firestore, fallback sur reconstruction
  const debut = semaine?.dateDebut?.toDate?.() || weekRangeFromKey(weekKey).debut;
  const fin   = semaine?.dateFin?.toDate?.()   || weekRangeFromKey(weekKey).fin;
  return {
    weekKey,
    debut, fin,
    statut: semaine?.statut || 'cloturee',
    statutLabel: STATUT_LABEL[semaine?.statut] || 'Clôturée',
    isCurrent: false,
    semaine: semaine || null
  };
}

/**
 * Initialise un <select> avec la semaine en cours + N dernieres cloturees.
 * @param {string} targetSelector - selecteur CSS de l'element <select>
 * @param {object} opts
 * @param {function} opts.onChange - callback({ weekKey, debut, fin, statut, statutLabel, isCurrent, semaine })
 * @param {string} [opts.storageKey='semaine-selector'] - cle sessionStorage
 * @param {boolean} [opts.includeCurrent=true] - inclut option "Semaine en cours"
 * @param {number} [opts.limit=20] - nombre max de semaines historiques
 * @returns {Promise<{ el: HTMLSelectElement, semaines: Array, current: object }>}
 */
export async function initSemaineSelector(targetSelector, {
  onChange,
  storageKey = 'semaine-selector',
  includeCurrent = true,
  limit = 20,
  defaultLastClosed = false
} = {}) {
  const el = typeof targetSelector === 'string'
    ? document.querySelector(targetSelector)
    : targetSelector;
  if (!el) {
    console.warn('[semaine-selector] cible introuvable:', targetSelector);
    return { el: null, semaines: [], current: buildPayload('current', null) };
  }

  let semaines = [];
  try {
    semaines = await listSemaines(limit);
  } catch (e) {
    console.warn('[semaine-selector] listSemaines a echoue:', e);
  }

  // Build options
  const opts = [];
  if (includeCurrent) {
    const d = startOfWeekRP();
    const f = endOfWeekRP();
    const numIso = weekIsoNumber(d);
    opts.push(`<option value="current">Semaine ${numIso} (en cours) — du ${fmtDateShort(d)} au ${fmtDateLong(f)}</option>`);
  }
  for (const s of semaines) {
    const wk = s.id || s.numero;
    if (!wk) continue;
    const lbl = STATUT_LABEL[s.statut] || s.statut || '';
    // weekIsoLabel(wk, { long: true }) => "Semaine 20 du lundi 11/05 au dimanche 17/05/2026"
    opts.push(`<option value="${wk}">${weekIsoLabel(wk, { long: true })} ${lbl ? '— ' + lbl : ''}</option>`);
  }
  el.innerHTML = opts.join('') || '<option value="current">Semaine en cours</option>';

  // Restaure choix depuis sessionStorage
  let initial = 'current';
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored && [...el.options].some(o => o.value === stored)) {
      initial = stored;
    } else if (defaultLastClosed && semaines.length) {
      // Créneau de paie : lundi/mardi (après la clôture dominicale), la "semaine
      // en cours" vient de commencer et est encore VIDE. On ouvre par défaut sur
      // la dernière semaine clôturée (= celle à payer) au lieu de la semaine vide.
      const jour = new Date().getDay(); // 1 = lundi, 2 = mardi
      if (jour === 1 || jour === 2) {
        const wk = semaines[0].id || semaines[0].numero;
        if (wk && [...el.options].some(o => o.value === wk)) initial = wk;
      }
    }
  } catch {}
  el.value = initial;

  // Build map id -> semaine pour retrouver vite
  const byId = {};
  for (const s of semaines) byId[s.id || s.numero] = s;

  function fire() {
    const wk = el.value;
    try { sessionStorage.setItem(storageKey, wk); } catch {}
    const payload = buildPayload(wk, byId[wk]);
    onChange?.(payload);
  }

  el.addEventListener('change', fire);

  // Premier appel synchrone (livre le payload courant tout de suite au caller)
  const current = buildPayload(initial, byId[initial]);
  onChange?.(current);

  return { el, semaines, current };
}
