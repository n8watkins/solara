# Sunscreen amount and SPF guidance

Solara's sunscreen coaching (ROADMAP item 45) follows public-health advice and makes no medical claims beyond it.
The rules live in one pure module, `packages/core/src/sunscreen.ts`, so the sunscreen timer, the activity cards and Settings never give two answers, and a native client can reuse them.
Nothing new is stored: the amount follows an activity's preset, and the SPF follows the day's UV and the skin type Solara already keeps.

## What Solara says

- **Amount:** about 1 teaspoon (5 mL) for each part of the body: the face with the neck and ears, each arm, each leg, the front of the body and the back of the body.
  A whole adult body takes about 7 teaspoons (35 mL), roughly a shot glass.
- **Which parts:** swimming, surfing and paddleboarding count the whole body (7 teaspoons); baseball, morning coffee, lunch outside and reading outside count the face and arms (3 teaspoons); every other preset and every custom activity counts the face, arms and legs (5 teaspoons), the T-shirt-and-shorts exposure the vitamin D estimate also assumes.
- **SPF:** under UV 3, most people need no sunscreen; from UV 3, broad spectrum SPF 30 or higher; SPF 50+ when the UV reaches 8 (Very high) or for fair skin that burns easily (Fitzpatrick types I and II).
  The UV index is read as a whole number (2.5 counts as 3), and the day's peak is judged on the clear sky, as all protection advice is (`packages/core/src/protection.ts`).
  For a family plan, the most sensitive skin type decides.
- **When:** put it on 20 min before going out, reapply every 2 h, and straight after swimming, sweating or towelling off.
  The reapply timer keeps the times (every 2 h, or every 80 min while swimming or sweating, the FDA's longest water-resistance claim).

## Where it shows

- The sunscreen timer's "How much sunscreen?" disclosure: today's SPF advice, the whole-body amount, the teaspoon rule and when to reapply.
- Each activity card's "Sunscreen" row ("about 5 tsp for face, arms, legs"), when the activity is planned for UV 3 or more.
- Settings, Sun profile: the SPF rule for the chosen skin type and the whole-body amount.

## Sources

- Cancer Council Australia, "How to apply sunscreen" and "SunSmart" guidance: the teaspoon rule (a teaspoon per limb, front, back and face, neck and ears; about 35 mL for an adult), applying 20 minutes before going outdoors, reapplying every two hours and after swimming, sweating or towelling, and SPF 50+ broad spectrum, water resistant (https://www.cancer.org.au/cancer-information/causes-and-prevention/sun-safety/about-sunscreen).
- American Academy of Dermatology, "How to apply sunscreen" and "Sunscreen FAQs": broad spectrum SPF 30 or higher, about 1 ounce, enough to fill a shot glass, for the body, reapplying every two hours and after swimming or sweating (https://www.aad.org/public/everyday-care/sun-protection/sunscreen-patients/sunscreen-faqs).
- World Health Organization, "Radiation: The ultraviolet (UV) index" and the Global Solar UV Index practical guide: protection from UV 3 (Moderate), extra protection and midday shade from 8 (Very high) (https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index).
- US Food and Drug Administration, "Sunscreen: How to Help Protect Your Skin from the Sun": water resistance is labelled for 40 or 80 minutes, and sunscreen should be reapplied at least every 2 hours (https://www.fda.gov/drugs/understanding-over-counter-medicines/sunscreen-how-help-protect-your-skin-sun).
- Fitzpatrick TB, "The validity and practicality of sun-reactive skin types I through VI", Arch Dermatol 1988;124:869-871: the skin types Solara uses.
