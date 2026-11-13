// Comidas de Navidad para empresas: un solo menú a medida.
// No hay carta cerrada ni precios por menú tipificado.

const conocimiento = require('./eventosConocimiento');
const fiesta = require('./menusFiesta');

const OFFER_NAME = 'Comidas de Navidad para empresas';
const PRICE_SHORT = 'desde 55 € + IVA por persona';

const OFFER_BUTTONS = [
  { id: 'emp_book', title: 'Pedir presupuesto' },
  { id: 'emp_home', title: 'Inicio' },
];

function overviewText(businessName) {
  return (
    `🎄 *${OFFER_NAME}*\n\n` +
    `En ${businessName} preparamos un menú a medida, en comida o en cena, todo diciembre de 2026.\n\n` +
    `*${PRICE_SHORT}.*\n\n` +
    `Espacio privado desde 10 personas. Terraza acristalada de 10 a 50; grupos mayores, en los salones (capacidad total de 500 a 700).\n\n` +
    `La bebida, los mínimos y la tarifa de grupo se detallan en el presupuesto. Los platos los propone el equipo ahí, no los cierro por aquí.\n\n` +
    `Los menús oficiales de Navidad, Nochevieja y Año Nuevo se pueden ver como referencia. Escribe *menús* y te los envío.\n\n` +
    `Escribe *solicitar* y tomo los datos. La fecha no queda reservada hasta el presupuesto.`
  );
}

function isEmpresaTopic(norm) {
  if (!norm) return false;
  // «evento de empresa» (sin Navidad) es un evento corporativo, no la comida de diciembre.
  if (conocimiento.isCorporateEvent(norm)) return false;
  if (/\bempresas?\b/.test(norm)) return true;
  // Nochevieja, Año Nuevo y el menú de Navidad (25 de diciembre) son la carta oficial.
  if (/\bnochevieja\b|\bnoche vieja\b|\bano nuevo\b/.test(norm)) return false;
  if (fiesta.isOfficialMenuTopic(norm)) return false;
  if (/\bmenu de navidad\b/.test(norm) && !/\bmenus de navidad\b/.test(norm)) return false;
  if (/\bmenu navidad\b/.test(norm) && !/\bmenus\b/.test(norm)) return false;
  if (/navidad|nochebuena/.test(norm)) return true;
  if (/gran gala|menu mediodia|menu del mediodia|menu a medida|a medida/.test(norm)) return true;
  return false;
}

module.exports = {
  OFFER_NAME,
  PRICE_SHORT,
  OFFER_BUTTONS,
  overviewText,
  isEmpresaTopic,
};
