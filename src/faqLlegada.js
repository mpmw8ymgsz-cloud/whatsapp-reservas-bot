// Dirección oficial de la hostería. Sin aparcamiento, líneas de bus ni tiempos de viaje:
// eso no está documentado.

const ADDRESS = 'Ctra. de Salamanca – Alba de Tormes km 17, 37800 Alba de Tormes (Salamanca)';

function mapsUrl() {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ADDRESS)}`;
}

function isParkingQuery(norm) {
  return /parking|aparcamiento|aparcar/.test(norm || '');
}

function isLocationQuery(norm) {
  return /como llegar|como se va|donde estais|donde esta|donde os|ubicacion|direccion|google maps|\bmapa\b|parking|aparcamiento|aparcar/.test(
    norm || ''
  );
}

function isTransportQuery(norm) {
  return /autobus|autocar|shuttle|traslado|transporte|\bbus\b/.test(norm || '');
}

function isMostlyFaq(norm) {
  const rest = (norm || '')
    .replace(/autobuses|autobus|autocares|autocar|shuttle|traslados|traslado|transportes|transporte|\bbus\b/g, ' ')
    .replace(/parking|aparcamiento|aparcar/g, ' ')
    .replace(/como llegar|como se va|donde estais|donde esta|donde os|ubicacion|direccion|google maps|\bmapa\b/g, ' ')
    .replace(/\b(hay|teneis|poneis|podeis|puede|el|la|los|las|un|una|desde|para|grupos|grupo|salamanca|alba|de|del|al|en|nos|os|me|se|va|ir|a|y|que|como|donde)\b/g, ' ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
  return rest.length < 4;
}

function shouldAnswerNow(raw, norm) {
  if (/\?/.test(raw || '')) return true;
  if (/^(que |cual |cuanto |cuanta |teneis |hay |podeis |puede |poneis |donde |como )/.test(norm || '')) return true;
  return isMostlyFaq(norm);
}

function locationReply(business, { parking }) {
  let body =
    `📍 *Cómo llegar a ${business.name}*\n\n` +
    `${ADDRESS}\n\n` +
    `En el GPS o en Google Maps, busca esa dirección:\n${mapsUrl()}\n\n` +
    `📞 ${business.phone}\n🌐 ${business.web}`;
  if (parking) {
    body += '\n\nEl aparcamiento no lo tengo detallado por aquí. Con esa dirección el GPS llega a la hostería.';
  }
  return body;
}

function transportReply({ inFlow }) {
  const base =
    'El traslado o el autobús se estudia según el tamaño del grupo y la fecha, y se presupuesta aparte. ' +
    'No forma parte fija de la reserva: depende de cada grupo.';
  if (inFlow) {
    return `${base}\n\nLo dejo anotado en la solicitud para que el equipo lo confirme en el presupuesto.`;
  }
  return (
    `${base}\n\n` +
    'Si quieres, escribe *comidas de Navidad* o *congreso* y tomo los datos. El equipo lo confirma en el presupuesto.'
  );
}

function reply({ location, transport, parking, business, inFlow }) {
  const parts = [];
  if (location || parking) parts.push(locationReply(business, { parking: !!parking }));
  if (transport) parts.push(transportReply({ inFlow: !!inFlow }));
  return parts.join('\n\n');
}

module.exports = {
  ADDRESS,
  mapsUrl,
  isParkingQuery,
  isLocationQuery,
  isTransportQuery,
  shouldAnswerNow,
  locationReply,
  transportReply,
  reply,
};
