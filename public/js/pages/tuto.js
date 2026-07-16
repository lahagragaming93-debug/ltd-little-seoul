// ============================================================
// Page : Tutoriels par rôle
// ============================================================
// 4 tutos slides : pompiste, vendeur, responsable-pompiste,
// responsable-vente. Chaque employé voit le sien par défaut, la
// direction + DRH peuvent basculer entre les 4 via un dropdown
// (utile pour former un nouvel employé : le patron feuillette à
// côté de lui).
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { isDirection, isSuperAdmin, isPompiste, isVendeur } from '../utils/permissions.js';

const { profile } = await requireAuth('tuto');

const canSeeAll = isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh';

// Tuto par defaut selon le role
function defaultTutoKey(role) {
  if (isPompiste(role) || role === 'responsable-pompiste') {
    return role === 'responsable-pompiste' ? 'resp-pompiste' : 'pompiste';
  }
  if (role === 'chef-equipe') return 'resp-vente';
  if (isVendeur(role) || role === 'responsable-vente' || role === 'livreur') {
    return role === 'responsable-vente' ? 'resp-vente' : 'vendeur';
  }
  return 'pompiste';
}

// ============================================================
// CONTENU TUTOS — chaque slide = { emoji, title, body (HTML) }
// ============================================================

const TUTOS = {

  // ============ POMPISTE ============
  pompiste: {
    label: 'Pompiste',
    color: '#5a8',
    slides: [
      {
        emoji: '01',
        title: 'Bienvenue chez LTD Little Seoul',
        body: `
          <p>Salut <strong>${profile.prenom || 'collègue'}</strong> ! Tu rejoins l'équipe <strong>pompiste</strong> de Little Seoul.</p>
          <p>Ton boulot : faire tourner les <strong>8 stations essence</strong> du LTD + fabriquer les <strong>caoutchoucs</strong> pour la production de pneus.</p>
          <div class="tuto-callout">
            Ce tuto t'explique <strong>toute la procédure</strong> : ce que tu fais en RP (in-game) ET sur la tablette du site.<br>
            Garde-le sous la main, tu peux le revoir n'importe quand depuis le bouton Tutoriel sur ton espace.
          </div>
        `
      },
      {
        emoji: '02',
        title: 'Ton rôle en 30 secondes',
        body: `
          <p>Tu as <strong>2 missions principales</strong> :</p>
          <ul>
            <li><strong>Ravitailler les 8 stations</strong> quand leur stock baisse — c'est ce qui permet aux clients d'acheter du carburant</li>
            <li><strong>Fabriquer les caoutchoucs</strong> à l'atelier — le LTD les revend ensuite à des acheteurs pro</li>
          </ul>
          <p>Tu travailles en <strong>autonomie</strong>. Ton salaire dépend directement de ce que tu produis dans la semaine.</p>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> une semaine sans rien produire = avertissement automatique en fin de semaine. 3 averts = compte bloqué.
          </div>
        `
      },
      {
        emoji: '03',
        title: 'Étape 1 — Récupérer les bidons',
        body: `
          <p><span class="ig">EN JEU</span> Rends-toi aux <strong>stocks de bidons d'essence</strong> du LTD.</p>
          <p>Prends le nombre de bidons que tu prévois de redistribuer dans les stations. Chaque bidon = <strong>15 litres</strong>.</p>
          <div class="tuto-callout info">
            <strong>Astuce :</strong> avant de partir, jette un œil sur la tablette → "Stations essence" pour repérer les stations <strong>sous seuil</strong> (en alerte rouge) — ce sont elles à prioriser.
          </div>
        `
      },
      {
        emoji: '04',
        title: 'Étape 2 — Ravitailler la station',
        body: `
          <p><span class="ig">EN JEU</span> Va à la station essence à ravitailler.</p>
          <ol>
            <li>Approche-toi du menu de ravitaillement de la station</li>
            <li><strong>Saisis le nombre de bidons</strong> que tu veux ajouter</li>
            <li>Confirme — le stock IG de la station se met à jour</li>
          </ol>
          <p>Retiens bien combien de bidons tu as mis : tu vas devoir le déclarer juste après sur la tablette.</p>
          <div class="tuto-callout">
            <strong>Astuce :</strong> tu peux ravitailler plusieurs stations à la suite avant de déclarer — pense juste à noter combien à chaque arrêt.
          </div>
        `
      },
      {
        emoji: '05',
        title: 'Étape 3 — Déclarer sur la tablette',
        body: `
          <p><span class="site">SUR LE SITE</span> Une fois la station ravitaillée, déclare immédiatement :</p>
          <ol>
            <li>Ouvre la tablette LTD</li>
            <li>Va sur <strong>"Mon espace"</strong></li>
            <li>Clique sur le bouton <strong>"Ravitailler une station"</strong></li>
            <li>Sélectionne la station que tu viens de remplir</li>
            <li>Saisis le <strong>nombre de bidons</strong> ajoutés (<em>pas en litres</em> — le site convertit tout seul)</li>
            <li>Valide → le stock de la station se met à jour et ton quota augmente</li>
          </ol>
          <div class="tuto-callout">
            <strong>Pourquoi déclarer ?</strong> C'est la seule façon que ton quota grimpe et que ta paie soit calculée correctement. Pas de déclaration = pas de salaire.
          </div>
        `
      },
      {
        emoji: '06',
        title: 'Caoutchoucs — production',
        body: `
          <p><span class="ig">EN JEU</span> À l'<strong>atelier LTD</strong>, fabrique des caoutchoucs :</p>
          <ol>
            <li>Récupère la matière première (selon procédure RP)</li>
            <li>Lance la production à l'établi</li>
            <li>Dépose les caoutchoucs finis dans le <strong>coffre dédié</strong> (NE LES GARDE PAS SUR TOI)</li>
          </ol>
          <p><span class="site">SUR LE SITE</span> Ouvre <strong>"Mon espace"</strong> → bouton <strong>"Déclarer des caoutchoucs"</strong> → saisis le nombre produit.</p>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> si le patron a désactivé les caoutchoucs cette semaine (quota = 0), le bouton sera grisé. Concentre-toi sur les bidons dans ce cas.
          </div>
        `
      },
      {
        emoji: '07',
        title: 'Comment ton salaire est calculé',
        body: `
          <p>Quota hebdomadaire (du <strong>lundi 00h00</strong> au <strong>dimanche 23h59</strong>) :</p>
          <ul>
            <li><strong>1700 bidons</strong> (modifiable par la direction selon la semaine)</li>
            <li><strong>800 caoutchoucs</strong> (idem)</li>
          </ul>
          <p>Formule : <strong>moyenne des 2 quotas × plafond ton rôle</strong></p>
          <ul>
            <li>Pompiste novice : plafond <strong>13 000 $</strong></li>
            <li>Pompiste intermédiaire : <strong>14 000 $</strong></li>
            <li>Pompiste expérimenté : <strong>15 000 $</strong></li>
          </ul>
          <div class="tuto-callout">
            <strong>Astuce :</strong> atteindre les <strong>2 quotas à 100%</strong> = plafond max. Si tu en fais qu'un, tu touches déjà la moitié. Si un quota est désactivé (= 0), l'autre porte le plafond entier.
          </div>
        `
      },
      {
        emoji: '08',
        title: 'Note de frais — essence véhicule LTD',
        body: `
          <p>Il arrive que tu doives <strong>avancer de ta poche</strong> l'essence d'un véhicule LTD (camion, voiture de service…). Tu te fais rembourser via le site.</p>
          <p>Procédure :</p>
          <ol>
            <li><span class="ig">EN JEU</span> Mets l'essence dans le véhicule</li>
            <li><span class="ig">EN JEU</span> <strong>Prends un screenshot</strong> de la confirmation IG (touche écran de ta config)</li>
            <li><span class="site">SUR LE SITE</span> "Mon espace" → bouton <strong>"Note de frais essence"</strong></li>
            <li>Saisis le montant avancé + <strong>colle le screenshot (Ctrl+V)</strong> dans la zone prévue</li>
            <li>Envoie la note → le patron valide et te rembourse en fin de semaine</li>
          </ol>
          <div class="tuto-callout">
            <strong>Astuce :</strong> tu peux suivre l'état de tes notes dans la section <strong>"Mes notes de frais essence"</strong> en bas de ton espace : en attente / approuvée / remboursée / rejetée.
          </div>
        `
      },
      {
        emoji: '09',
        title: 'Cas spécial — corriger un stock',
        body: `
          <p>Il peut arriver qu'il y ait un <strong>écart</strong> entre le stock affiché sur le site et la valeur réelle in-game (déconnexion au mauvais moment, bug, etc.).</p>
          <p>Sur "Mon espace" → bouton <strong>"Corriger un stock"</strong> :</p>
          <ul>
            <li>Sélectionne la station concernée</li>
            <li>Saisis la <strong>valeur réelle IG</strong> en litres</li>
            <li>Donne une <strong>raison détaillée</strong> (5 caractères min, sera lue par la direction)</li>
          </ul>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> une <strong>alerte est envoyée à la direction</strong> à chaque correction. C'est pour l'audit. N'abuse pas — utilise uniquement en cas d'écart vérifié.
          </div>
        `
      },
      {
        emoji: '10',
        title: 'Avertissements & blocage',
        body: `
          <p>Le système de sanctions est <strong>automatique</strong> :</p>
          <ul>
            <li>Quota hebdo non atteint à la clôture (lundi 00h00) → <strong>1 avertissement auto</strong></li>
            <li>3 avertissements actifs = <strong>compte bloqué</strong> — tu peux consulter le site mais aucune déclaration n'est possible</li>
            <li>Seul le patron peut <strong>retirer un avert</strong> manuellement</li>
          </ul>
          <div class="tuto-callout danger">
            <strong>Important :</strong> compte bloqué = plus de paie estimée tant que ce n'est pas débloqué. Préviens la direction.
          </div>
          <p>Tes avertissements actifs s'affichent en haut de ton espace.</p>
        `
      },
      {
        emoji: '11',
        title: 'C\'est parti !',
        body: `
          <p>Tu as toutes les cartes en main. Récap des boutons que tu trouveras sur <strong>"Mon espace"</strong> :</p>
          <ul>
            <li><strong>Ravitailler une station</strong> — déclare chaque ravitaillement</li>
            <li><strong>Déclarer des caoutchoucs</strong> — déclare la production</li>
            <li><strong>Corriger un stock</strong> — uniquement en cas d'écart</li>
            <li><strong>Note de frais essence</strong> — avance perso à rembourser</li>
          </ul>
          <p>Et plus bas tu suivras en temps réel :</p>
          <ul>
            <li>Tes <strong>quotas atteints</strong> + score + salaire estimé</li>
            <li>L'état des <strong>stations</strong> (sous seuil = rouge, à ravitailler en priorité)</li>
            <li>Tes <strong>ravitaillements de la semaine</strong> avec total litres</li>
            <li>Tes <strong>notes de frais</strong> en cours</li>
          </ul>
          <div class="tuto-callout">
            Bonne route, et n'hésite pas à demander à ton responsable pompiste ou à la direction si tu as un doute !
          </div>
        `
      }
    ]
  },

  // ============ VENDEUR ============
  vendeur: {
    label: 'Vendeur',
    color: '#e6c388',
    slides: [
      {
        emoji: '01',
        title: 'Bienvenue chez LTD Little Seoul',
        body: `
          <p>Salut <strong>${profile.prenom || 'collègue'}</strong> ! Tu rejoins l'équipe <strong>vente</strong> du LTD.</p>
          <p>Tu vas vendre les produits de l'épicerie LTD aux clients qui se présentent en magasin.</p>
          <div class="tuto-callout">
            Ce tuto t'explique <strong>toute la procédure</strong> de vente : RP en jeu + déclaration sur la tablette pour que ta commission soit bien calculée.
          </div>
        `
      },
      {
        emoji: '02',
        title: 'Ton rôle en 30 secondes',
        body: `
          <p>Ta mission :</p>
          <ul>
            <li><strong>Accueillir les clients</strong> dans le magasin LTD</li>
            <li><strong>Vendre les produits</strong> de l'inventaire (épicerie + autres)</li>
            <li><strong>Déclarer chaque vente</strong> sur la tablette (pour que ta commission soit calculée)</li>
          </ul>
          <p>Ton salaire est <strong>une commission</strong> sur le CA que tu génères.</p>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> ce qui n'est pas déclaré n'est <strong>pas commissionné</strong>. Si tu zappes la déclaration, tu travailles gratos.
          </div>
        `
      },
      {
        emoji: '03',
        title: 'Étape 1 — Accueillir le client',
        body: `
          <p><span class="ig">EN JEU</span> Quand un client entre dans le magasin :</p>
          <ol>
            <li>Salue-le poliment</li>
            <li>Demande-lui ce qu'il cherche</li>
            <li>Conseille-le si besoin (le RP qualitatif est valorisé)</li>
            <li>Note dans ta tête le total à encaisser</li>
          </ol>
          <div class="tuto-callout">
            <strong>Astuce :</strong> les <strong>clients pro / entreprises</strong> prennent rendez-vous via Discord avec la direction — ils ne passent jamais directement par toi. Tu n'as donc affaire qu'à des <strong>particuliers</strong>.
          </div>
        `
      },
      {
        emoji: '04',
        title: 'Étape 2 — Encaisser puis remettre',
        body: `
          <p>Ordre <strong>obligatoire</strong> pour chaque vente :</p>
          <ol>
            <li><span class="ig">EN JEU</span> Prends connaissance des produits demandés par le client</li>
            <li><span class="ig">EN JEU</span> Encaisse le client : crée la facture, il paie</li>
            <li><span class="site">SUR LE SITE</span> Valide la déclaration de vente sur ta tablette (détail produits)</li>
            <li><span class="ig">EN JEU</span> <strong>Maintenant seulement</strong>, remets les produits au client</li>
          </ol>
          <div class="tuto-callout danger">
            <strong>Règle d'or : pas de paiement, pas de produit.</strong><br>
            Tu encaisses TOUJOURS avant de donner la marchandise. Pas d'exception, pas de "je te paie après". Si le client refuse, il sort sans rien.
          </div>
          <div class="tuto-callout info">
            <strong>Important :</strong> le bot Discord remonte automatiquement la facture sur le site dans la minute → tu n'as plus qu'à cliquer "Déclarer" pour détailler les produits.
          </div>
        `
      },
      {
        emoji: '05',
        title: 'Étape 3 — Déclarer le détail sur la tablette',
        body: `
          <p><span class="site">SUR LE SITE</span> Sur <strong>"Mon espace"</strong>, tu verras un bloc orange <strong>"Ventes à déclarer"</strong> avec toutes tes factures non encore détaillées.</p>
          <ol>
            <li>Clique sur <strong>"Déclarer"</strong> à droite de la facture</li>
            <li>Sélectionne les <strong>produits vendus</strong> (le stock se décrémente automatiquement)</li>
            <li>Vérifie le moyen de paiement (espèces, virement, banque)</li>
            <li>Valide</li>
          </ol>
          <div class="tuto-callout">
            Une fois déclaré : ta commission est calculée, le stock à jour, la vente verrouillée. <strong>Ensuite</strong> seulement tu remets le produit au client.
          </div>
        `
      },
      {
        emoji: '06',
        title: 'Cas particulier — déclarer une vente à la main',
        body: `
          <p>Dans 99 % des cas, la facture remonte toute seule via le bot Discord et tu cliques juste "Déclarer". Mais parfois (bug, oubli, vente RP en livraison), tu dois saisir la vente <strong>entièrement à la main</strong>.</p>
          <p><span class="site">SUR LE SITE</span> Bouton <strong>"Déclarer une vente"</strong> en haut de "Mon espace" :</p>
          <ol>
            <li>Choisis les produits dans le menu</li>
            <li>Renseigne le client (nom RP)</li>
            <li>Précise le paiement</li>
            <li>Valide</li>
          </ol>
          <div class="tuto-callout info">
            <strong>Astuce :</strong> n'utilise cette méthode que <strong>si tu n'as pas pu faire la facture in-game</strong>. Le flow normal (facture IG + déclaration sur la tablette) reste toujours à privilégier.
          </div>
        `
      },
      {
        emoji: '07',
        title: 'Ta paie — 2 composantes',
        body: `
          <p>Depuis le <strong>25 mai 2026</strong>, ton salaire hebdomadaire a <strong>2 parts</strong> :</p>
          <ul>
            <li><strong>Part CA</strong> : (CA commissionnable / 50 000) × plafond CA selon ton grade</li>
            <li><strong>Bonus quota fabrication</strong> : jusqu'à <strong>5 000 $</strong> versés au prorata des unités fabriquées (eau purifiée / mastic carrosserie / visseries)</li>
          </ul>
          <p>Plafond CA par grade : 8 000 $ (Novice) / 9 000 $ (Inter) / 10 000 $ (Exp). Plafond total = plafond CA + 5 000 $.</p>
          <div class="tuto-callout info">
            <strong>Important :</strong> toute vente non déclarée sur la tablette = pas de part CA. Toute fabrication non déclarée = pas de bonus. <strong>Déclare systématiquement.</strong>
          </div>
        `
      },
      {
        emoji: '08',
        title: 'Quota CA hebdomadaire',
        body: `
          <p>Tu dois atteindre un <strong>CA commissionnable minimum chaque semaine</strong> :</p>
          <ul>
            <li>Par défaut : <strong>50 000 $</strong> (modifiable par la direction selon la semaine)</li>
            <li>Si non atteint à la clôture (lundi 00h00) → <strong>1 avertissement automatique</strong></li>
            <li>À 50 000 $ : tu touches ton <strong>plafond CA</strong> (8/9/10k selon grade)</li>
          </ul>
          <p>Sur ton espace, une barre de progression t'indique en temps réel où tu en es par rapport au quota.</p>
          <div class="tuto-callout">
            <strong>Astuce :</strong> suivi temps-réel sur "Mon espace" — pas de mauvaise surprise dimanche soir si tu regardes ton avancement régulièrement.
          </div>
        `
      },
      {
        emoji: '09',
        title: 'Quota de fabrication — bonus 5 000 $',
        body: `
          <p>En plus du CA, chaque semaine peut avoir un <strong>quota de fabrication</strong> (décidé par le patron à la clôture précédente) sur 3 produits possibles :</p>
          <ul>
            <li><strong>Bouteille d'eau purifiée</strong></li>
            <li><strong>Mastic carrosserie</strong></li>
            <li><strong>Visseries</strong></li>
          </ul>
          <p>Pour chaque produit avec un quota &gt; 0, tu déclares tes unités craftées dans <strong>Mon espace → Déclarer une fabrication</strong> (saisie libre).</p>
          <p>Le bonus est versé <strong>au prorata du score moyen</strong> : chaque produit compte pour une part égale, plafonné à 100 %. 50 % de score = 2 500 $ de bonus, 100 % = 5 000 $.</p>
          <div class="tuto-callout">
            <strong>Astuce :</strong> un produit avec quota = 0 est désactivé pour la semaine (n'entre pas dans le calcul). Si tous sont à 0 : seule la part CA compte.
          </div>
        `
      },
      {
        emoji: '10',
        title: 'Plafond total — atteindre 13/14/15 000 $',
        body: `
          <p>Ton salaire total est plafonné selon ton grade (TTE Chap. IV Art. 4-1.5) :</p>
          <ul>
            <li>Vendeur novice : <strong>13 000 $</strong> (8k CA + 5k bonus)</li>
            <li>Vendeur intermédiaire : <strong>14 000 $</strong> (9k CA + 5k bonus)</li>
            <li>Vendeur expérimenté : <strong>15 000 $</strong> (10k CA + 5k bonus)</li>
          </ul>
          <p>Pour toucher ton plafond complet : <strong>50 000 $ de CA</strong> ET <strong>100 % du quota fabrication</strong>.</p>
          <div class="tuto-callout">
            <strong>Astuce :</strong> sans quota fabrication actif (= tous quotas à 0), le bonus = 0 et tu plafonnes à 8/9/10k selon ton grade.
          </div>
        `
      },
      {
        emoji: '11',
        title: 'Avertissements & blocage',
        body: `
          <p>Même système que les autres rôles :</p>
          <ul>
            <li>Quota CA non atteint → <strong>1 avert auto</strong></li>
            <li>Vente non déclarée pendant trop longtemps → relance puis avert manuel possible</li>
            <li>3 averts actifs = <strong>compte bloqué</strong> (lecture seule, plus de vente possible)</li>
          </ul>
          <div class="tuto-callout danger">
            <strong>Important :</strong> la fraude (montant déclaré ≠ encaissé, vente fictive) entraîne un avert direct + sanction RP.
          </div>
        `
      },
      {
        emoji: '12',
        title: 'C\'est parti !',
        body: `
          <p>Récap des boutons sur <strong>"Mon espace"</strong> :</p>
          <ul>
            <li><strong>Déclarer une vente</strong> — vente directe sans facture bot</li>
            <li><strong>Ventes à déclarer</strong> (auto) — factures remontées par le bot, à détailler</li>
          </ul>
          <p>Et plus bas en temps réel :</p>
          <ul>
            <li>Ton <strong>CA cumulé</strong> + commission + salaire estimé</li>
            <li>Progression <strong>quota hebdo</strong> + plafond</li>
            <li>Tableau de <strong>toutes tes factures</strong> de la semaine</li>
            <li>Tes <strong>heures de service</strong> cumulées</li>
          </ul>
          <div class="tuto-callout">
            Bonne vente ! Pour toute question, ton responsable vente ou la direction sont là.
          </div>
        `
      }
    ]
  },

  // ============ RESPONSABLE POMPISTE ============
  'resp-pompiste': {
    label: 'Responsable Pompiste',
    color: '#c93',
    slides: [
      {
        emoji: '01',
        title: 'Bienvenue Responsable Pompiste',
        body: `
          <p>Salut <strong>${profile.prenom || 'collègue'}</strong> ! Tu es <strong>Responsable Pompiste</strong> chez LTD Little Seoul.</p>
          <p>Tu pilotes l'équipe pompiste : tu valides leur travail, modères leurs déclarations, traites les notes de frais, et tu produits aussi (comme un pompiste classique).</p>
          <div class="tuto-callout">
            Ce tuto te liste <strong>toutes les fonctions auxquelles tu as accès</strong> et la procédure complète d'un manager d'équipe pompiste.
          </div>
        `
      },
      {
        emoji: '02',
        title: 'Tes responsabilités',
        body: `
          <ul>
            <li><strong>Piloter l'équipe</strong> : suivre l'avancement de chaque pompiste sur la semaine</li>
            <li><strong>Modérer les déclarations</strong> : corriger ou supprimer les ravitaillements / caoutchoucs en cas d'erreur</li>
            <li><strong>Suivre les notes de frais</strong> essence (lecture, la direction valide)</li>
            <li><strong>Configurer les stations</strong> : ajouter/modifier prix, capacités, seuils d'alerte</li>
            <li><strong>Produire toi-même</strong> bidons + caoutchoucs (tu as un quota et un salaire comme un pompiste)</li>
          </ul>
          <p>Ton salaire est <strong>fixé par le patron</strong>, plafond <strong>17 000 $</strong>.</p>
        `
      },
      {
        emoji: '03',
        title: 'Page principale — /stations',
        body: `
          <p>Va sur <strong>"Stations essence"</strong> dans la sidebar. C'est ton tableau de bord opérationnel.</p>
          <p>Tu y trouves dans cet ordre :</p>
          <ol>
            <li><strong>KPI globaux</strong> : nb stations, stock total, stations en alerte, quota bidon/sem</li>
            <li><strong>Grille des 8 stations</strong> : niveau de chaque cuve, alerte si sous seuil, prix au litre</li>
            <li><strong>Pilotage pompistes</strong> : tableau récap avec bidons/quota, caoutchoucs/quota, dernière activité, statut, lien vers leur espace</li>
            <li><strong>Redistributions de la semaine</strong> : toutes les déclarations de ravitaillement avec actions Modifier / Supprimer</li>
            <li><strong>Déclarations caoutchoucs</strong> : idem pour la production caoutchoucs</li>
          </ol>
        `
      },
      {
        emoji: '04',
        title: 'Suivre tes pompistes',
        body: `
          <p>Dans le panel <strong>"Pilotage pompistes"</strong> :</p>
          <ul>
            <li>Tableau trié par <strong>score décroissant</strong> (les en retard en bas)</li>
            <li>Barres de progression bidons + caoutchoucs : <span style="color:#5a8;">vert si atteint</span>, <span style="color:#d33;">rouge si &lt; 30%</span></li>
            <li>Total <strong>litres redistribués</strong> + nombre de ravitaillements</li>
            <li>Timestamp de la <strong>dernière activité</strong> — repère les inactifs</li>
            <li>Statut : Atteint / En cours / En retard / Rien fait</li>
            <li>Bouton <strong>Voir</strong> ouvre l'espace personnel du pompiste (lecture seule) pour voir exactement ce qu'il voit</li>
          </ul>
          <div class="tuto-callout">
            <strong>Astuce :</strong> en milieu de semaine, relance les inactifs et les en retard pour qu'ils mettent un coup d'accélérateur.
          </div>
        `
      },
      {
        emoji: '05',
        title: 'Modifier une déclaration',
        body: `
          <p>Si un pompiste a saisi une mauvaise valeur (ex : 50 bidons au lieu de 5), tu peux corriger :</p>
          <ol>
            <li>Sur la table <strong>"Redistributions"</strong> ou <strong>"Déclarations caoutchoucs"</strong></li>
            <li>Clique sur <strong>Modifier</strong> à droite de la ligne</li>
            <li>Saisis la <strong>bonne valeur</strong> (preview du delta affiché)</li>
            <li>Valide</li>
          </ol>
          <p>Le site recalcule automatiquement :</p>
          <ul>
            <li>Le <strong>stock de la station</strong> (rétroactivement)</li>
            <li>Le <strong>quota du pompiste</strong> de la semaine concernée</li>
          </ul>
          <div class="tuto-callout">
            <strong>Important :</strong> la modification est <strong>auditée</strong> : ton nom + ancienne valeur conservés sur la déclaration.
          </div>
        `
      },
      {
        emoji: '06',
        title: 'Supprimer une déclaration',
        body: `
          <p>Pour les cas de <strong>fraude</strong>, <strong>doublon</strong> ou <strong>annulation</strong> :</p>
          <ol>
            <li>Bouton <strong>Supprimer</strong> sur la ligne concernée</li>
            <li>Confirmation critique (timer 2s)</li>
            <li>Saisis une <strong>raison</strong> obligatoire (min 3 caractères)</li>
          </ol>
          <p>Effet :</p>
          <ul>
            <li>La ligne reste visible (<strong>barrée et grisée</strong>) pour audit</li>
            <li>Le <strong>stock station</strong> est retiré de la valeur</li>
            <li>Le <strong>quota pompiste</strong> est décrémenté</li>
          </ul>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> la suppression est <strong>irréversible côté quota / stock</strong>. Vérifie deux fois avant. Pas de hard delete : la trace reste pour l'audit IRS.
          </div>
        `
      },
      {
        emoji: '07',
        title: 'Configurer les stations',
        body: `
          <p>Tu peux <strong>modifier les stations</strong> (prix au litre, capacité, seuil d'alerte, N° pompe FiveM) :</p>
          <ol>
            <li>Clique sur une station dans la grille</li>
            <li>Modifie les champs</li>
            <li>Enregistre</li>
          </ol>
          <p>Tu peux aussi <strong>ajouter</strong> une nouvelle station (bouton Ajouter) ou la <strong>supprimer</strong> (icône Supprimer dans le modal édition).</p>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> tu ne peux <strong>pas modifier les quotas</strong> (bidons/caoutchoucs/CA vendeur) — ça reste réservé à la direction. Si un quota doit changer, demande au patron.
          </div>
        `
      },
      {
        emoji: '08',
        title: 'Notes de frais — lecture seule',
        body: `
          <p>Sur la page <strong>"Notes de frais"</strong> dans la sidebar, tu vois <strong>toutes les notes</strong> de ton équipe :</p>
          <ul>
            <li>KPI : nb en attente, approuvées, remboursées, total</li>
            <li>Filtre par statut</li>
            <li>Visualisation des screenshots (clic sur Voir)</li>
          </ul>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> tu peux <strong>consulter</strong> mais pas approuver/rejeter/rembourser — ça reste réservé à direction + DRH. Si une note traîne, relance la direction.
          </div>
        `
      },
      {
        emoji: '09',
        title: 'Tu produis aussi',
        body: `
          <p>En plus du management, tu es un <strong>pompiste opérationnel</strong> :</p>
          <ul>
            <li>Tu peux <strong>ravitailler les stations</strong> comme un pompiste classique</li>
            <li>Tu peux <strong>fabriquer des caoutchoucs</strong></li>
            <li>Tu apparais dans le pilotage pompistes avec ton propre quota</li>
            <li>Tu peux faire des <strong>notes de frais</strong> essence (cf. tuto pompiste)</li>
          </ul>
          <p>Tes déclarations passent par <strong>"Mon espace"</strong> comme tous les autres.</p>
          <div class="tuto-callout">
            <strong>Astuce :</strong> exemplarité — si tu remplis tes propres quotas, ton équipe suivra plus facilement.
          </div>
        `
      },
      {
        emoji: '10',
        title: 'Ce que tu NE peux PAS faire',
        body: `
          <p>Pour clarifier le périmètre :</p>
          <ul>
            <li>Modifier les <strong>quotas</strong> hebdomadaires (direction)</li>
            <li>Approuver / rembourser les <strong>notes de frais</strong> (direction + DRH)</li>
            <li>Voir les <strong>alertes</strong> dans la cloche (direction + DRH uniquement)</li>
            <li>Embaucher / licencier — sauf si la direction t'a donné le droit explicite via les RH</li>
            <li>Toucher la <strong>banque LTD</strong> ou la <strong>compta</strong></li>
          </ul>
          <p>Si tu as besoin de l'un de ces accès ponctuellement, contacte la direction.</p>
        `
      },
      {
        emoji: '11',
        title: 'Tu es prêt !',
        body: `
          <p>Tu pilotes maintenant ton équipe. Workflow type d'une semaine :</p>
          <ol>
            <li><strong>Lundi</strong> : check du Pilotage — voir qui est en route, qui a démarré fort</li>
            <li><strong>Mercredi/Jeudi</strong> : relance les en retard ; vérifie qu'aucune déclaration n'est aberrante (à modérer ?)</li>
            <li><strong>Dimanche soir</strong> : récap final, valide que tous tes pompistes ont assez produit avant la clôture (lundi 00h00)</li>
            <li><strong>Tout le temps</strong> : déclarer ta propre production + tes notes de frais</li>
          </ol>
          <div class="tuto-callout">
            Bonne semaine — l'équipe est entre tes mains !
          </div>
        `
      }
    ]
  },

  // ============ RESPONSABLE VENTE ============
  'resp-vente': {
    label: 'Responsable Vente',
    color: '#c93',
    slides: [
      {
        emoji: '01',
        title: 'Bienvenue Responsable Vente',
        body: `
          <p>Salut <strong>${profile.prenom || 'collègue'}</strong> ! Tu es <strong>Responsable Vente</strong> chez LTD Little Seoul.</p>
          <p>Tu pilotes l'équipe de vendeurs, supervise les stocks épicerie, vérifies les ventes et tu vends toi-même (avec un salaire au prorata du CA que tu génères).</p>
          <div class="tuto-callout">
            Ce tuto t'explique <strong>toutes tes prérogatives</strong> et la procédure type d'un manager d'équipe vente.
          </div>
        `
      },
      {
        emoji: '02',
        title: 'Tes responsabilités',
        body: `
          <ul>
            <li><strong>Gérer les stocks épicerie</strong> : commander auprès des fournisseurs, ajuster les seuils d'alerte</li>
            <li><strong>Suivre l'équipe vendeurs</strong> via les RH (CA, ventes du jour, quotas)</li>
            <li><strong>Modifier/contester des ventes</strong> en cas d'erreur (formation, fraude détectée)</li>
            <li><strong>Optimiser le CA</strong> : prix des produits, marges, promotions ponctuelles</li>
            <li><strong>Vendre toi-même</strong> — tes ventes ne sont PAS commissionnées (ton salaire est fixe)</li>
          </ul>
          <p>Salaire : <strong>17 000 $ fixe</strong> (plafond TTE), ou montant inférieur décidé par le patron. Identique au Responsable Pompiste.</p>
        `
      },
      {
        emoji: '03',
        title: 'Page principale — /ventes',
        body: `
          <p>Va sur <strong>"Ventes"</strong> dans la sidebar. C'est ton tableau de bord opérationnel.</p>
          <p>Tu y trouves :</p>
          <ol>
            <li><strong>KPI</strong> de la semaine : CA total, nb ventes, bénéfice, % particulier</li>
            <li><strong>Liste complète des ventes</strong> de la semaine</li>
            <li><strong>Filtres</strong> : par vendeur, par client, par paiement, par produit</li>
            <li><strong>Export CSV</strong> pour analyse externe</li>
            <li><strong>Bouton Modifier</strong> à droite de chaque vente — tu peux la modifier (montant, produit, type client) en cas d'erreur</li>
          </ol>
        `
      },
      {
        emoji: '04',
        title: 'Gérer les stocks épicerie',
        body: `
          <p>Sur <strong>"Stocks épicerie"</strong> :</p>
          <ul>
            <li>Vue temps réel de tous les <strong>produits en stock</strong></li>
            <li>Modification des <strong>prix de vente</strong>, <strong>seuils d'alerte</strong> bas/rupture</li>
            <li>Ajout/suppression de produits du catalogue</li>
            <li>Bouton <strong>"Commander"</strong> pour passer commande chez les fournisseurs (le bot suit la livraison)</li>
          </ul>
          <div class="tuto-callout">
            <strong>Astuce :</strong> surveille le panel "Alertes stock" — un produit en rupture = ventes perdues + clients déçus.
          </div>
        `
      },
      {
        emoji: '05',
        title: 'Suivre tes vendeurs',
        body: `
          <p>Sur <strong>"Ressources humaines"</strong> :</p>
          <ul>
            <li>Tableau de tous les employés actifs</li>
            <li>Pour chaque vendeur : <strong>CA réalisé</strong>, % du quota, salaire estimé</li>
            <li>Bouton <strong>Voir</strong> pour voir son espace en lecture seule (mode debug)</li>
            <li>Détail des ventes par vendeur, par client, par produit</li>
          </ul>
          <div class="tuto-callout">
            <strong>Astuce :</strong> si un vendeur stagne, ouvre son espace pour comprendre ce qu'il fait (ou pas). Tu peux ensuite le coacher.
          </div>
        `
      },
      {
        emoji: '06',
        title: 'Modifier / contester une vente',
        body: `
          <p>Sur <strong>/ventes</strong> bouton <strong>Modifier</strong> à droite d'une vente :</p>
          <ul>
            <li>Modifier le <strong>montant</strong> (en cas d'erreur de saisie)</li>
            <li>Changer le <strong>type client</strong> (particulier ↔ entreprise) — impacte la commission</li>
            <li>Ajouter/retirer des produits du détail</li>
            <li>Marquer la vente <strong>cachée</strong> (en cas de doublon avec une facture bot)</li>
          </ul>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> toute modification est <strong>auditée</strong> (ton nom + date + ancienne valeur). N'abuse pas, et préviens le vendeur concerné si l'impact est sur sa commission.
          </div>
        `
      },
      {
        emoji: '07',
        title: 'Tu peux vendre — mais salaire fixe',
        body: `
          <p>En plus du management, tu peux <strong>vendre toi-même</strong> via "Mon espace" :</p>
          <ul>
            <li>Bouton <strong>"Déclarer une vente"</strong> — vente directe</li>
            <li>Section <strong>"Ventes à déclarer"</strong> — factures bot remontées à détailler</li>
          </ul>
          <p><strong>Important</strong> (décision patron 2026-05-24) : tes ventes et crafts personnels ne sont <strong>pas</strong> pris en compte dans ton salaire estimé. Ton rôle est de piloter l'équipe, pas de faire de la commission.</p>
          <ul>
            <li>Salaire fixe : <strong>17 000 $/semaine</strong> (plafond TTE)</li>
            <li>Le patron peut décider un montant inférieur depuis l'interface RH</li>
            <li>Régime identique au Responsable Pompiste</li>
          </ul>
        `
      },
      {
        emoji: '08',
        title: 'Comptabilité — accès lecture',
        body: `
          <p>Tu as accès à la <strong>"Comptabilité"</strong> en consultation :</p>
          <ul>
            <li>CA cumulé, dépenses, bénéfice brut/net de la semaine</li>
            <li>Détail par catégorie</li>
            <li>Historique des semaines clôturées</li>
          </ul>
          <p>Et aux <strong>"Revenus carburant"</strong> pour voir l'autre branche du LTD.</p>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> <strong>lecture seule</strong> — tu ne peux pas modifier les dépenses ni les paies, c'est direction + DRH.
          </div>
        `
      },
      {
        emoji: '09',
        title: 'Ce que tu NE peux PAS faire',
        body: `
          <p>Pour clarifier ton périmètre :</p>
          <ul>
            <li>Modifier les <strong>quotas</strong> hebdomadaires (direction)</li>
            <li>Toucher aux <strong>commissions</strong> et grilles de salaire (TTE, direction)</li>
            <li>Voir les <strong>alertes</strong> dans la cloche (direction + DRH)</li>
            <li>Approuver des <strong>notes de frais</strong> (direction + DRH)</li>
            <li>Modifier la <strong>banque LTD</strong> ou les paies</li>
            <li>Embaucher / licencier — sauf si la direction t'a délégué via les RH</li>
          </ul>
          <p>Pour tout dépassement de périmètre, escalade à la direction.</p>
        `
      },
      {
        emoji: '10',
        title: 'Gérer les fraudes / écarts',
        body: `
          <p>Si tu détectes une <strong>vente déclarée avec un montant incohérent</strong> ou un <strong>tag client erroné</strong> :</p>
          <ol>
            <li>Vérifie sur <strong>/ventes</strong> en filtrant par vendeur</li>
            <li>Compare avec les <strong>factures bot</strong> (factureId in-game)</li>
            <li>Corrige si erreur honnête, signale à la direction si fraude répétée</li>
            <li>La direction peut donner un <strong>avertissement manuel</strong>au vendeur</li>
          </ol>
          <div class="tuto-callout warn">
            <strong>Attention :</strong> 3 averts actifs → compte bloqué. Préviens le vendeur AVANT que ça arrive, donne-lui une chance de corriger.
          </div>
        `
      },
      {
        emoji: '11',
        title: 'Tu es prêt !',
        body: `
          <p>Workflow type d'une semaine :</p>
          <ol>
            <li><strong>Lundi</strong> : check des stocks, commande si rupture imminente</li>
            <li><strong>Mardi-Jeudi</strong> : suivi équipe sur /rh, coaching des vendeurs en retard</li>
            <li><strong>Vendredi</strong> : audit des ventes (recherche d'anomalies)</li>
            <li><strong>Dimanche soir</strong> : récap CA équipe, signale les problèmes à la direction</li>
            <li><strong>Tout le temps</strong> : tu vends, tu déclares, tu gères les stocks en temps réel</li>
          </ol>
          <div class="tuto-callout">
            Bonne semaine — fais cartonner ton équipe !
          </div>
        `
      }
    ]
  }
};

// ============================================================
// RENDU PAGE
// ============================================================

const tutoOptions = canSeeAll
  ? Object.entries(TUTOS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')
  : '';

const html = `
  <div class="tuto-shell">
    ${canSeeAll ? `
      <div class="tuto-toolbar">
        <strong>Tutoriel :</strong>
        <select id="tuto-select">${tutoOptions}</select>
        <span class="muted" style="font-size:0.82rem;">— vue direction, tu peux feuilleter chaque tuto pour former un nouvel employé</span>
      </div>
    ` : `
      <div class="tuto-toolbar">
        <strong>Tutoriel</strong>
        <span class="muted" style="font-size:0.82rem;">— garde ce guide sous la main, tu peux le revoir n'importe quand</span>
      </div>
    `}

    <div class="tuto-slide" id="tuto-slide-container">
      <div class="tuto-slide-head">
        <span class="tuto-slide-emoji" id="slide-emoji">—</span>
        <h2 class="tuto-slide-title" id="slide-title">—</h2>
        <span class="tuto-slide-num" id="slide-num">—</span>
      </div>
      <div class="tuto-slide-body" id="slide-body">—</div>

      <div class="tuto-nav">
        <button class="btn" id="btn-prev">← Précédent</button>
        <div class="tuto-dots" id="tuto-dots"></div>
        <button class="btn btn-primary" id="btn-next">Suivant →</button>
      </div>
    </div>
  </div>
`;
renderShell(profile, 'tuto', html);

// État courant
let currentTutoKey = defaultTutoKey(profile.role);
let currentIndex = 0;

function render() {
  const tuto = TUTOS[currentTutoKey];
  if (!tuto) return;
  const slide = tuto.slides[currentIndex];
  document.getElementById('slide-emoji').textContent = slide.emoji;
  document.getElementById('slide-title').textContent = slide.title;
  document.getElementById('slide-num').textContent = `${currentIndex + 1} / ${tuto.slides.length}`;
  document.getElementById('slide-body').innerHTML = slide.body;

  // Dots
  const dots = document.getElementById('tuto-dots');
  dots.innerHTML = tuto.slides.map((_, i) =>
    `<button class="tuto-dot ${i === currentIndex ? 'active' : ''}" data-go="${i}" title="Slide ${i+1}"></button>`
  ).join('');
  dots.querySelectorAll('[data-go]').forEach(b => {
    b.addEventListener('click', () => {
      currentIndex = parseInt(b.dataset.go, 10);
      render();
    });
  });

  // Boutons
  document.getElementById('btn-prev').disabled = currentIndex === 0;
  document.getElementById('btn-next').disabled = currentIndex === tuto.slides.length - 1;
  document.getElementById('btn-next').textContent = currentIndex === tuto.slides.length - 1
    ? 'Terminé'
    : 'Suivant →';
}

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentIndex > 0) { currentIndex--; render(); }
});
document.getElementById('btn-next').addEventListener('click', () => {
  const tuto = TUTOS[currentTutoKey];
  if (currentIndex < tuto.slides.length - 1) { currentIndex++; render(); }
});

// Selecteur (direction)
const selector = document.getElementById('tuto-select');
if (selector) {
  selector.value = currentTutoKey;
  selector.addEventListener('change', () => {
    currentTutoKey = selector.value;
    currentIndex = 0;
    render();
  });
}

// Raccourcis clavier ← / →
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  document.getElementById('btn-prev').click();
  if (e.key === 'ArrowRight') document.getElementById('btn-next').click();
});

render();
