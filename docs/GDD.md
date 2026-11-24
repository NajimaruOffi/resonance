# RÉSONANCE — Game Design Document

> *Ton arsenal est un séquenceur. Ta bande-son est ton build.*

## Pitch

Résonance est un roguelite d'arène en vue de dessus (twin-stick) où **chaque arme est une piste
d'un séquenceur 16 pas**. Le canon tire sur la grosse caisse, les aiguilles sur le charleston,
l'onde de choc sur la caisse claire, le laser sur la basse, l'essaim sur l'arpège.
Améliorer son arsenal, c'est littéralement **composer** : à chaque vague, le joueur place de
nouvelles notes sur la grille, débloque de nouveaux instruments et modifie leur son.

La musique n'accompagne pas le jeu : **elle est le jeu**.

## Piliers

1. **Le son est la mécanique** — tout tir est une note, tout ennemi agit sur le temps.
2. **Lisible au rythme** — les ennemis se télégraphient sur la mesure ; l'écoute aide à survivre.
3. **Composer pour gagner** — les choix d'amélioration sont aussi des choix musicaux.
4. **Toujours musical** — gammes et progressions d'accords garantissent que n'importe quel build sonne bien.

## Boucle de jeu

```
Vague (mesures) ─► ennemis éliminés ─► choix 1 parmi 3 améliorations
      ▲                                         │
      └──────── placement de notes sur la grille ◄┘
Toutes les 5 vagues : Boss « Le Métronome » puis changement de secteur (tonalité + palette).
```

## Contrôles

| Action | Clavier / souris |
|---|---|
| Se déplacer | ZQSD / WASD / flèches |
| Viser | Souris |
| Dash | Espace ou Shift |
| DROP | E ou clic droit (jauge pleine) |
| Pause | Échap / P |

## Mécaniques rythmiques

- **Horloge musicale** : 16 doubles-croches par mesure, BPM de départ 118.
  Tous les événements de gameplay sont déclenchés par l'horloge audio (planification anticipée,
  précision à l'échantillon près).
- **Dash « Parfait »** : un dash déclenché à ±90 ms d'un temps donne une invulnérabilité
  prolongée, une traînée offensive et +5 au combo.
- **DROP** : la jauge se remplit en ramassant des éclats. Activé, le DROP attend le prochain
  « 1 » de la mesure (une montée — *riser* — joue en attendant), puis frappe tout l'écran et
  double les dégâts pendant 2 mesures.

## Pistes / armes

| Piste | Arme | Comportement |
|---|---|---|
| Kick | Canon | Projectile lourd vers le curseur |
| Hat | Aiguilles | Projectile rapide, faible dégât |
| Snare | Onde | Anneau de choc autour du joueur, léger recul (ne bloque pas les projectiles) |
| Bass | Laser | Rayon perçant, la note suit la progression d'accords |
| Lead | Essaim | Missiles à tête chercheuse, mélodie en arpège |

Départ : Kick (1-5-9-13) + Hat (contretemps).

## Ennemis

| Ennemi | Forme | Comportement rythmique |
|---|---|---|
| Drone | Triangle | Dérive vers le joueur, pulse sur le temps |
| Fléchette | Flèche | Bondit vers le joueur **sur chaque temps** |
| Diviseur | Hexagone | Se scinde en 3 à la mort |
| Sentinelle | Carré | Charge sur le temps 4, tire un anneau sur le « 1 » |
| Colosse | Octogone | Lent, très résistant, onde de choc tous les 2 temps |
| **Le Métronome** (boss) | Pendule | Spirales sur les temps, salves visées, invocations ; phase 2 à 50 % |

Les apparitions sont annoncées un temps à l'avance par des marqueurs au sol.

## Améliorations (extraits)

- **Nouvelle piste** — débloque un instrument/arme.
- **Note supplémentaire** — le joueur place lui-même un pas sur la grille (on entend le résultat en direct).
- **Gain** (+dégâts), **Perforation**, **Éventail** (+1 projectile), **Écho** (re-tir une double-croche plus tard, et ajoute un delay audio à la piste).
- **Saturation** (critiques), **Blindage** (+PV), **Syncope** (recharge du dash), **Accélérando** (+BPM : tout va plus vite).

## Secteurs

| Secteur | Tonalité | Progression | Palette |
|---|---|---|---|
| I — Néon | La mineur | i – VI – III – VII | Cyan / magenta |
| II — Braise | Do mineur | i – iv – VI – V | Orange / violet |
| III — Abysse | Fa# mineur | i – VII – VI – VII | Vert / bleu |
| IV — Éclipse | Ré dorien | i – IV – i – VII | Or / rouge |

## Méta

- Graine de partie (seed) affichée, rejouable ; **Défi du jour** basé sur la date.
- Meilleur score / meilleure vague sauvegardés localement.
- Options : volume, tremblement d'écran, réduction des flashs.

## Méta-progression

| Boucle | Ressource | Rôle |
|---|---|---|
| Niveau de musicien | XP (score, vague, boss, dash parfaits) | Débloque 6 kits de départ (niv. 1, 2, 4, 6, 8, 10) |
| Studio | Échos ◈ (fin de partie + succès) | 8 améliorations permanentes à plusieurs niveaux |
| Intensité 0–10 | Vague 10 atteinte au palier maximal | Modificateurs cumulatifs, +20 % de gains par palier |
| Succès | 24 objectifs | Échos bonus, notification en pleine partie |

Règle de conception : **une partie ratée fait quand même progresser**, et l'écran de fin donne
toujours un prochain objectif concret.
