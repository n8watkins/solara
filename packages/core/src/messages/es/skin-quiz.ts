import type { Translation } from '../../i18n'
import type skinQuiz from '../skin-quiz'

export default {
  unexposed: '¿De qué color es tu piel donde casi nunca le da el sol?',
  unexposedAnswers: 'Rojiza|Muy pálida|Pálida con un tono beige|Marrón claro|Marrón oscuro',
  freckles: '¿Tienes pecas en la piel que recibe sol?',
  frecklesAnswers: 'Muchas|Varias|Algunas|Casi ninguna|Ninguna',
  burn: '¿Qué te pasa cuando te quedas demasiado tiempo al sol?',
  burnAnswers:
    'Enrojecimiento doloroso, ampollas y descamación|Ampollas y luego descamación|A veces me quemo y luego me pelo|Rara vez me quemo|Nunca me quemo',
  tan: '¿Cuánto te bronceas?',
  tanAnswers:
    'Casi nada o nada|Un bronceado ligero|Un bronceado moderado|Me bronceo con mucha facilidad|Mi piel se oscurece muy rápido',
  face: '¿Cómo reacciona tu cara al sol?',
  faceAnswers: 'Muy sensible|Sensible|Normal|Muy resistente|Nunca he tenido problemas',
} satisfies Translation<typeof skinQuiz>

export const needsReview: (keyof typeof skinQuiz)[] = [
  'unexposed',
  'unexposedAnswers',
  'freckles',
  'frecklesAnswers',
  'burn',
  'burnAnswers',
  'tan',
  'tanAnswers',
  'face',
  'faceAnswers',
]
