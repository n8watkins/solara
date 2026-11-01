import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'
import styles from '@/components/LegalPolicy.module.css'
import LegalDetail from '@/components/LegalDetail'
import AnalyticsPreferenceControl from '@/components/AnalyticsPreferenceControl'
import { isAnalyticsMeasurementId } from '@/lib/analytics-consent'
import { TRANSLATED_FROM, legalDate } from '@/lib/legal'
import { localePath, pageMetadata } from '@/lib/page-language'
import { privacySwitches, recaptchaScope, retentionLines } from '@/lib/privacy-retention'

// The privacy policy in Spanish (ROADMAP item 46): a full translation of
// app/privacy/page.tsx, of the English version dated TRANSLATED_FROM.es.privacy
// (lib/legal.ts); the English version prevails. A native speaker and counsel review it
// (docs/i18n/es-review.md). Section for section and item for item as the English, which
// lib/privacy-policy.test.ts checks.

const TRANSLATES = TRANSLATED_FROM.es!.privacy

export const metadata: Metadata = pageMetadata({
  title: 'Política de privacidad | Solara',
  description:
    'Quién opera Solara, qué recopila y por qué, quién lo procesa, cuánto tiempo se guarda y tus derechos.',
  path: '/privacy/',
  locale: 'es',
})

export default function PrivacyPage() {
  const analyticsEnabled = isAnalyticsMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)
  const switches = privacySwitches()
  const kept = retentionLines(switches, 'es')
  const english = localePath('/privacy/', 'en')

  return (
    <LegalPage
      title="Política de privacidad"
      updated={legalDate(TRANSLATES, 'es')}
      path="/privacy/"
      locale="es"
      notice={
        <>
          Esta es una traducción de la{' '}
          <a href={english} hrefLang="en" lang="en">
            versión en inglés
          </a>{' '}
          del {legalDate(TRANSLATES, 'es')}. Si hay alguna diferencia entre ambas, prevalece la
          versión en inglés.
        </>
      }
    >
      <div className={styles.policy}>
        <h2>Quién opera Solara</h2>
        <p>
          Solara es operado por <LegalDetail name="operatorName" locale="es" />, responsable del
          tratamiento de la información personal que se describe aquí.
        </p>
        <p>
          Para preguntas o solicitudes sobre privacidad, escribe a{' '}
          <LegalDetail name="contactEmail" locale="es" />.
        </p>

        <h2>Qué recopila Solara</h2>
        <ul>
          <li>
            <strong>Datos de la cuenta.</strong> Cuando inicias sesión con Google, Solara recibe el
            identificador de tu cuenta de Firebase, tu nombre, tu dirección de correo electrónico y
            tu foto de perfil.
          </li>
          <li>
            <strong>Ubicación.</strong> El lugar que eliges para los pronósticos, guardado como el
            nombre de una ciudad y coordenadas redondeadas a dos decimales (alrededor de 1 km). Si
            usas la ubicación de tu dispositivo, se redondea de la misma forma antes de enviarse a
            cualquier lugar o guardarse. Solara no rastrea tu ubicación en segundo plano.
          </li>
          <li>
            <strong>Preferencias.</strong> Perfil de piel, actividades, lugares guardados, horario
            para planificar en el calendario, apariencia, hora de las notificaciones y otras
            opciones de configuración.
          </li>
          <li>
            <strong>Idioma.</strong> El idioma que eliges en Configuración o, con Automático, el que
            Solara deduce de tu dispositivo (inglés o español, nunca la lista completa de idiomas de
            tu dispositivo), guardado con tu cuenta para escribir en él las notificaciones, los
            recordatorios y el calendario suscrito. Con Automático, lo fija el último dispositivo en
            que abres Solara.
          </li>
          <li>
            <strong>La lista de espera de Pro</strong>, solo si te unes: la dirección de correo que
            indicas y cuándo te uniste, guardadas con tu cuenta para que Solara pueda avisarte
            cuando Pro esté disponible. Para salir de la lista de espera, escribe a{' '}
            <LegalDetail name="contactEmail" locale="es" />.
          </li>
          <li>
            <strong>Disponibilidad de Google Calendar</strong>, solo si lo conectas: los horarios en
            que estás ocupado, que se leen en tu navegador para planificar y que Solara no guarda.
            Para la disponibilidad, Solara nunca ve los títulos, las descripciones, las ubicaciones
            ni los asistentes de los eventos. Si agregas una actividad planificada a tu calendario,
            Solara crea ese único evento en un calendario tuyo.
          </li>
          <li>
            <strong>Actividades programadas</strong>, para los eventos que Solara agregó a tu
            calendario: el identificador del evento, su hora de inicio y de fin, su zona horaria, su
            título y su enlace, y para cuál de tus actividades es, para que Solara pueda mostrarlo y
            administrarlo en todos tus dispositivos.
          </li>
          <li>
            <strong>Eventos importados</strong>, si importas un archivo de calendario (.ics): de
            cada evento próximo, su título, su hora de inicio y de fin, su zona horaria, el texto de
            su ubicación, su enlace, el lugar para el que Solara hace el pronóstico (coordenadas
            redondeadas a dos decimales) y a cuál de tus actividades corresponde. El archivo se lee
            en tu navegador; las descripciones, los organizadores y los asistentes que contenga
            nunca se guardan ni se envían a ningún lugar.
          </li>
          <li>
            <strong>Calendarios vinculados</strong>, donde se ofrecen (con Pro), si vinculas la
            dirección de un calendario (https:// o webcal://): la dirección, que se guarda en los
            servidores de Solara y nunca se vuelve a mostrar en la app porque puede contener un
            token privado; el nombre de su sitio y su etiqueta; y cuándo se revisó por última vez y
            cómo resultó. Los servidores de Solara consultan la dirección cada pocas horas desde
            Google Cloud y guardan sus eventos próximos como los importados.
          </li>
          <li>
            <strong>Eventos de tu Google Calendar</strong>, donde se ofrece, si lo activas: cuáles
            de tus calendarios elegiste (el identificador y el nombre de cada calendario; tu
            calendario principal se registra solo como &ldquo;primary&rdquo;) y cuándo se leyeron
            por última vez; y, de cada evento próximo de los siguientes 30 días cuya ubicación está
            escrita como una dirección o que coincide con una de tus actividades, su título, su hora
            de inicio y de fin, su zona horaria, el texto de su ubicación, el lugar para el que
            Solara hace el pronóstico y a qué actividad corresponde, guardados como los eventos
            importados. Los demás eventos, las descripciones, los asistentes, los organizadores, los
            enlaces de reuniones, los números y códigos de acceso telefónico y los enlaces de los
            eventos nunca se guardan, y ningún token de acceso de Google se guarda en ningún lugar.
          </li>
          <li>
            <strong>Eventos de tu calendario de Outlook</strong>, donde se ofrece, si lo activas:
            cuáles de tus calendarios de Outlook.com o Microsoft 365 elegiste (el identificador de
            Microsoft y el nombre de cada calendario; tu calendario principal se registra solo como
            &ldquo;default&rdquo;) y cuándo se leyeron por última vez; y, de cada evento próximo de
            los siguientes 30 días cuya ubicación está escrita como una dirección, es un lugar
            elegido en Outlook o que coincide con una de tus actividades, su título, su hora de
            inicio y de fin, su zona horaria, el texto de su ubicación, el lugar para el que Solara
            hace el pronóstico y a qué actividad corresponde, guardados como los eventos importados.
            Los demás eventos, las notas, los asistentes, los organizadores, los enlaces de
            reuniones, los números y códigos de acceso telefónico, y las salas de oficina y los
            domicilios que Outlook marca como tales, nunca se guardan; la cuenta de Microsoft con la
            que iniciaste sesión nunca se guarda (tu navegador lee la dirección a la que pertenece
            cada calendario, en memoria, solo para dejar fuera los calendarios que otras personas
            comparten contigo); y ningún token de acceso ni de actualización de Microsoft se guarda
            en ningún lugar.
          </li>
          <li>
            <strong>Calendario suscrito y notificaciones</strong>, si los activas: un token privado
            del calendario y el registro de notificaciones push de tu dispositivo.
          </li>
          <li>
            <strong>Recordatorios de protector solar</strong>, si inicias el temporizador de
            protector solar con tu sesión iniciada y las alertas están disponibles: cuándo te
            aplicaste protector solar por última vez, si el temporizador está configurado para nadar
            o sudar y cuándo vence el recordatorio, para que llegue a tus dispositivos como una
            notificación push con Solara cerrado. Los temporizadores de los invitados se quedan solo
            en su navegador.
          </li>
          <li>
            <strong>Registros de suscripción</strong>, si te suscribes: el plan, su estado y los
            identificadores de cliente y de suscripción de Stripe. Los datos de la tarjeta van a
            Stripe y nunca llegan a Solara.
          </li>
          <li>
            <strong>Un registro de la prueba gratis</strong>, si inicias la prueba gratis: hashes
            con clave, de un solo sentido, del identificador de tu cuenta de inicio de sesión en
            Google, de tu dirección de correo verificada y de la huella de tu tarjeta en Stripe,
            para que la prueba se ofrezca una vez por persona. Los hashes no se pueden convertir de
            nuevo en esos datos.
          </li>
          <li>
            <strong>Analíticas opcionales</strong>, solo si las permites: las páginas visitadas (sin
            los parámetros de la dirección), datos aproximados del dispositivo y del navegador, y el
            uso de las funciones.
          </li>
          <li>
            <strong>Informes de errores</strong>, cuando algo falla: el mensaje de error y en qué
            parte del código ocurrió, la dirección de la página sin sus parámetros, tu navegador, el
            tipo de dispositivo, el idioma y la zona horaria, y los pasos en la app justo antes del
            error. Las direcciones de correo, los identificadores de cuenta, los tokens y las
            ubicaciones se eliminan en tu navegador antes de enviar un informe, y no se guarda
            ninguna dirección IP con él.
          </li>
          <li>
            <strong>Datos técnicos.</strong> Los servicios de alojamiento y de seguridad procesan tu
            dirección IP y los datos de tu navegador para entregar las páginas y evitar abusos.
          </li>
        </ul>

        <h2>Cómo usa Solara los datos de usuario de Google</h2>
        <p>
          Solara pide permisos de Google solo para las funciones que se indican abajo, y solo cuando
          las usas.
        </p>
        <ul>
          <li>
            <strong>Inicio de sesión con Google</strong> (<code>openid</code>, <code>email</code>,{' '}
            <code>profile</code>): el identificador de tu cuenta de Google, tu nombre, tu dirección
            de correo y tu foto de perfil. Se usan para crear y proteger tu cuenta de Solara y para
            mostrar quién inició sesión. Se guardan en Firebase Authentication mientras exista tu
            cuenta.
          </li>
          <li>
            <strong>Disponibilidad de Google Calendar</strong> (<code>calendar.freebusy</code>),
            solo si conectas un calendario: las horas de inicio y de fin de tus períodos ocupados.
            Se usan en tu navegador para programar horarios con menos UV alrededor de tus
            compromisos. Nunca se guardan en los servidores de Solara y se descartan cuando cierras
            la página. Con este permiso, Solara no puede leer los títulos, las descripciones, las
            ubicaciones ni los asistentes de los eventos.
          </li>
          <li>
            <strong>Eventos de Google Calendar que creas</strong> (
            <code>calendar.events.owned</code>), solo cuando decides agregar un horario a tu
            calendario: Solara crea ese evento en un calendario tuyo y lo marca como creado por
            Solara. Solara guarda el identificador, la hora, el título y el enlace de los eventos
            que creó, para poder mostrarlos como programados y permitirte abrirlos, moverlos o
            eliminarlos. Para mantenerlos al día, Solara consulta solo los eventos que creó; no lee,
            cambia ni elimina ningún otro evento.
          </li>
          <li>
            <strong>Eventos de Google Calendar, solo lectura</strong> (
            <code>calendar.events.readonly</code>, y <code>calendar.calendarlist.readonly</code>{' '}
            solo si eliges qué calendarios usar), donde se ofrece y solo después de que activas
            &ldquo;Mostrar mis eventos de Google Calendar&rdquo;: tu navegador lee los eventos de
            los siguientes 30 días en los calendarios que elegiste (tu calendario principal, salvo
            que elijas otros) para mostrar el UV durante cada uno. Solara guarda solo los eventos
            cuya ubicación está escrita como una dirección o que coinciden con una de tus
            actividades, y solo los campos que se indican arriba en &ldquo;Eventos de tu Google
            Calendar&rdquo;; nunca cambia ni elimina ninguno. Los eventos se vuelven a leer solo
            mientras Solara está abierto. Desconectar elimina los eventos guardados y la lista de
            calendarios, y termina el acceso de Solara con Google, lo que también termina los
            permisos de disponibilidad y de eventos anteriores hasta que vuelvas a conectarte.
          </li>
          <li>
            <strong>A dónde van los datos de estos eventos.</strong> Para encontrar dónde es un
            evento, tu navegador busca en la búsqueda de lugares de Open-Meteo la parte de la ciudad
            de su ubicación (de &ldquo;Griffith Park, Los Angeles, CA 90027, USA&rdquo;, solo
            &ldquo;Los Angeles, CA&rdquo;), y solo cuando la ubicación está escrita como una
            dirección: una ciudad con su estado o provincia, su código postal o su país. Otros
            textos de ubicación, como el nombre de una persona, una sala, una oficina o el enlace de
            una reunión, nunca se buscan ni se envían a ningún lugar; el evento se muestra en tu
            propio lugar y puedes elegir su lugar a mano. Para mostrar el UV durante un evento, tu
            navegador le pide a Open-Meteo el pronóstico en el lugar del evento, como coordenadas
            redondeadas a dos decimales. Si tienes Pro con los avisos de eventos activados, los
            servidores de Solara también consultan ese pronóstico, y un aviso nombra el evento (su
            título, limpio y recortado a 40 caracteres) y su ciudad en una notificación push enviada
            mediante Firebase Cloud Messaging a los dispositivos en los que activaste las alertas.
          </li>
        </ul>
        <p>
          Solara no vende los datos de usuario de Google, no los usa para publicidad y no los usa
          para entrenar modelos de inteligencia artificial o de aprendizaje automático. Los datos de
          usuario de Google no se comparten con nadie, salvo con los proveedores de servicios que se
          indican abajo y que hacen funcionar las funciones de Solara, y solo en la medida necesaria
          para esas funciones. Ninguna persona de Solara lee tus datos de usuario de Google, salvo
          que pidas ayuda con ellos, que sea necesario por seguridad o que la ley lo exija.
        </p>
        <p>
          Puedes desconectar Solara de tu cuenta de Google cuando quieras en las{' '}
          <a href="https://myaccount.google.com/connections">conexiones de tu cuenta de Google</a>,
          lo que detiene todo acceso posterior. Eliminar tu cuenta de Solara elimina los datos de la
          cuenta de Google que guarda Solara.
        </p>
        <p>
          El uso y la transferencia que hace Solara de la información recibida de las API de Google
          cumplen con la{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Política de datos de usuario de los servicios de API de Google
          </a>
          , incluidos los requisitos de uso limitado.
        </p>

        <h2>Cómo usa Solara los datos de usuario de Microsoft</h2>
        <p>
          Donde se ofrece, Solara le pide a Microsoft un solo permiso, y solo después de que activas
          &ldquo;Mostrar mis eventos de Outlook&rdquo;:{' '}
          <strong>Leer información básica de los calendarios del usuario</strong> (
          <code>Calendars.ReadBasic</code>), que le permite leer tus calendarios y sus eventos,
          salvo sus notas, archivos adjuntos y extensiones. Inicias sesión en Microsoft en una
          ventana propia, así que Solara nunca ve tu contraseña de Microsoft. Solara no pide saber
          quién eres en Microsoft, no pide acceso sin conexión y no guarda ningún token de
          actualización: conserva el acceso durante una hora como máximo, solo en la memoria de tu
          navegador, y puede volver a leer tu calendario solo mientras está abierto y después de que
          vuelvas a iniciar sesión.
        </p>
        <ul>
          <li>
            Tu navegador lee los eventos de los siguientes 30 días en los calendarios que elegiste
            (tu calendario principal, salvo que elijas otros; no se ofrecen los calendarios que
            otras personas comparten contigo), solo con su título, su hora, su zona horaria, su
            ubicación, su identificador, si son de todo el día o reuniones en línea, si los
            rechazaste y si se cancelaron. Solara guarda solo los eventos y los campos que se
            indican arriba en &ldquo;Eventos de tu calendario de Outlook&rdquo;, y nunca cambia ni
            elimina ninguno.
          </li>
          <li>
            Los lugares se buscan como para los eventos de Google Calendar: solo se busca la parte
            de la ciudad de una ubicación escrita como dirección, y para un lugar que elegiste en la
            búsqueda de lugares de Outlook se usan sus coordenadas tal como vienen (redondeadas a
            dos decimales), con su nombre. Los enlaces de reuniones, los datos de acceso telefónico,
            y las salas de oficina y los domicilios que Outlook marca como tales nunca se buscan ni
            se envían a ningún lugar.
          </li>
          <li>
            Desconectar en la sección Eventos elimina los eventos guardados y la lista de
            calendarios, y olvida el acceso en tu navegador. Solara no puede terminar el permiso en
            Microsoft directamente; puedes quitarlo cuando quieras en{' '}
            <a href="https://account.live.com/consent/Manage">
              los permisos de aplicaciones de tu cuenta de Microsoft
            </a>{' '}
            (Outlook.com, Hotmail y Live) o en{' '}
            <a href="https://myapplications.microsoft.com/">Mis aplicaciones</a> (cuentas
            profesionales o educativas, salvo que tu organización lo haya concedido).
          </li>
        </ul>
        <p>
          Solara no vende los datos de usuario de Microsoft, no los usa para publicidad ni para
          entrenar modelos de inteligencia artificial o de aprendizaje automático, y no los comparte
          con nadie, salvo con los proveedores de servicios que se indican abajo, solo en la medida
          necesaria para mostrar el UV en tus eventos.
        </p>

        <h2>Para qué se usa y la base legal</h2>
        <ul>
          <li>
            <strong>Para ofrecer el servicio que pediste</strong> (ejecución de un contrato):
            pronósticos, recomendaciones, sincronización de tu configuración, calendarios suscritos,
            notificaciones y suscripciones.
          </li>
          <li>
            <strong>Con tu consentimiento</strong>: la ubicación del dispositivo, el acceso a Google
            Calendar y a Outlook, las notificaciones push y las analíticas opcionales. Puedes
            retirar tu consentimiento cuando quieras, lo que no afecta el tratamiento que ya se
            realizó.
          </li>
          <li>
            <strong>Intereses legítimos</strong>: mantener Solara seguro, evitar abusos y solucionar
            problemas, incluidos los informes de errores mencionados arriba, que por eso no dependen
            de la elección sobre las analíticas, y el registro de la prueba gratis, que evita
            pruebas gratis repetidas.
          </li>
          <li>
            <strong>Obligaciones legales</strong>: conservar los registros de pago para fines
            fiscales y contables.
          </li>
        </ul>
        <p>Solara no vende tu información ni la usa para publicidad.</p>
        <p>
          Las recomendaciones de Solara son estimaciones para planificar y no son consejo médico.
        </p>

        <h2>Proveedores de servicios</h2>
        <p>Estos proveedores procesan información en nombre de Solara o cuando usas una función:</p>
        <ul>
          <li>
            <strong>Google Firebase</strong> (Google LLC): inicio de sesión, base de datos,
            alojamiento, funciones en la nube, mensajes push y App Check, que usa Google reCAPTCHA
            para comprobar que las solicitudes vienen de la app real.{' '}
            {recaptchaScope(switches, 'es')}; se le aplican la{' '}
            <a href="https://policies.google.com/privacy">Política de privacidad</a> y las{' '}
            <a href="https://policies.google.com/terms">Condiciones del servicio</a> de Google.
          </li>
          <li>
            <strong>Google Calendar API y Google Identity Services</strong>: solo cuando conectas un
            calendario o activas los eventos de tu Google Calendar, para pedir tu permiso y para
            leer o crear los datos de calendario descritos arriba.
          </li>
          <li>
            <strong>Microsoft identity platform y Microsoft Graph</strong> (Microsoft Corporation):
            solo cuando activas los eventos de tu calendario de Outlook, para que inicies sesión en
            tu cuenta de Microsoft, pedir tu permiso y leer los datos de calendario descritos
            arriba.
          </li>
          <li>
            <strong>Google Analytics</strong>: solo después de que permites las analíticas. Las
            señales de Google y la personalización de anuncios están desactivadas.
          </li>
          <li>
            <strong>Open-Meteo</strong>: recibe coordenadas redondeadas para devolver pronósticos,
            para tu lugar y para el lugar de cada evento, y los nombres de lugares que escribes en
            una búsqueda de ubicación, mientras escribes, para sugerir lugares que coincidan.
            También recibe la parte de la ciudad de la ubicación de un evento (como &quot;Los
            Angeles, CA&quot;), que se busca de la misma forma para encontrar dónde es el evento:
            desde tu navegador para un archivo de calendario (.ics) que importas; desde los
            servidores de Solara para un calendario vinculado; y desde tu navegador para los eventos
            de tu Google Calendar o de Outlook, solo cuando la ubicación está escrita como una
            dirección, como se describe arriba. Cuando Solara opera su propio servicio de
            pronósticos y de búsqueda de lugares, estas solicitudes de tu navegador pasan por los
            servidores de Solara (Google Cloud) en camino a Open-Meteo, que entonces ve la dirección
            de Solara en lugar de la tuya.
          </li>
          <li>
            <strong>OpenStreetMap Nominatim</strong> (OpenStreetMap Foundation): recibe coordenadas
            redondeadas cuando usas la ubicación de tu dispositivo, o cuando importas un evento (o
            tienes un evento de Outlook en un lugar elegido en Outlook) que solo indica coordenadas,
            para encontrar el nombre de la ciudad más cercana.
          </li>
          <li>
            <strong>Stripe</strong>: procesa los pagos cuando las suscripciones están activadas.
          </li>
          <li>
            <strong>Sentry</strong> (Functional Software, Inc.): recibe los informes de errores
            descritos arriba, en los Estados Unidos.
          </li>
        </ul>
        <p>
          Algunos proveedores procesan datos en los Estados Unidos y en otros países. Cuando es
          necesario, las transferencias se basan en las cláusulas contractuales tipo de los
          proveedores o en garantías equivalentes.
        </p>

        <h2>Cuánto tiempo se guarda la información</h2>
        <ul>
          <li>Datos de la cuenta y preferencias: mientras exista tu cuenta.</li>
          <li>
            Un plan de invitado (usado sin iniciar sesión): solo en tu navegador, hasta que inicies
            sesión (entonces pasa a tu cuenta nueva, o se elimina si la cuenta ya existía) o borres
            los datos de tu navegador.
          </li>
          <li>{kept.scheduled}</li>
          <li>{kept.imported}</li>
          <li>
            Calendarios vinculados: hasta que elimines el calendario, lo que también elimina sus
            eventos, y siempre que elimines tu cuenta.
          </li>
          <li>{kept.google}</li>
          <li>{kept.outlook}</li>
          <li>
            Disponibilidad del calendario: solo en tu navegador durante la sesión actual; Solara
            nunca la guarda.
          </li>
          <li>
            Registros de notificaciones push: hasta que desactives las notificaciones o elimines tu
            cuenta.
          </li>
          <li>
            Un recordatorio de protector solar: hasta que se envíe o detengas el temporizador, y
            como máximo un día después de su hora; cuántos recordatorios se programaron y se
            enviaron ese día: 7 días.
          </li>
          <li>{kept.waitlist}</li>
          <li>
            Historial de alertas (qué alertas y avisos diarios del UV se enviaron cada día, y si
            llegaron): 7 días, y se incluye en la descarga de tus datos.
          </li>
          <li>
            El registro de la prueba gratis: 2 años después de la prueba, incluso después de que
            elimines tu cuenta, para evitar pruebas gratis repetidas.
          </li>
          <li>
            Registros de pago: el tiempo que exija la legislación fiscal y contable, incluso después
            de eliminar la cuenta. Stripe guarda sus propios registros según su política de
            privacidad.
          </li>
          <li>
            Analíticas: durante el período de conservación configurado en Google Analytics, como
            máximo 14 meses.
          </li>
          <li>Informes de errores: 30 días en Sentry.</li>
          <li>
            Registros de alojamiento y de seguridad: durante los períodos que fija Google Cloud.
          </li>
          <li>{kept.backups}</li>
        </ul>

        <h2>Almacenamiento en tu dispositivo</h2>
        <p>
          Solara guarda tus preferencias, un pronóstico en caché, tu tema, tu elección sobre las
          analíticas y qué ofertas descartaste en el almacenamiento local de tu navegador, para que
          la app funcione rápido y recuerde tus elecciones. Son necesarios para el servicio y no se
          usan para rastrearte.
        </p>
        <p>
          Si usas Solara sin iniciar sesión, tu plan (lugar, tipo de piel y actividad) se guarda
          solo en este navegador y nunca se envía a Solara. La búsqueda de lugares y los pronósticos
          siguen viniendo de Open-Meteo y OpenStreetMap, como se describe arriba.
        </p>
        <p>
          Cuando compartes un archivo o un enlace de calendario con la app instalada, se guarda en
          el almacenamiento de este navegador durante 30 minutos como máximo, para que puedas
          revisarlo e iniciar sesión primero. No se envía a ningún lugar salvo que lo importes, y se
          elimina en cuanto lo importas o lo descartas.
        </p>
        <p>
          Las cookies de Google Analytics (<code>_ga</code> y <code>_ga_*</code>) se crean solo
          después de que permites las analíticas y se eliminan cuando las rechazas.
        </p>
        <AnalyticsPreferenceControl enabled={analyticsEnabled} locale="es" />

        <h2>Tus derechos</h2>
        <p>
          Según dónde vivas, puedes pedir acceder a tu información, corregirla, exportarla o
          eliminarla, oponerte a su tratamiento o limitarlo, y retirar tu consentimiento.
        </p>
        <p>
          Con tu sesión iniciada, la página de{' '}
          <a href="/account/">controles de datos de la cuenta</a> descarga una copia de tus datos y
          elimina tu cuenta y sus datos de inmediato, después de que lo confirmes con Google.
          Eliminarla también borra lo que Solara guarda en ese navegador. También puedes escribir a{' '}
          <LegalDetail name="contactEmail" locale="es" /> para pedir cualquiera de estas cosas, por
          ejemplo si la página no puede eliminar parte de tu cuenta o no puedes iniciar sesión;
          respondemos en un plazo de 30 días.
        </p>
        <p>
          Puedes desconectar Google Calendar cuando quieras en la sección Eventos o en las{' '}
          <a href="https://myaccount.google.com/connections">conexiones de tu cuenta de Google</a>,
          renovar o revocar un calendario suscrito en Configuración, y desactivar las notificaciones
          en Configuración o en tu navegador. Puedes desconectar Outlook cuando quieras en la
          sección Eventos, y quitar el permiso de Solara en los permisos de aplicaciones de tu
          cuenta de Microsoft o en Mis aplicaciones, como se describe arriba.
        </p>
        <p>
          Eliminar tu cuenta elimina tus preferencias de Solara, las actividades programadas, los
          eventos importados, los calendarios vinculados, los eventos de tu Google Calendar y de
          Outlook y los calendarios que elegiste, el calendario suscrito y los registros de
          notificaciones, cancela una suscripción activa de Solara y elimina tu registro de cliente
          en Stripe (Stripe conserva los registros de pago que la ley le exige conservar). Si
          tuviste la prueba gratis, su registro con hash se conserva 2 años para evitar pruebas
          gratis repetidas. Los eventos que ya están en tu Google Calendar o en Outlook se quedan
          ahí hasta que los elimines.
        </p>
        <p>
          También tienes derecho a presentar una queja ante tu autoridad local de protección de
          datos.
        </p>

        <h2>Seguridad</h2>
        <p>
          Solara usa controles de acceso, conexiones cifradas, una política de seguridad de
          contenido estricta y tokens privados de acceso, pero ningún servicio de internet puede
          garantizar una seguridad absoluta.
        </p>

        <h2>Menores</h2>
        <p>
          Solara no está dirigido a menores de 13 años (o de la edad mayor que se exija donde vivas)
          y no recopila a sabiendas su información personal.
        </p>

        <h2>Cambios</h2>
        <p>
          Los cambios importantes se reflejarán actualizando la fecha de esta página y, cuando
          corresponda, con un aviso dentro del producto.
        </p>

        <h2>Idioma</h2>
        <p>
          Esta política se redactó en inglés. Esta traducción se ofrece para tu comodidad; si hay
          alguna diferencia o contradicción, prevalece la{' '}
          <a href={english} hrefLang="en" lang="en">
            versión en inglés
          </a>
          .
        </p>
      </div>
    </LegalPage>
  )
}
