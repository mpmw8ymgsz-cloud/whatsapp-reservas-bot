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

function congresoIntro(businessName) {
  return (
    `🏛️ *Eventos y congresos*\n\n` +
    `Los eventos grandes y los congresos son la especialidad de ${businessName}. ` +
    `Los espacios, juntos, admiten ${CAPACIDAD_TOTAL}. La ${TERRAZA}. ` +
    `Hay ${HABITACIONES}; la tarifa de grupo se detalla en el presupuesto.\n\n` +
    `En el presupuesto el equipo concretará lo que aquí no puedo cerrar:\n` +
    `• el salón (aún no tengo el nombre ni el aforo de cada uno);\n` +
    `• el audiovisual (aún no tengo el equipamiento).\n\n` +
    `Tomo los datos y queda pendiente de presupuesto: la fecha no se reserva sola.`
  );
}

function answerSideQuestion(norm) {
  if (/vino|bebida|barra libre|cava|copas?/.test(norm)) {
    return (
      `En el Menú Gran Gala los vinos van incluidos. Qué vinos, y la bebida del Menú Navidad y del Menú Mediodía, se detallan en el presupuesto. ` +
      `La barra libre también. Todos los precios son + IVA.`
    );
  }
  if (/dj\b|musica en directo|suplemento/.test(norm)) {
    return 'El DJ y otros suplementos, si se pueden añadir y a qué precio, se detallan en el presupuesto.';
  }
  if (/alergi|intoleran|celiac|menu infantil|ninos|niños|cancelac|señal|senal|deposito|depósito|anticipo|plazo/.test(norm)) {
    return 'La señal, el plazo para cerrar el número de comensales, el menú infantil, las alergias y la cancelación de grupos se detallan en el presupuesto.';
  }
  if (/sustit|alternativ|cambiar (el |un )?plato|otro plato|plato de reserva/.test(norm)) {
    return require('./menusEmpresa').sustitucionesText();
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
      `Todos los precios son + IVA.\n` +
      `• Menú Mediodía: precio a consultar (+ IVA).\n` +
      `• Menú Navidad: 65 € + IVA por persona.\n` +
      `• Menú Gran Gala: 110 € + IVA por persona, vinos incluidos.\n` +
      `Un congreso o un evento grande se presupuesta aparte: no tengo una tarifa cerrada de salas.`
    );
  }
  return null;
}

function isCongresoTopic(norm) {
  return /congresos?|convenciones?|convencion|seminarios?|conferencias?|macroeventos?|eventos? grandes?|gran evento/.test(norm);
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
  congresoIntro,
  answerSideQuestion,
  isCongresoTopic,
  isHubTopic,
  isOtivmQuery,
  spaceHint,
};
