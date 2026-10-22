// Menús de empresa de diciembre 2026. Platos copiados del documento de la casa.
// No añadir platos, precios ni vinos que no estén aquí.

const MENUS = [
  {
    id: 'mediodia',
    name: 'Menú Mediodía',
    oneLiner: 'Pensado para comidas de empresa entre semana, con un servicio más ágil.',
    priceShort: 'Precio a consultar (+ IVA)',
    courses: [
      {
        label: 'Aperitivo',
        text: 'fiambres navideños (pastrami ibérico, paté navideño, croqueta de jamón)',
      },
      {
        label: 'Entrante (a elegir uno para todo el grupo)',
        text: 'ensalada de rúcula con nueces, granada y stracciatella artesana, o consomé de faisán con su albóndiga',
      },
      {
        label: 'Principal (a elegir uno para todo el grupo)',
        text: 'cochinillo asado tradicional, o lubina con ajada',
      },
      { label: 'Postre', text: 'chocolate de Navidad' },
    ],
  },
  {
    id: 'navidad',
    name: 'Menú Navidad',
    oneLiner: 'Menú completo de fiesta.',
    priceShort: '65 € + IVA por persona',
    courses: [
      { label: 'Aperitivo', text: 'jamón, gambas, paté de pato y fiambres navideños' },
      { label: 'Entrante', text: 'alcachofa con pistacho y café' },
      { label: 'Pescado', text: 'lubina' },
      { label: 'Asado', text: 'cochinillo de Navidad (alternativa posible: tostón a la leña)' },
      { label: 'Postre', text: 'mazapán carmelita' },
    ],
  },
  {
    id: 'gran_gala',
    name: 'Menú Gran Gala',
    oneLiner: 'Celebración premium, con vinos incluidos.',
    priceShort: '110 € + IVA por persona, vinos incluidos',
    courses: [
      { label: 'Aperitivo de pie', text: 'jamón, gambas y anchoa' },
      { label: 'Aperitivo sentado', text: 'capuccino de lentejas con perdiz' },
      {
        label: 'Entrante',
        text: 'buñuelo de gambas con jugo de sus cabezas, o ahumado nórdico de trucha con sus huevas',
      },
      { label: 'Pescado', text: 'lubina o besugo, según mercado' },
      { label: 'Sorbete', text: 'granizado de champán' },
      { label: 'Carne', text: 'venado de Navidad con ragú de setas, o solomillo Wellington' },
      {
        label: 'Postre',
        text: 'tatin de manzana con helado de mango, o cremoso de queso con almendra amarga y helado de turrón',
      },
    ],
  },
];

// Platos de reserva del documento, solo si piden una sustitución. No forman parte del menú cerrado.
const SUSTITUCIONES = {
  entrantes: [
    'calabaza mágica con sabores y texturas',
    'tatin de jamón y foie',
    'palito de merluza con ajoaceite y aceituna negra',
    'sopa tradicional marinera',
    'consomé de faisán con su albóndiga',
  ],
  principales: ['lechazo royal', 'cabrito cuchifrito', 'solomillo', 'tostón a la leña'],
  postres: [
    'cuajada de leche cruda con helado de fresa ácida',
    'lingote de chocolate con pimienta, nuez moscada y AOVE',
    'roscón',
  ],
};

const MENU_BY_ID = Object.fromEntries(MENUS.map((m) => [m.id, m]));

function overviewText(businessName) {
  const lines = MENUS.map((m) => `• *${m.name}* — ${m.oneLiner} ${m.priceShort}.`);
  return (
    `🎄 *Menús de empresa · diciembre 2026*\n\n` +
    `En ${businessName} están disponibles todo el mes, en comida y en cena. Todos los precios son + IVA.\n\n` +
    `${lines.join('\n')}\n\n` +
    `Espacio privado desde 10 personas. Terraza acristalada de 10 a 50; grupos mayores, en los salones (capacidad total de 500 a 700).\n\n` +
    `Elige un menú y te detallo los platos, o escribe *solicitar* para pedir presupuesto.`
  );
}

function detailText(menuId) {
  const menu = MENU_BY_ID[menuId];
  if (!menu) return null;
  const courses = menu.courses.map((c) => `• *${c.label}:* ${c.text}`).join('\n');
  return (
    `*${menu.name}*\n${menu.oneLiner} ${menu.priceShort}.\n\n` +
    `${courses}\n\n` +
    `Todo diciembre, comida o cena. La bebida, los mínimos y la tarifa de grupo del hotel se detallan en el presupuesto.\n\n` +
    `¿Lo pido para tu empresa?`
  );
}

const OVERVIEW_BUTTONS = [
  { id: 'emp_mediodia', title: 'Menú Mediodía' },
  { id: 'emp_navidad', title: 'Menú Navidad' },
  { id: 'emp_gala', title: 'Menú Gran Gala' },
];

const DETAIL_BUTTONS = [
  { id: 'emp_book', title: 'Solicitar este' },
  { id: 'emp_overview', title: 'Ver los tres' },
  { id: 'emp_home', title: 'Inicio' },
];

function menuIdFromButton(buttonId) {
  if (buttonId === 'emp_mediodia') return 'mediodia';
  if (buttonId === 'emp_navidad') return 'navidad';
  if (buttonId === 'emp_gala') return 'gran_gala';
  return null;
}

function singleMenuId(norm) {
  const ids = [];
  if (/gran gala/.test(norm)) ids.push('gran_gala');
  if (/mediodia/.test(norm)) ids.push('mediodia');
  if (/menu navidad/.test(norm) || /navidad completo/.test(norm)) ids.push('navidad');
  if (ids.length !== 1) return null;
  return ids[0];
}

// Petición explícita de un menú. "menús de Navidad" y "navidad" a secas se quedan en el resumen.
function explicitMenuDetail(norm) {
  if (/\bmenus\b/.test(norm)) return null;
  if (/^navidad$|feliz navidad/.test(norm)) return null;
  if (/de navidad$/.test(norm) && !/menu navidad|gran gala|mediodia/.test(norm)) {
    if (!/detalle|que incluye|que lleva|que tiene|platos/.test(norm)) return null;
  }
  const id = singleMenuId(norm);
  if (!id) return null;
  if (/detalle|que incluye|que lleva|que tiene|platos|ver el|carta/.test(norm)) return id;
  if (/menu de navidad/.test(norm)) return null;
  if (norm.length <= 36) return id;
  return null;
}

function isEmpresaTopic(norm) {
  if (/\bempresas?\b/.test(norm)) return true;
  if (/navidad|nochebuena|nochevieja/.test(norm)) return true;
  if (/gran gala|menu mediodia|menu del mediodia/.test(norm)) return true;
  return false;
}

function sustitucionesText() {
  return (
    `Si hay que cambiar algún plato, el equipo lo confirma en el presupuesto. Platos de reserva posibles:\n\n` +
    `Entrantes: ${SUSTITUCIONES.entrantes.join(' · ')}\n` +
    `Principales: ${SUSTITUCIONES.principales.join(' · ')}\n` +
    `Postres: ${SUSTITUCIONES.postres.join(' · ')}`
  );
}

module.exports = {
  MENUS,
  MENU_BY_ID,
  SUSTITUCIONES,
  OVERVIEW_BUTTONS,
  DETAIL_BUTTONS,
  overviewText,
  detailText,
  menuIdFromButton,
  singleMenuId,
  explicitMenuDetail,
  isEmpresaTopic,
  sustitucionesText,
};
