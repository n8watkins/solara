import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'
import styles from '@/components/LegalPolicy.module.css'
import LegalDetail from '@/components/LegalDetail'
import { TRANSLATED_FROM, legalDate } from '@/lib/legal'
import { localePath, pageMetadata } from '@/lib/page-language'

// The terms in Spanish (ROADMAP item 46): a full translation of app/terms/page.tsx, of the
// English version dated TRANSLATED_FROM.es.terms (lib/legal.ts); the English version
// prevails. A native speaker and counsel review it (docs/i18n/es-review.md).

const TRANSLATES = TRANSLATED_FROM.es!.terms

export const metadata: Metadata = pageMetadata({
  title: 'Términos de uso | Solara',
  description: 'Términos, límites de seguridad, suscripciones y uso aceptable de Solara.',
  path: '/terms/',
  locale: 'es',
})

export default function TermsPage() {
  return (
    <LegalPage
      title="Términos de uso"
      updated={legalDate(TRANSLATES, 'es')}
      path="/terms/"
      locale="es"
      notice={
        <>
          Esta es una traducción de la{' '}
          <a href={localePath('/terms/', 'en')} hrefLang="en" lang="en">
            versión en inglés
          </a>{' '}
          del {legalDate(TRANSLATES, 'es')}. Si hay alguna diferencia entre ambas, prevalece la
          versión en inglés.
        </>
      }
    >
      <div className={styles.policy}>
        <h2>Quién ofrece Solara</h2>
        <p>
          Solara es ofrecido por <LegalDetail name="operatorName" locale="es" />. Las preguntas
          sobre estos términos se envían a <LegalDetail name="contactEmail" locale="es" />.
        </p>

        <h2>Uso de Solara</h2>
        <p>Puedes usar Solara solo de acuerdo con la ley aplicable y con estos términos.</p>
        <p>
          Eres responsable de mantener seguros tu cuenta y los enlaces de tu calendario suscrito, y
          de la actividad que se realice con tu cuenta.
        </p>

        <h2>No es consejo médico</h2>
        <p>
          Los horarios para planificar, los tiempos hasta quemarte, la orientación sobre el
          protector solar, las cifras de vitamina D y las demás estimaciones de Solara sirven para
          planificar y llevar un registro. No son consejo médico, ni un diagnóstico ni un
          tratamiento, y no reemplazan a un profesional de la salud.
        </p>
        <p>
          Si tienes un problema de salud, tomas un medicamento que te hace más sensible al sol,
          estás embarazada o te preocupa tu piel o tu vitamina D, consulta a un profesional de la
          salud antes de confiar en las estimaciones de Solara.
        </p>
        <p>
          Solara no garantiza que seguir sus estimaciones evite quemaduras solares, daños en la
          piel, enfermedades por calor u otros daños, ni que algún momento al aire libre sea seguro.
        </p>

        <h2>Pronósticos y estimaciones</h2>
        <p>
          Solara ofrece horarios estimados para planificar, basados en datos del pronóstico y en las
          preferencias que ingresas.
        </p>
        <p>
          Los pronósticos, la exposición a la radiación ultravioleta, la eficacia del protector
          solar, la respuesta de la piel, la nubosidad, los medicamentos, la altitud, la reflexión y
          las condiciones locales pueden ser distintos de estas estimaciones.
        </p>
        <p>
          Ten en cuenta las condiciones locales del momento, sigue las recomendaciones de salud
          pública y usa una protección solar adecuada.
        </p>

        <h2>Suscripciones</h2>
        <p>
          Las funciones de pago, los precios, los períodos de facturación y las condiciones de
          renovación y cancelación se muestran antes del pago.
        </p>
        <p>Stripe procesa los pagos y sus términos también se aplican al pago.</p>
        <p>
          Puedes cancelar con los controles de suscripción o de cuenta disponibles, y el acceso
          puede continuar o terminar según las condiciones que se muestran al comprar.
        </p>

        <h2>Uso aceptable</h2>
        <p>
          No puedes hacer un mal uso de Solara, intentar un acceso no autorizado, interferir con el
          servicio, abusar de la infraestructura compartida, extraer datos en un volumen irrazonable
          ni usar el servicio para violar los derechos de otra persona.
        </p>

        <h2>Fuentes de datos y licencias</h2>
        <p>
          Los pronósticos y la búsqueda de lugares usan datos de{' '}
          <a href="https://open-meteo.com/">Open-Meteo</a>, cuya búsqueda de lugares se basa en{' '}
          <a href="https://www.geonames.org/">GeoNames</a>, ambos con licencia{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC&nbsp;BY&nbsp;4.0</a>.
        </p>
        <p>
          Los nombres de lugares para la ubicación de tu dispositivo provienen de los{' '}
          <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>,
          disponibles bajo la Open Database License.
        </p>
        <p>
          El software y el contenido propios de Solara tienen la siguiente licencia:{' '}
          <LegalDetail name="codeLicense" locale="es" />.
        </p>

        <h2>Disponibilidad y cambios</h2>
        <p>
          Solara puede cambiar, suspender o dejar de ofrecer funciones y puede actualizar estos
          términos a medida que el servicio evoluciona.
        </p>
        <p>Solara se ofrece sin garantías, en la máxima medida en que lo permita la ley.</p>

        <h2>Limitación de responsabilidad</h2>
        <p>
          En la máxima medida en que lo permita la ley, Solara y su operador no son responsables de
          daños indirectos, incidentales, especiales, consecuentes o punitivos, ni de las decisiones
          tomadas a partir de pronósticos o estimaciones para planificar.
        </p>
        <p>
          Algunas jurisdicciones no permiten ciertas exclusiones de garantías ni limitaciones de
          responsabilidad, por lo que es posible que esas disposiciones no se apliquen a ti.
        </p>

        <h2>Ley aplicable</h2>
        <p>
          Estos términos se rigen por las leyes de <LegalDetail name="jurisdiction" locale="es" />,
          sin tener en cuenta sus normas sobre conflictos de leyes, salvo cuando la ley del lugar
          donde vives te otorgue derechos a los que no se puede renunciar.
        </p>

        <h2>Cierre de la cuenta</h2>
        <p>
          Puedes eliminar tu cuenta desde la página de{' '}
          <a href="/account/">controles de datos de la cuenta</a>.
        </p>
        <p>
          El acceso puede suspenderse o cancelarse por un mal uso grave, requisitos legales, riesgos
          de seguridad o el incumplimiento de estos términos.
        </p>

        <h2>Idioma</h2>
        <p>
          Estos términos se redactaron en inglés. Esta traducción se ofrece para tu comodidad; si
          hay alguna diferencia o contradicción, prevalece la{' '}
          <a href={localePath('/terms/', 'en')} hrefLang="en" lang="en">
            versión en inglés
          </a>
          .
        </p>
      </div>
    </LegalPage>
  )
}
