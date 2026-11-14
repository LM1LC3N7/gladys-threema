# Threema pour Gladys

Connecteur non officiel, sans lien avec Threema. Il envoie des messages Threema depuis vos scènes Gladys, avec
votre propre compte **Threema Gateway**. Envoi seul : Gladys ne lit pas les réponses.

> Cette intégration n’a jamais été testée avec un vrai compte Threema Gateway : elle suit la documentation
> officielle de l’API. Vos retours sont les bienvenus.

## Ce qu’il vous faut

- Un **identifiant Threema Gateway en mode simple** (« Basic mode »), créé sur
  [gateway.threema.ch](https://gateway.threema.ch/en/) : 8 caractères commençant par `*`, avec son **secret
  d’API**.
- Des **crédits** Threema Gateway : chaque message envoyé en consomme, ils s’achètent chez Threema.

**Mode simple** : le serveur Gateway de Threema détient la clé privée de votre identifiant et prépare lui-même
chaque message pour le destinataire. C’est le mode le plus simple à mettre en place ; si vous voulez que la clé
reste chez vous, ce connecteur ne convient pas (mode « End-to-end » non pris en charge).

## Configuration

| Champ                                              | Rôle                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiant Gateway                                | `*XXXXXXX`, 8 caractères.                                                                                                                                                                                                                                                                   |
| Secret d’API                                       | Gardé par Gladys dans sa base, jamais réaffiché, envoyé seulement à Threema.                                                                                                                                                                                                                |
| Destinataires autorisés                            | Jusqu’à 20, séparés par des virgules : identifiants Threema (8 caractères), numéros au format international (`+33…` ou `0033…`) ou adresses e-mail liées à un compte Threema. **Les seuls** destinataires possibles de l’action de scène et du bouton de test ; le premier sert par défaut. |
| Messages par heure, au plus                        | 20 par défaut, de 1 à 500.                                                                                                                                                                                                                                                                  |
| Envoyer aussi les messages Gladys des utilisateurs | Désactivé par défaut (voir plus bas).                                                                                                                                                                                                                                                       |

Boutons :

- **Vérifier le compte** : demande à Threema les crédits restants. Gratuit, rien n’est envoyé, ne compte pas dans
  le plafond.
- **Envoyer un message de test** : un court message à un destinataire autorisé (le premier si vide). Coûte des
  crédits et compte dans le plafond.

## Action de scène « Envoyer un message Threema »

- **Texte** : peut contenir des variables de scène. Au-delà de 3 500 octets (limite de Threema), il est coupé et
  finit par « … ».
- **Destinataire** (facultatif) : l’un des destinataires autorisés, écrit comme vous voulez (`alice123`,
  `+33 6 12 34 56 78`) ; vide, le premier de la liste. Un destinataire hors de la liste est refusé, même s’il vient
  d’une variable de scène : rien n’est envoyé.
- **Sortie** : `message_id`, l’identifiant du message donné par Threema (vide s’il n’a pas pu être lu).

## Messages de Gladys aux utilisateurs (option)

Ce connecteur est aussi un canal de messages de Gladys. Si l’administrateur coche **« Envoyer aussi les messages
Gladys des utilisateurs »**, chaque utilisateur qui saisit son destinataire Threema dans « Mon compte » reçoit
par Threema les messages que Gladys lui envoie : l’action de scène « Envoyer un message » du cœur, et aussi les
notifications de Gladys aux administrateurs (piles faibles, mises à jour, résumé hebdomadaire…). Chacun coûte des
crédits, d’où l’option désactivée par défaut. Ces messages comptent dans le même plafond horaire.

Gladys attend 5 s la réponse d’un canal : le connecteur répond au bout de 3,5 s au plus et l’envoi continue
(15 s au plus) ; son résultat va dans les journaux et le statut.

## Ce qui protège votre compte

- **Rien ne part tout seul** : ni au démarrage, ni à une reconnexion, ni sur une minuterie ; seulement une
  action de scène, un clic sur « Envoyer un message de test », ou un message de Gladys quand l’option est cochée.
- **Pas de doublon** : un message n’est jamais renvoyé. Si Threema ne répond pas à temps ou si la connexion est
  coupée, le message est peut-être parti : l’erreur le dit, et il n’est pas renvoyé.
- **Plafond horaire** : compté avant l’envoi, sur une heure glissante, gardé dans `/data` (un redémarrage ne le
  remet pas à zéro). Un message refusé par Threema (400, 401, 402, 404, 413, 429) ne compte pas ; une erreur
  du serveur (5xx), un délai dépassé ou une coupure comptent. Si `/data` est illisible, en lecture seule ou
  lent, l’envoi n’attend pas (1 s au plus) et le statut prévient que le plafond n’est garanti que jusqu’au
  prochain redémarrage.
- **Un message à la fois**, 10 en attente au plus, les autres refusés.
- **Identifiant ou secret refusé** (401) : plus rien n’est envoyé avec eux (une empreinte de 8 bits, jamais le
  secret, gardée dans `/data`) tant qu’ils ne changent pas ou qu’un bouton ne réussit pas.
- **Pause** après un 429 ou une erreur du serveur : 60 s, doublée à chaque fois jusqu’à 1 h, ou la durée
  demandée par Threema jusqu’à 6 h ; boutons compris, gardée au redémarrage.
- **Plus de crédits** (402) : le statut le dit ; rien n’a été envoyé.
- Le secret, le texte des messages et les destinataires complets n’apparaissent jamais dans les journaux, le
  statut ni `/data` : un identifiant y devient `AL******`, un numéro `+…67`, une adresse `j…@…`.

## Statuts

« Prêt » tant que rien n’a été envoyé (l’identifiant et le secret ne sont vérifiés qu’au premier message ou au
bouton « Vérifier le compte ») ; « Threema Gateway a répondu » après un succès ; sinon la raison : refus, pause,
plafond atteint, plus de crédits, réseau.

## Confidentialité

Les messages passent par les serveurs de Threema (Suisse). Ce que Threema en fait relève de ses conditions du
service Gateway.
