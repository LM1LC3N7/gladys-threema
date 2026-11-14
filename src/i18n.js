// -----------------------------------------------------------------------------
// Every text shown to the user, in English and French. `{name}` placeholders
// are filled by `t`. No text carries the secret, the text of a message or a
// whole recipient (only its masked form).
// -----------------------------------------------------------------------------

export const ALL_TEXTS = {
  // Status (Configuration screen).
  not_configured: {
    en: 'Enter the Gateway ID (*XXXXXXX) and its API secret.',
    fr: 'Saisissez l’identifiant Gateway (*XXXXXXX) et son secret d’API.',
  },
  identity_missing: {
    en: 'The Gateway ID is missing: a secret alone is not used.',
    fr: 'L’identifiant Gateway manque : un secret seul n’est pas utilisé.',
  },
  secret_missing: {
    en: 'The API secret is missing.',
    fr: 'Le secret d’API manque.',
  },
  identity_invalid: {
    en: 'The Gateway ID is not valid: 8 characters starting with *, such as *GLADYS1.',
    fr: 'L’identifiant Gateway n’est pas valide : 8 caractères commençant par *, comme *GLADYS1.',
  },
  secret_invalid: {
    en: 'The API secret is not valid (letters and digits, no space).',
    fr: 'Le secret d’API n’est pas valide (lettres et chiffres, sans espace).',
  },
  recipients_invalid: {
    en: 'Recipient number {position} of the list is not valid: a Threema ID (8 characters), a phone number starting with + or 00, or an e-mail address.',
    fr: 'Le destinataire n° {position} de la liste n’est pas valide : un identifiant Threema (8 caractères), un numéro commençant par + ou 00, ou une adresse e-mail.',
  },
  recipients_too_many: {
    en: 'At most 20 allowed recipients.',
    fr: '20 destinataires autorisés au plus.',
  },
  limit_invalid: {
    en: 'The hourly limit must be a whole number from 1 to 500 messages.',
    fr: 'Le plafond horaire doit être un nombre entier de 1 à 500 messages.',
  },
  config_unread: {
    en: 'The configuration could not be read from Gladys yet; trying again.',
    fr: 'La configuration n’a pas encore pu être lue depuis Gladys ; nouvel essai en cours.',
  },
  ready: {
    en: 'Ready. The ID and the secret are checked by Threema with the “Check the account” button (free) or at the first message.',
    fr: 'Prêt. L’identifiant et le secret sont vérifiés par Threema avec le bouton « Vérifier le compte » (gratuit) ou au premier message.',
  },
  not_persisted: {
    en: 'Ready, but the hourly counter is not saved (/data unread, read-only or slow): the limit is only guaranteed until the next restart.',
    fr: 'Prêt, mais le compteur horaire n’est pas enregistré (/data non lu, en lecture seule ou lent) : le plafond n’est garanti que jusqu’au prochain redémarrage.',
  },
  working: {
    en: 'Threema Gateway answered: the ID and the secret are accepted.',
    fr: 'Threema Gateway a répondu : l’identifiant et le secret sont acceptés.',
  },
  refused: {
    en: 'Threema refused this Gateway ID or this secret. Nothing is sent with them until they change, or a button succeeds.',
    fr: 'Threema a refusé cet identifiant Gateway ou ce secret. Plus rien n’est envoyé avec eux tant qu’ils ne changent pas, ou qu’un bouton ne réussit pas.',
  },
  no_credits: {
    en: 'The Threema Gateway account has no credits left: buy some on gateway.threema.ch. Nothing was sent.',
    fr: 'Le compte Threema Gateway n’a plus de crédits : rachetez-en sur gateway.threema.ch. Rien n’a été envoyé.',
  },
  bad_recipient: {
    en: 'Threema refused the message: the recipient {to} is not valid, or the ID is not a basic-mode ID. Nothing was sent.',
    fr: 'Threema a refusé le message : le destinataire {to} n’est pas valide, ou l’identifiant n’est pas en mode simple (basic). Rien n’a été envoyé.',
  },
  not_found: {
    en: 'No Threema user is linked to {to}. Nothing was sent.',
    fr: 'Aucun utilisateur Threema n’est lié à {to}. Rien n’a été envoyé.',
  },
  too_long: {
    en: 'Threema refused the message as too long. Nothing was sent.',
    fr: 'Threema a refusé le message, trop long. Rien n’a été envoyé.',
  },
  paused: {
    en: 'Threema Gateway asked to slow down or failed: nothing is sent before {time} (UTC).',
    fr: 'Threema Gateway a demandé de ralentir ou a échoué : rien n’est envoyé avant {time} (UTC).',
  },
  unexpected: {
    en: 'Threema Gateway gave an unexpected answer (HTTP {status}). Nothing was sent.',
    fr: 'Threema Gateway a donné une réponse inattendue (HTTP {status}). Rien n’a été envoyé.',
  },
  timeout: {
    en: 'Threema Gateway did not answer in time: the message may have left. It is not sent again.',
    fr: 'Threema Gateway n’a pas répondu à temps : le message est peut-être parti. Il n’est pas renvoyé.',
  },
  network: {
    en: 'Threema Gateway could not be reached, or the connection was cut: the message may have left. It is not sent again.',
    fr: 'Threema Gateway est injoignable, ou la connexion a été coupée : le message est peut-être parti. Il n’est pas renvoyé.',
  },
  network_not_sent: {
    en: 'Threema Gateway could not be reached (network). Nothing was sent.',
    fr: 'Threema Gateway est injoignable (réseau). Rien n’a été envoyé.',
  },
  bad_answer: {
    en: 'Threema Gateway sent an answer that could not be read.',
    fr: 'Threema Gateway a envoyé une réponse illisible.',
  },
  limit_reached: {
    en: 'The limit of {limit} messages per hour is reached: nothing is sent before {time} (UTC), or a higher limit.',
    fr: 'Le plafond de {limit} messages par heure est atteint : rien n’est envoyé avant {time} (UTC), ou un plafond plus haut.',
  },
  busy: {
    en: 'Too many messages at once: this one was not sent.',
    fr: 'Trop de messages à la fois : celui-ci n’a pas été envoyé.',
  },
  deadline: {
    en: 'The message waited too long behind the others: it was not sent.',
    fr: 'Le message a attendu trop longtemps derrière les autres : il n’a pas été envoyé.',
  },
  config_changed: {
    en: 'The configuration changed while the message was waiting: it was not sent.',
    fr: 'La configuration a changé pendant que le message attendait : il n’a pas été envoyé.',
  },
  empty_text: {
    en: 'Nothing to send: the text is empty (Threema basic mode sends text only).',
    fr: 'Rien à envoyer : le texte est vide (le mode simple de Threema n’envoie que du texte).',
  },
  no_recipient: {
    en: 'No recipient: fill the list of allowed recipients in the configuration.',
    fr: 'Aucun destinataire : remplissez la liste des destinataires autorisés dans la configuration.',
  },
  recipient_invalid: {
    en: 'The recipient is not valid: a Threema ID (8 characters), a phone number starting with + or 00, or an e-mail address. Nothing was sent.',
    fr: 'Le destinataire n’est pas valide : un identifiant Threema (8 caractères), un numéro commençant par + ou 00, ou une adresse e-mail. Rien n’a été envoyé.',
  },
  recipient_not_allowed: {
    en: 'The recipient {to} is not in the list of allowed recipients of the configuration. Nothing was sent.',
    fr: 'Le destinataire {to} n’est pas dans la liste des destinataires autorisés de la configuration. Rien n’a été envoyé.',
  },
  forward_off: {
    en: 'Gladys messages to users are not forwarded to Threema (option off in the configuration). Nothing was sent.',
    fr: 'Les messages de Gladys aux utilisateurs ne passent pas par Threema (option décochée dans la configuration). Rien n’a été envoyé.',
  },
  contact_invalid: {
    en: 'The Threema recipient of this user (“My account”) is not valid. Nothing was sent.',
    fr: 'Le destinataire Threema de cet utilisateur (« Mon compte ») n’est pas valide. Rien n’a été envoyé.',
  },
  contact_not_allowed: {
    en: 'The Threema recipient {to} of this user (“My account”) is not in the list of allowed recipients of the configuration. Nothing was sent.',
    fr: 'Le destinataire Threema {to} de cet utilisateur (« Mon compte ») n’est pas dans la liste des destinataires autorisés de la configuration. Rien n’a été envoyé.',
  },
  contact_not_allowed_status: {
    en: 'Ready, but a Gladys message was not sent: the recipient {to} of a user (“My account”) is not in the list of allowed recipients.',
    fr: 'Prêt, mais un message de Gladys n’est pas parti : le destinataire {to} d’un utilisateur (« Mon compte ») n’est pas dans la liste des destinataires autorisés.',
  },
  server_error: {
    en: 'Threema Gateway failed (HTTP {status}): the message may have left. It is not sent again, and nothing is sent before {time} (UTC).',
    fr: 'Threema Gateway a échoué (HTTP {status}) : le message est peut-être parti. Il n’est pas renvoyé, et rien n’est envoyé avant {time} (UTC).',
  },
  unexpected_sent: {
    en: 'Threema Gateway gave an unexpected answer (HTTP {status}): the message may have left. It is not sent again.',
    fr: 'Threema Gateway a donné une réponse inattendue (HTTP {status}) : le message est peut-être parti. Il n’est pas renvoyé.',
  },
  check_paused: {
    en: 'Threema Gateway asked to slow down or failed: no request before {time} (UTC). No message is sent by this button.',
    fr: 'Threema Gateway a demandé de ralentir ou a échoué : aucune requête avant {time} (UTC). Ce bouton n’envoie aucun message.',
  },
  check_unreachable: {
    en: 'Threema Gateway could not be reached or did not answer in time. No message is sent by this button.',
    fr: 'Threema Gateway est injoignable ou n’a pas répondu à temps. Ce bouton n’envoie aucun message.',
  },
  stopped: {
    en: 'The integration is stopping.',
    fr: 'L’intégration s’arrête.',
  },
  // The buttons.
  check_ok: {
    en: 'Threema Gateway accepted the ID and the secret: {credits} credits left. Nothing was sent.',
    fr: 'Threema Gateway a accepté l’identifiant et le secret : il reste {credits} crédits. Rien n’a été envoyé.',
  },
  test_ok: {
    en: 'Test message sent to {to} in {ms} ms (one credit used).',
    fr: 'Message de test envoyé à {to} en {ms} ms (un crédit utilisé).',
  },
  test_text: {
    en: 'Test message from Gladys through Threema: it works.',
    fr: 'Message de test de Gladys via Threema : ça marche.',
  },
};

/** The text of `key` in `lang` ('fr' or English), placeholders filled. */
export function t(key, lang = 'en', vars = {}) {
  const entry = ALL_TEXTS[key] ?? ALL_TEXTS.unexpected;
  const text = lang === 'fr' ? entry.fr : entry.en;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Both languages, for setConnectionStatus and the action results. */
export function both(key, vars = {}) {
  return { en: t(key, 'en', vars), fr: t(key, 'fr', vars) };
}
