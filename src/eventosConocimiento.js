// Hechos de espacios y huecos. Lo que no está en el repo queda como placeholder,
// sin nombres de sala, aforos por sala ni equipos inventados.

const CAPACIDAD_TOTAL = 'de 500 a 700 personas';
const TERRAZA = 'terraza acristalada, privada, de 10 a 50 personas';
const HABITACIONES = '21 habitaciones dobles';
const MIN_PRIVADO = 10;
const MAX_AFORO = 700;

// Datos que la casa todavía no ha facilitado. El bot no los rellena.
const PLACEHOLDERS = [
  {
    id: 'nombre_salones',
    label: 'Nombre de cada salón',
    note: 'No consta ningún nombre de salón, aparte de la terraza acristalada.',
  },
  {
    id: 'aforo_por_salon',
    label: 'Capacidad de cada salón',
    note: 'Solo consta la terraza acristalada (10 a 50) y la capacidad total de los espacios (500 a 700).',
  },
  {
    id: 'equipamiento_av',
    label: 'Equipamiento audiovisual',
    note: 'No consta ningún equipo. No hay listado de proyección, sonido ni microfonía.',
  },
];

function placeholdersText() {
  return PLACEHOLDERS.map((p) => `• ${p.label}: [PENDIENTE] ${p.note}`).join('\n');
}

// Texto público para enlaces wa.me. Abre el flujo de boda y no otro.
const WEDDING_TRIGGER = 'Quiero información para mi boda';

function bodaIntro(businessName) {
  return (
    `💍 *Bodas en ${businessName}*\n\n` +
    `La hostería se reserva en exclusiva para la boda. El restaurante está recomendado en la Guía Michelin y tiene 1 Sol Repsol desde 2015. Hay ${HABITACIONES} para los invitados.\n\n` +
    `Bodega con más de 400 referencias, huerta propia y piscina de temporada. Se admiten mascotas. Los eventos grandes son una especialidad de la casa.\n\n` +
    `El menú y el precio van en un presupuesto a medida. El traslado del grupo se consulta según el tamaño y la fecha. La fecha no queda reservada hasta entonces.\n\n` +
    `Os mando unas fotos de bodas en la casa. Si queréis más, escribid *más fotos*.`
  );
}

function bodaSideAnswer(norm) {
  if (!norm) return null;
  if (/wedding planner|weddingplanner|organizador|proveedor|florista|dj propio|nuestro dj|nuestra dj/.test(norm)) {
    return 'Los proveedores y el wedding planner propios se consultan caso por caso.';
  }
  if (/menu infantil|\binfantil\b|\bninos\b|\bpeques\b|menu de ninos/.test(norm)) {
    return 'El menú infantil se adapta a petición, dentro del presupuesto a medida. Por aquí no cierro una carta ni un precio.';
  }
  if (/gluten|vegetar|celiac|vegano|alergi|sin lactosa|intoleran/.test(norm)) {
    return 'Sí. El menú se adapta a petición: gluten, vegetariano y otras necesidades. Lo deja el equipo en el presupuesto.';
  }
  if (/dj\b|musica|orquesta|violin|de madrugada|hasta tarde|hasta muy tarde|barra libre/.test(norm)) {
    return 'La música y el horario de la fiesta se consultan caso por caso. Lo anoto para el presupuesto.';
  }
  if (/mascota|\bperro\b|\bperros\b|\bgato\b|\bgatos\b/.test(norm)) {
    return 'Se admiten mascotas.';
  }
  if (/piscina/.test(norm)) {
    return 'Hay piscina de temporada.';
  }
  if (/bodega|\bvinos?\b|referencias/.test(norm)) {
    return 'La bodega tiene más de 400 referencias. El vino de la boda va en el presupuesto a medida.';
  }
  if (/huerta|\bhuerto\b/.test(norm)) {
    return 'La casa tiene huerta propia.';
  }
  if (/evento grande|macroevento|especialidad/.test(norm)) {
    return 'Los eventos grandes son una especialidad de la casa. El espacio se concreta en el presupuesto.';
  }
  if (/michelin|repsol/.test(norm)) {
    return 'El restaurante está recomendado en la Guía Michelin y tiene 1 Sol Repsol desde 2015.';
  }
  if (/habitacion|alojamiento|dormir|pernoct/.test(norm)) {
    return `Hay ${HABITACIONES} para los invitados. Si las queréis, lo anoto en la solicitud.`;
  }
  if (/exclusiv|privatiz/.test(norm)) {
    return 'La hostería se puede reservar en exclusiva para la boda.';
  }
  if (/jardin|ceremonia/.test(norm)) {
    return 'La ceremonia puede hacerse en la hostería, o solo el banquete. Lo concretamos en el presupuesto.';
  }
  if (/autobus|autocar|traslado|transporte|\bbus\b/.test(norm)) {
    return 'El traslado o el autobús del grupo se consulta según el tamaño y la fecha.';
  }
  if (/telefono|llamar|correo|\bemail\b|contacto/.test(norm)) {
    return 'El teléfono es el 923 37 00 76 y el correo reservas@donfadrique.com.';
  }
  if (/bebida|precio|cuanto cuesta|tarifa|\biva\b|plato|\bmenu\b|\bcarta\b|incluye|cuesta/.test(norm)) {
    return 'El menú y el precio son un presupuesto a medida. Por aquí no cierro platos ni una tarifa.';
  }
  return null;
}

function congresoIntro(businessName, lang) {
  if (lang === 'en') {
    return (
      `🏛️ *Events and congresses at ${businessName}*\n\n` +
      `We have been catering congresses and events for more than 20 years, at the venue you choose or here. ` +
      `Coffee breaks, lunches, cocktails or dinners: at the congress centre, another space, or the hotel.\n\n` +
      `The glazed terrace is for 10 to 50 and the gardens work for cocktails and dinners. ` +
      `Together the spaces hold 500 to 700 people.\n\n` +
      `If you need them, there are 21 double rooms for speakers or when city hotels are full. ` +
      `The team sends a tailored quote; I can’t give a price from here. ` +
      `The room (I still don’t have the name or the capacity of each one) and the audiovisual setup go in that quote.\n\n` +
      `I’ll take the details and leave it pending a quote. The date is not held.`
    );
  }
  return (
    `🏛️ *Eventos y congresos*\n\n` +
    `Llevamos más de 20 años con el catering de congresos y eventos, en la sede que elijáis o en ${businessName}. ` +
    `Coffee break, comida, cóctel o cena: en el Palacio de Congresos, en otro espacio o aquí.\n\n` +
    `La terraza acristalada es para 10 a 50 y los jardines sirven para cócteles y cenas de comité o ponentes. ` +
    `Los espacios, juntos, admiten de 500 a 700 personas.\n\n` +
    `Si lo necesitáis, hay 21 habitaciones dobles para ponentes o cuando los hoteles de la ciudad están llenos. ` +
    `El equipo prepara un presupuesto a medida; por aquí no cierro precios. ` +
    `El salón (aún no tengo el nombre ni el aforo de cada uno) y el audiovisual van en ese presupuesto.\n\n` +
    `Tomo los datos y queda pendiente de presupuesto: la fecha no se reserva sola.`
  );
}

function congresoSideAnswer(norm, lang) {
  if (!norm) return null;
  const catering = /catering|caterin|cattering|\bcater\b|coffee break|a domicilio|fuera del hotel|fuera de la hosteria|en nuestra sede|off site|off-?site|at our venue|at the venue|another venue|otro espacio|otra sede|otro sitio|otro lugar/.test(
    norm
  );
  const rooms = /habitacion|alojamiento|dormir|pernoct|ponente|comite|speaker|committee|overflow|\brooms?\b/.test(norm);
  const hotelMeal = /terraza|jardin|coctel|cocktail|gala|comida de comite|cena de gala|lunch|dinner/.test(norm);
  const price = /precio|cuanto cuesta|cuanto vale|tarifa|\biva\b|how much|what does it cost|quote|rate/.test(norm);
  const en = lang === 'en';
  if (catering) {
    return en
      ? 'Yes. We cater at the congress venue or at any other place you choose: coffee breaks, lunches, cocktails or dinners. Committee, speaker and gala meals can also be here, on the glazed terrace (10 to 50) or in the gardens. There are 21 double rooms for speakers, the committee, or when city hotels are full. The price is in the tailored quote.'
      : 'Sí. Hacemos catering en la sede del congreso o en cualquier otro espacio que elijáis: coffee break, comida, cóctel o cena. Las comidas y cenas de comité, ponentes o gala también pueden ser aquí, en la terraza acristalada (10 a 50) o en los jardines. Hay 21 habitaciones dobles para ponentes, el comité o si los hoteles de la ciudad están llenos. El precio va en el presupuesto a medida.';
  }
  if (rooms && !price) {
    return en
      ? 'There are 21 double rooms for speakers, the committee, or extra guests when the hotels in the city are full. Whether you need them, and the rate, go in the quote.'
      : 'Hay 21 habitaciones dobles para ponentes, el comité o asistentes si los hoteles de la ciudad están llenos. Si las necesitáis, y la tarifa, van en el presupuesto.';
  }
  if (hotelMeal && !price) {
    return en
      ? 'Committee, speaker and gala lunches or dinners can be at the hotel. The glazed terrace is private, for 10 to 50, and the gardens work for cocktails and dinners. The menu and the price are in the quote.'
      : 'Las comidas y cenas de comité, ponentes o gala pueden ser en la hostería. La terraza acristalada es privada, de 10 a 50, y los jardines sirven para cócteles y cenas. El menú y el precio van en el presupuesto.';
  }
  if (price) {
    return en
      ? 'The congress, the rooms and the catering are a tailored quote. I can’t give a rate from here.'
      : 'El congreso, las habitaciones y el catering van en un presupuesto a medida. Por aquí no cierro tarifas.';
  }
  return null;
}

function answerSideQuestion(norm, flow, lang) {
  if (flow === 'boda') {
    const wedding = bodaSideAnswer(norm);
    if (wedding) return wedding;
  }
  if (flow === 'congreso') {
    const congress = congresoSideAnswer(norm, lang);
    if (congress) return congress;
  }
  if (/vino|bebida|barra libre|cava|copas?/.test(norm)) {
    return (
      'La bebida y la barra libre se detallan en el presupuesto. ' +
      'Las comidas de Navidad para empresas son un menú a medida, desde 55 € + IVA por persona.'
    );
  }
  if (/dj\b|musica en directo|suplemento/.test(norm)) {
    return 'El DJ y otros suplementos, si se pueden añadir y a qué precio, se detallan en el presupuesto.';
  }
  if (/alergi|intoleran|celiac|menu infantil|ninos|niños|cancelac|señal|senal|deposito|depósito|anticipo|plazo/.test(norm)) {
    return 'La señal, el plazo para cerrar el número de comensales, el menú infantil, las alergias y la cancelación de grupos se detallan en el presupuesto.';
  }
  if (/sustit|alternativ|cambiar (el |un )?plato|otro plato|plato de reserva|que incluye|que lleva|que tiene|platos|carta|detalle|gran gala|mediodia|menu navidad/.test(norm)) {
    return (
      'Las comidas de Navidad para empresas son un menú a medida, desde 55 € + IVA por persona. ' +
      'Los platos los propone el equipo en el presupuesto.'
    );
  }
  if (/habitacion|alojamiento|dormir|tarifa de grupo|tarifa grupo|pernoct/.test(norm)) {
    return `Hay ${HABITACIONES} por si el grupo se queda. La tarifa de grupo y las condiciones se detallan en el presupuesto.`;
  }
  if (/audiovisual|\bav\b|proyector|microfono|microfon|sonido|pantalla/.test(norm)) {
    return 'Puedo anotar que necesitáis audiovisual. El equipamiento no lo tengo listado: se detalla en el presupuesto.';
  }
  if (/terraza|salon|privado|aforo|capacidad|espacio/.test(norm)) {
    return (
      `La ${TERRAZA}. Entre todos los espacios caben ${CAPACIDAD_TOTAL}. ` +
      `El nombre y el aforo de cada salón se concretan en el presupuesto.`
    );
  }
  if (/minimo|mínimo|minimos|mínimos/.test(norm)) {
    return (
      `El espacio privado es desde ${MIN_PRIVADO} personas, y la terraza acristalada cubre de 10 a 50. ` +
      `Cualquier otro mínimo se detalla en el presupuesto.`
    );
  }
  if (/\biva\b|precio|cuanto cuesta|cuánto cuesta|tarifas?/.test(norm)) {
    return (
      'Las comidas de Navidad para empresas son un menú a medida, desde 55 € + IVA por persona.\n' +
      'Un congreso o un evento grande se presupuesta aparte: no tengo una tarifa cerrada de salas.'
    );
  }
  return null;
}

function blocksWedding(norm) {
  if (/\bboda|preboda|postboda|casar|enlace|pedida|ceremonia civil/.test(norm)) return false;
  if (/\bnavidad\b|\bnochebuena\b|\bnochevieja\b|\bnoche vieja\b|\bano nuevo\b/.test(norm)) return true;
  if (/\b(comida|almuerzo|cena)s?\s+(de\s+)?(la\s+|una\s+)?empresa\b/.test(norm)) return true;
  if (/\bhabitaciones?\b|\bhotel\b|\bdormir\b|\balojamiento\b/.test(norm)) return true;
  if (/\bmesas?\b/.test(norm)) return true;
  return false;
}

function isBodaTopic(norm) {
  if (!norm) return false;
  if (blocksWedding(norm)) return false;
  const collapsed = String(norm).replace(/\s+/g, ' ').trim();
  if (collapsed.includes('quiero informacion para mi boda')) return true;
  if (/\bbodas?\b/.test(norm)) return true;
  if (/\bprebodas?\b|\bpostbodas?\b/.test(norm)) return true;
  if (/\baniversario de boda\b/.test(norm)) return true;
  if (/\bpedida\b/.test(norm)) return true;
  if (/\bceremonia civil\b/.test(norm)) return true;
  if (/\benlace\b/.test(norm)) return true;
  if (/\bcasamiento\b|\bcasamos\b|\bcasar(me|te|se|nos|os)?\b/.test(norm)) return true;
  if (/\bbanquete de boda\b/.test(norm)) return true;
  return false;
}

// Evento de empresa que no es una comida de Navidad: va al presupuesto de congreso/evento.
function isCorporateEvent(norm) {
  if (!norm) return false;
  if (/navidad|nochebuena|nochevieja/.test(norm)) return false;
  return /\beventos?\s+(de|para)\s+(la\s+|una\s+)?empresas?\b|\beventos?\s+corporativ|\beventos?\s+empresarial\b|\bjornadas?\s+de\s+empresas?\b/.test(
    norm
  );
}

function isCateringIntent(norm) {
  if (!norm) return false;
  if (/navidad|nochebuena|nochevieja|noche vieja|ano nuevo/.test(norm)) return false;
  return /\bcaterings?\b|\bcaterin\b|\bcattering\b|\bcoffee breaks?\b|\bservicio de catering\b/.test(norm);
}

function isCongresoTopic(norm) {
  if (!norm) return false;
  if (/navidad|nochebuena|nochevieja|noche vieja|ano nuevo/.test(norm)) return false;
  if (isCateringIntent(norm)) return true;
  if (/\bjornadas?\b|\bsimposios?\b|\bsymposiums?\b|\bsymposia\b/.test(norm)) return true;
  if (/\balmuerzo de trabajo\b/.test(norm)) return true;
  if (/\bcoctel(?:es)?\b|\bcocktails?\b/.test(norm)) return true;
  if (
    /\b(?:comida|almuerzo|cena|lunch|dinner)s?\b/.test(norm) &&
    /\botro sitio\b|\botro lugar\b|\botra sede\b|\botro espacio\b|\ba domicilio\b|\bfuera\b/.test(norm)
  ) {
    return true;
  }
  if (
    /\bcongresos?\b|\bcongress(?:es)?\b|\bconvenciones?\b|\bconvencion\b|\bconventions?\b|\bseminarios?\b|\bseminars?\b|\bconferencias?\b|\bconferences?\b|\bmacroeventos?\b|\beventos? grandes?\b|\bgran evento\b/.test(
      norm
    )
  ) {
    return true;
  }
  return isCorporateEvent(norm);
}

function isHubTopic(norm) {
  if (/^(evento|eventos|celebracion|celebraciones)$/.test(norm)) return true;
  if (/organizar un evento|hacer un evento|quiero un evento|reservar un evento|un evento en/.test(norm)) return true;
  return false;
}

function isOtivmQuery(norm) {
  return /\botivm\b|\bpiscina\b|\bbrunch\b|\btardeo\b|\bpool\b/.test(norm);
}

function spaceHint(partySize) {
  if (partySize <= 50) {
    return 'Para ese número encaja la terraza acristalada (10 a 50), en privado.';
  }
  return 'Por encima de 50 personas hace falta salón. El nombre y el aforo de cada sala se concretan en el presupuesto. La capacidad total es de 500 a 700.';
}

module.exports = {
  CAPACIDAD_TOTAL,
  TERRAZA,
  HABITACIONES,
  MIN_PRIVADO,
  MAX_AFORO,
  PLACEHOLDERS,
  placeholdersText,
  WEDDING_TRIGGER,
  bodaIntro,
  congresoIntro,
  congresoSideAnswer,
  answerSideQuestion,
  isBodaTopic,
  isCorporateEvent,
  isCateringIntent,
  isCongresoTopic,
  isHubTopic,
  isOtivmQuery,
  spaceHint,
};
