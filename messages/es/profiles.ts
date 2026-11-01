import type { Translation } from '@solara/core/i18n'
import type profiles from '../profiles'

export default {
  switchProfile: 'Cambiar de perfil',
  profiles: 'Perfiles',
  tickWho:
    'Marca quién va. Los planes y los tiempos hasta quemarse siguen a quien se quema más rápido.',
  mostSensitive: 'Más sensible',
  active: 'Activo',
  addPerson: '＋ Agregar persona o mascota',
  planForGroup: 'Planificar para un grupo',
  groupHint: 'Usa la piel de la persona más sensible en todos los planes.',
  addSomeone: 'Agrega a alguien para planificar en grupo según la persona más sensible.',
  familyComesWithPro: 'Los perfiles familiares vienen con Pro',
  icon: 'Ícono',
  name: 'Nombre',
  namePlaceholder: 'Nombre (p. ej., Ana, Toby)',
  skinType: 'Tipo de piel',
  delete: 'Eliminar',
  cancel: 'Cancelar',
  groupOf: n => `Grupo de ${n}`,
  profileGroup: (n, person) => `Perfil: grupo de ${n}, planificado para ${person}`,
  profileNamed: name => `Perfil: ${name}`,
  limitReached: limit => `Llegaste al límite de perfiles (${limit}).`,
  onChecked: '✓ Activado',
  off: 'Desactivado',
  skinOf: skin => `Piel ${skin.toLowerCase()}`,
  familyOffer: people =>
    `Planifica para hasta ${people} personas y mascotas, cada una con su tipo de piel, y organiza un día en familia según quien se quema más rápido.`,
  notOnSale: ' Pro todavía no está a la venta: únete a la lista de espera para saber cuándo abre.',
  joinWaitlist: 'Unirme a la lista de espera de Pro',
  seePro: 'Ver Pro',
  editNamed: name => `Editar ${name}`,
  skinOption: (skin, type) => `Piel ${skin.toLowerCase()} (tipo ${type})`,
  add: 'Agregar',
  save: 'Guardar',
} satisfies Translation<typeof profiles>
