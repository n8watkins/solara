# Sunscreen, burn-time fit and sun-safety guidance

Solara's sunscreen coaching (ROADMAP item 45) and its burn-time fit and fuller advice (ROADMAP item 56) follow public-health advice and make no medical claims beyond it.
The decisions live in one pure module, `packages/core/src/sun-safety.ts` (the SPF rule, the burn-time fit and the protection level), with the sunscreen guidance's words in `packages/core/src/sunscreen.ts`, so the sunscreen timer, the activity cards, the hero, the daily briefing, the morning alert and Settings never give two answers, and a native client can reuse them.
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

- **What else to wear ("slip, slop, slap, seek, slide"):** by the whole-number UV index, as the WHO categories read it.
  Under 3 (Low), nothing more is said.
  From 3 (Moderate, High), a shirt, a hat and sunglasses with the sunscreen.
  From 8 (Very high, Extreme), shade around midday as well.
  The briefing's advice line names the hat, sunglasses and sunscreen for the hours the UV is moderate or higher, and the shade for the hours it is very high or extreme; it leaves the shirt to the guidance to stay short.

## Burn-time fit

Each planned activity says whether it fits the burn time, and what makes it fit (`burnFit` in `packages/core/src/sun-safety.ts`).

- **The UV:** the highest UV the skin gets during the activity's recommended slot: each hour's planning UV (clear sky unless the activity counts on clouds, with its shade and surface), over every hour the slot touches.
  Without a slot, and for the briefing's lowest-UV window, the activity is placed where that UV is lowest inside the window.
- **The skin type:** the plan's; in a group, the most sensitive person's.
- **Fits unprotected:** the activity lasts no longer than the burn time (`burnMins` in `packages/core/src/recommendation.ts`), or the UV is under 0.5.
  From UV 3 the card still says to use sunscreen, since the guidance above advises it whatever the duration.
- **Fits with sunscreen:** it lasts no longer than the burn time at the UV divided by 2.5 (`SUNSCREEN_UV_FACTOR`: SPF 30+ as people really apply it, a quarter to half the tested amount, Neale and others, Br J Dermatol 2019;181:907).
  It names the SPF from the rule above (never less than 30), and the reapply interval when the activity lasts longer than it (every 2 h, or every 1 h 20 min for swimming, surfing and paddleboarding).
- **Too long even with sunscreen:** the card offers to split it, or names the first stretch of the day's windows where it fits with sunscreen at most.
- The verdict does not depend on whether the activity was planned with SPF: an activity planned with sunscreen at a raised UV limit can still be too long.
- The judgement uses the slot's highest UV, not the dose summed over it, which errs on the side of protection.

## Where it shows

- The sunscreen timer's "How much sunscreen?" disclosure: today's SPF advice, the whole-body amount, the teaspoon rule and when to reapply.
- The sunscreen timer's disclosure also names what else to wear at today's UV.
- Each activity card's "Sunscreen" row ("about 5 tsp for face, arms, legs"), when the activity is planned for UV 3 or more or its slot needs sunscreen to fit.
- Each activity card's fit line, in its recommended slot (or on the card when the slot is on the calendar or there is only a best window): "Fits without sunscreen: you'd burn in about 1 h 10 min.", "Longer than your burn time (about 38 min): fits with SPF 50+, reapplied every 2 h.", "Too long even with SPF 50+ (you'd burn in about 1 h 35 min): split it, or move it to 5pm-5:45pm."
- The hero's slot, with the same line, only when it needs sunscreen or is too long.
- The daily briefing and the Pro morning alert, after the lowest-UV window, only when its activity needs sunscreen or is too long; and the briefing's advice line.
- The free daily UV push: "Sunscreen, a hat, sunglasses and shade while the UV is moderate or higher."
- Settings, Sun profile: the SPF rule for the chosen skin type, what else to wear from UV 3 and 8, and the whole-body amount.

## Sources

- Cancer Council Australia, "How to apply sunscreen" and "SunSmart" guidance: the teaspoon rule (a teaspoon per limb, front, back and face, neck and ears; about 35 mL for an adult), applying 20 minutes before going outdoors, reapplying every two hours and after swimming, sweating or towelling, and SPF 50+ broad spectrum, water resistant (https://www.cancer.org.au/cancer-information/causes-and-prevention/sun-safety/about-sunscreen).
- American Academy of Dermatology, "How to apply sunscreen" and "Sunscreen FAQs": broad spectrum SPF 30 or higher, about 1 ounce, enough to fill a shot glass, for the body, reapplying every two hours and after swimming or sweating (https://www.aad.org/public/everyday-care/sun-protection/sunscreen-patients/sunscreen-faqs).
- World Health Organization, "Radiation: The ultraviolet (UV) index" and the Global Solar UV Index practical guide: protection from UV 3 (Moderate), extra protection and midday shade from 8 (Very high) (https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index).
- World Health Organization, "Global Solar UV Index: A Practical Guide" (2002), the protection messages by category: no protection needed under 3; from 3 to 7, seek shade during midday hours, slip on a shirt, slop on sunscreen and slap on a hat; from 8, avoid being outside during midday hours, seek shade, and a shirt, sunscreen and hat are a must; sunglasses protect the eyes (https://www.who.int/publications/i/item/9241590076).
- Cancer Council Australia, "Slip, Slop, Slap, Seek, Slide": protective clothing, SPF 50+ sunscreen, a broad-brimmed hat, shade and sunglasses whenever the UV index is 3 or above (https://www.cancer.org.au/cancer-information/causes-and-prevention/sun-safety/campaigns-and-events/slip-slop-slap-seek-slide).
- Neale and others, Br J Dermatol 2019;181:907 (as cited in `packages/core/src/recommendation.ts`): people apply a quarter to half the tested amount, the reason the fit counts sunscreen as 2.5 times the burn time, not the label's SPF.
- US Food and Drug Administration, "Sunscreen: How to Help Protect Your Skin from the Sun": water resistance is labelled for 40 or 80 minutes, and sunscreen should be reapplied at least every 2 hours (https://www.fda.gov/drugs/understanding-over-counter-medicines/sunscreen-how-help-protect-your-skin-sun).
- Fitzpatrick TB, "The validity and practicality of sun-reactive skin types I through VI", Arch Dermatol 1988;124:869-871: the skin types Solara uses.
