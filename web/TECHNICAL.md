# Technical summary

## 1. Starting point and what was reused

The repository had two Python + OpenCV scripts, written as desktop debugging
tools (every step opens a `cv2.imshow` window):

| Script | Approach | Measured on the 8 photos |
|---|---|---|
| `src/pump_ocr.py` | Canny → largest contour as screen → adaptive threshold → split lines at the emptiest row → Tesseract per line → decimal point found geometrically | 1/8 fully correct |
| `src/ocr_segment.py` | fixed threshold → contours filtered by absolute pixel size → 7-segment lookup table | 0/8 (size filters fit a single photo) |

Neither script could run in a browser as-is. The approach was ported to
TypeScript, keeping both scripts' ideas:

- **from `pump_ocr.py`**: crop to the screen, adaptive mean threshold
  (`ADAPTIVE_THRESH_MEAN_C`), split into lines by row projection, crop each
  line to its digit components, find the decimal point as a small blob and
  insert it by position;
- **from `ocr_segment.py`**: decode each digit by testing which of its seven
  segments are lit against `DIGITS_LOOKUP`.

Changes made so it works across photos:

- every size is relative to the line height instead of absolute pixels;
- italic digits are straightened with a shear search before digits are
  separated;
- photos taken at an angle are handled by fitting the line's top and bottom
  edges (robust Theil–Sen fit) instead of assuming they are level;
- each digit is matched to the *closest* segment pattern with a score and a
  runner-up, instead of needing an exact match;
- the display is found as the largest bright, well-filled region. If the bezel
  is also bright, an inner region is tried, and the whole frame is the last
  resort. The most convincing reading wins.

**Tesseract was dropped.** On these displays it was the weaker reader, and it
would add a multi-megabyte WASM engine and language model to the page.

**OpenCV was replaced by plain TypeScript.** The pipeline needs only a handful
of operations (threshold, connected components, projections, shear), so a full
OpenCV.js build (~8 MB) was not worth it. A practical constraint also applied:
package registries were unreachable while this was built. An OpenCV.js
provider can still be added later behind the same interface (see §4).

The Python scripts are left unchanged in `src/` for reference.

## 2. Pipeline

```
File → validate type/size → decode in worker (scaled to ≤1440 px)
     → max(R,G,B) channel, scale to 900 px
     → display candidates (bright region / inner region / whole frame)
     → adaptive threshold; remove bezel, frame lines, glare streaks, specks
       (fallback only if that reading is not confident: Sauvola threshold,
        and inverted versions of both for light-on-dark displays)
     → text lines from row projection; split over-tall bands at the
       emptiest middle row (as pump_ocr.py did)
     → per line: shear search → column runs → digit cells
                 → drop cells off the fitted top/bottom edges
                 → 7-segment decode with score + runner-up
                 → decimal point = small compact blob in a gap on the baseline
                 → "incomplete" if a digit-sized mark beside the number was set aside
     → pick the best candidate; a fallback-only reading is accepted only
       if a second method gives the same amount and volume
     → classify: arithmetic (3 numbers) > decimal places (2 = money,
       3 = volume) > layout (amount on top)
     → plausibility of implied unit price → status ok / partial / no_numbers / error
```

All of it is pure functions over typed arrays (`src/processor`), with no DOM
and no global state.

## 3. Accuracy (measured, not estimated)

`npm run accuracy` over a local, git-ignored `images/` folder (the photos are
not stored in the repository), in two groups:

| | Tuning photos (`fuel*`) | Phone photos (`PXL_*`, `-49…`) |
|---|---|---|
| photos | 8 | 44 |
| amount and volume both correct | 8 / 8 | **29 / 42** (+2 with unreadable amounts, scored on volume only: 2/2) |
| accepted without review | 8, all correct | **26, all correct** |
| flagged for review | 0 | 18 (5 of them actually correct) |
| wrong but not flagged | 0 | **0** |

The 43 phone photos were measured *before* any tuning on them: 27/41
correct, with 27 accepted, all correct. Four general changes were then made
while looking at the failures:

- split over-tall line bands;
- fallback thresholds;
- the "possibly incomplete" check;
- confirmation by a second method.

That moved the result to 28/41. The phone-photo figures are therefore no
longer a fully independent test. The first-pass figures are the more honest
estimate for new pumps.

The browser app gives the same accepted results as the Node scripts (checked
by running every photo through the app in headless Chromium). Pre-filled
values on flagged photos can differ slightly because browser image scaling is
not byte-identical. Processing takes about 0.6 s per 12 MP photo; photos that
need the fallback methods take up to about 1.2 s.

**Why the 13 misses fail** (all were flagged for review):

| Cause | Photos |
|---|---|
| Reflection washes out the leading digits of a 3-digit amount (175.00 → "5.00", 162.64 → "62.6") | 4 |
| Heavy reflection or glare over most of the panel | 4 |
| A digit misread under a reflection (174.30 → 174.36, 43.10 → 43.18) | 3 |
| Light digits on a dark display | 2 |

`npm run robustness` re-reads all 51 photos half and double size, rotated
±3°, blurred, darkened by 40% and as quality-30 JPEGs: 296/408 correct, with
**1 wrong reading not flagged**: the darkened copy of a 175.00 photo read as
115.00 (see §6, the faded "7").

The unit tests also render synthetic displays with numbers not in the photo
set (upright, italic, different backlight colours).

**Tried and rejected: black top-hat filtering.** A top-hat filter (grey close
minus image) isolates thin dark strokes regardless of local brightness, so it
looks like the right tool for reflections, and on the hardest photo
(`PXL_20261117_184636300.jpg`, 116.07 / 22.070, a hand and phone reflected over
the display) it shows the bottom line clearly. Added as a fourth fallback
threshold it did not fix that photo, because the reflection debris still fills
the gap between the two text lines, so they merge into one band; even forcing a
split did not give readable digits, since the leading digits are mostly hidden.
It also corroborated a wrong reading on a re-encoded copy of a photo that reads
correctly today (4.02 read as 4.00, accepted without a flag): wrong silent
readings in the robustness run went from 1 to 4. It was removed. A future
attempt needs line detection that is robust to debris (for example from
horizontal-bar positions) before a new threshold can help.

**The best next step for accuracy is taking photos without reflections.** A
slight angle so you are not reflected in the screen, and shade from the sky,
remove most of the failures above.

## 3a. Protection from false data

A photo that is not a pump display (trees and trucks, a document, a fence)
used to produce made-up numbers: on 69 non-pump test images, **62 produced
numbers** (pure noise gave "8"). Every one was flagged for review, but the
table was pre-filled with values that meant nothing. Two causes:

- a digit was "lit" wherever there was any ink along a segment, so a cell full
  of texture lit every segment and scored a perfect "8";
- any thin vertical mark was accepted as the digit "1", so tree trunks and
  fence bars became numbers.

What was added (`NumberDetector.isPlausibleLine`, `ImageProcessor.looksLikePumpDisplay`):

1. **Clutter measure per digit.** In every 7-segment digit the channel between
   the bars is empty, so ink there means the cell is not a clean digit. For a
   "1", the bar must be solid. A line with too many cluttered digits is dropped.
2. **A number has at least 3 digits**, and **a row of identical bars is not a
   number** (fence, trunks).
3. **A pump display shows at least two numbers, one with a decimal point.**
   Otherwise nothing is pre-filled: the row says no pump display was
   recognised and asks for a closer, reflection-free retake or manual entry.

Measured with `npm run negatives -- <dir>` on 69 non-pump images (scikit-image
sample photos and documents, hazard pictograms, 24 synthetic forests with
tilted trunks and truck-like boxes, noise, stripes):

| | Before | After |
|---|---|---|
| non-pump images that produced numbers | 62 / 69 | **0 / 69** |
| tuning photos fully correct | 8 / 8 | 8 / 8 |
| phone photos fully correct | 28 / 42 | **29 / 42** |
| accepted without review, all correct | 26 | 26 |
| wrong readings accepted without a flag | 0 | 0 |
| robustness run, wrong without a flag | 1 | 1 (same known case) |

The thresholds were chosen with a sweep over real and non-pump images: rule 3
alone removes almost everything, and rule 1 stays as a second layer at the
strictest setting that costs no correct value on the real photos. Every correct
real reading has two lines and a decimal point; the one-line readings were all
wrong. The tests in `test/falseData.test.ts` use generated scenes, so they need
no photo files.

Limits: this recognises *7-segment pump-like layouts*, not "fuel pumps". Another
7-segment display with two numbers and a decimal point (a scale, a thermostat,
a cash register) would be read. A photo of a pump with a single visible number
is reported as not recognised rather than guessed. The 69 negatives are
proxies: a real forest photo with truck registration plates or signage has not
been measured here, so false readings on such photos remain possible but should
be rare, and are always flagged for review.

## 3b. Odometer reader and automatic separation

A folder can mix pump photos and dashboard photos. Each photo is sorted by what
it turns out to be:

```
photo → pump reader (strict) ── pump-like? ──► fuel_pump result
                │ no
                └─► odometer reader (decoded at up to 2600 px) ── found? ──► odometer result
                          │ no
                          └─► "unrecognized" (nothing filled in, kept apart)
```

The pump reader goes first because it is the stricter test (§3a): two lines of
7-segment digits with a decimal point. Dashboards, trees and fences do not pass
it. The odometer reader only runs on what the pump reader rejects.

**Odometer reader** (`src/processor/odometer/`). Dashboards use ordinary and
dot-matrix fonts, not 7-segment digits, so this is a separate reader. It has no
OCR engine and no download:

1. Threshold locally in both polarities (light on dark TFT, dark on light),
   at full and at half size (dust and speckle that break glyphs apart at full
   size average out at half size).
2. Connected components → glyphs. A wide blob (letters that touch) is split at
   its thinnest column.
3. Each glyph is classified by a tiny network (one hidden layer, 64 units,
   about 110 KB of weights) into 0-9, `D`, `m`, `k` or other. It is trained
   offline by `tools/train_glyphs.py` **on synthetic renders only**: system
   fonts, condensed and very bold variants, shear, blur, noise, and a 5x7
   dot-matrix font. No photo is used for training. Accuracy on fonts the model
   never saw: about 90%.
4. Glyphs are grouped into lines (similar height, aligned, small gaps), and
   then the rules that make a number an odometer apply:
   - an **"ODO" label** to the left, or a **mi/km unit** to the right;
   - **3-4 digits** are accepted only with the ODO label. "Range 343 miles"
     and "Distance to Empty 252 miles" have the same shape but are not mileage;
   - a **decimal point** (trip, mpg) or a **colon** (clock) next to the digits
     rejects the number; so do alternating digits ("80808"), which is what
     the fragments of a 7-segment display look like;
   - digits taller than 6% of the photo are accepted only with the ODO label
     (otherwise it is a pump display);
   - a bare 5-6 digit number with neither label nor unit is returned for
     review, never as a confident reading.
5. A glyph slightly taller than its neighbours (a bezel edge stuck to it) is
   read again with the extra height trimmed; a digit whose reading is
   uncertain is listed as ambiguous and the row is marked Review.

**Measured on 10 dashboard photos** (Toyota TFT in several lighting
conditions, Ford LCD, Ram, Honda, Tundra without an odometer, Toyota hybrid
trip screen):

| | |
|---|---|
| Correct value | 9 of 10 |
| Not an odometer, correctly rejected (Tundra shows range only) | 1 of 1 |
| Confident but wrong | 0 |
| Flagged for review | 5 (4 correct, 1 wrong: Ford `010771` read as `010711`) |
| Non-dashboard photos giving an odometer (69 trees, fences, noise, blanks) | 0 |
| Pump photos giving an odometer (52) | 0 |
| Time per photo | 0.15-1.1 s |

Honest reading of that table: **these 10 photos were used while building the
reader**, so 9/10 is not an independent test. Several choices (the relaxed "O"
shape in the label, trimming of tall glyphs, the dot-matrix training data) were
made by looking at specific failures here. Accuracy on a different car's
dashboard will be lower; the review flag is the safety net, not the accuracy.
The photos and the expected mileages are not in the repository; with them in
`images/odometer/` (plus `expected.json`) `npm test` runs a local regression
check, and `npm run odometer -- ../images/odometer` prints a per-photo table.

**Known odometer limits**

- Needs the digits at least about 10 px tall in the decoded image. A small
  odometer in a wide photo can fall below that.
- Heavy dust or glare across the digits (one test photo) still reads, but is
  the first thing to fail.
- A very bold LCD font can make a "7" read as "1" when something touches it.
- A dashboard that shows only a trip or range value, with no odometer, has
  nothing to read and is correctly reported as not recognised.
- Every reading is mileage as displayed. Nothing here knows the vehicle.

## 3c. Fuel economy: pairing fill-ups with odometer readings

`src/services/TripService.ts` (pure, no UI, no image code) turns pump and
odometer records into trips.

1. **Pairing.** Each pump photo (volume and amount present) is matched to the
   odometer photo taken closest to it in time, within 6 hours; each photo is
   used once (smallest gaps first). Time is the EXIF capture time with its UTC
   offset (§5a). A photo whose only date is the file's modified date is **not**
   paired: that date says when the file was saved, not when the picture was
   taken. Such photos are listed as unpaired.
2. **Trips.** Fill-ups are sorted by time; each consecutive pair gives
   distance (odometer difference), efficiency (distance / volume bought at the
   later fill-up, the full-to-full method) and cost per distance (amount /
   distance).
3. **Cross-checks.** A trip is marked "check" and **left out of every average**
   when: the odometer did not increase; the distance is over 1200; efficiency is
   outside 5-80 per fuel unit; cost per distance is over 3; or the two odometer
   photos show different units. A missed fill-up, a partial fill or a misread
   digit all show up as one of these instead of silently skewing the result.
4. Only records with status Confirmed or Detected are used (never Review or
   Failed). A trip that includes an unconfirmed record is labelled Unconfirmed.

Stated assumptions: efficiency assumes each fill-up filled the tank to the same
level; it is mpg only if the pump shows gallons (otherwise distance per litre).
Thresholds are in `TRIP_CONFIG`. Trips can be exported as a separate CSV.
Tested with synthetic records (`test/trips.test.ts`); checked in the browser
with EXIF-timed photos.

## 4. Ready for backend offloading

- `ImageProcessingService` (`src/services/ImageProcessingService.ts`) is the
  only thing the UI calls. The rule that results never reject (per-image
  failures come back as data) keeps batch handling identical for any provider.
- `ProcessingResult` is versioned (`schemaVersion`), plain JSON, records which
  `processor` produced it, and reports boxes in original-image pixels. A server
  can return exactly the same structure.
- The detector (`processRgba`) is pure TypeScript with no browser APIs, so the
  same code runs under Node on a server unchanged (the tests already run it
  under Node).
- **Fit with `realsystem/processor`:** that project's control plane accepts
  jobs (`POST /api/v1/jobs` with `job_type` + `input_metadata`), and its
  data-plane worker runs them through an executor registry. A
  `RemoteProcessingService` would submit a `fuel_ocr` job, poll
  `GET /api/v1/jobs/:id`, and map the output to `ProcessingResult`. A
  `fuel_ocr` executor in the worker would run this pipeline (or a stronger
  model). Things to resolve first: image transfer (job inputs are JSON
  metadata, so images would need base64 encoding or separate storage),
  authentication from a public page, and the privacy promise. Remote
  processing must be opt-in, with clear wording.

Not built yet, by design: backend, storage, accounts, persistence.

## 5. Extensibility notes

- `ProcessingResult.subject` (`'fuel_pump'`) and the open-ended `FieldKind`
  allow odometer photos to reuse the same result shape, e.g. a `subject:
  'odometer'` result with an `odometer` field.
- `StatisticsService` depends only on `FuelRecord`, not on processing, so
  consumption (MPG, L/100 km) can be added there once odometer readings exist.
- Processing parameters are in `src/processor/config.ts` and app limits are in
  `src/app/appConfig.ts`.

## 5a. Photo metadata (EXIF)

Surveyed on the 52 sample photos: 42 phone photos carry full EXIF; 10 carry
none (the 8 web images, one chat-app copy, and a photo whose metadata was
stripped when it was sent). Each full block holds camera and lens, exposure
(shutter, ISO, aperture, flash), focus distance, orientation, capture time
with UTC offset, and **GPS location**.

What the app uses, and why:

- **Capture time only** (`src/utils/exif.ts`). It becomes the record's date
  (`captured_at`, with `captured_source` = `exif` or `file` in the CSV). EXIF
  time is local with the camera's UTC offset; Pixel file names are UTC, so
  parsing the name would put an evening fill-up on the next day
  (`PXL_20251206_033907` was taken at 19:39 on 5 December, UTC-8). Photos
  without EXIF fall back to the file's modified date, shown as "(file date)"
  because it may be the day the file was copied.
- **Never read:** the GPS section and every other tag. The reader walks only
  to the timestamp and offset. Nothing about location or device is stored or
  exported, and the CSV contains no metadata beyond the date.
- Verified against Pillow on all 52 files: 42 read, 10 none, 0 mismatches.

Not built, but possible: warn when the flash fired (glare risk), use focus
distance to reject far-away shots, or offer station location as an explicit
opt-in. Each adds metadata handling that has not been needed yet.

## 6. Known limitations

**Display types**

- The **pump reader** reads only **7-segment** digits. Dot-matrix, LED-matrix,
  and proportional-font LCD pump displays will fail. They are mostly flagged
  as review or "no numbers". (Dashboards are handled by the odometer reader,
  §3b.)
- Another device with a two-number 7-segment display (a scale, a meter) would be
  read as a pump.
- **Light-on-dark** displays (white digits on a blue or black LCD) are tried
  with inverted thresholds, but are not read reliably yet: 0 of the 2 in the
  photo set. Both were flagged.
- **Reflections** (the photographer, sky or trees mirrored in the screen) are
  the main cause of failure on real photos. When a reflection removes a
  digit's segments entirely, the digit cannot be recovered. The app flags the
  reading as possibly incomplete when something digit-sized was set aside
  next to the number.
- A **"7" whose top bar has faded** (low light, reflection) is
  indistinguishable from a "1" in the binary mask. This was seen once in the
  robustness test (175.00 → 115.00, not flagged). Checking the greyscale
  pixels where the bar should be would catch it; not done yet.
- Faint "ghost" segments (unlit segments that are still slightly visible) can
  make a digit look like another (4/9, 7/9, 0/8). These cases are flagged.
- Fonts whose vertical segments are much shorter than the horizontal bars may
  lose a leading or trailing 1, 4 or 7 to the alignment filter that removes
  stray marks.

**Layouts**

- Field classification assumes US-style conventions: money to 2 decimals,
  volume to 3, and, when that is not enough, amount above volume. Pumps that
  show litres to 2 decimals, or that show the unit price, may be misclassified.
  The confidence will be lower and the status Review. Three-number displays
  classify reliably when amount ≈ volume × price holds.
- Displays with more than 3 numeric lines read only the 3 most prominent.
- The plausible unit-price range (0.5–15 per unit) is only used to lower
  confidence. Non-US currencies may need it changed in `config.ts`.

**Image quality**

- Severe perspective, heavy glare across digits, strong reflections, motion
  blur and very small digits (under about 20 px tall) reduce accuracy.
- A decimal point touching a digit is not detected separately. It is then
  placed by convention and flagged.
- Rotations beyond a few degrees are not corrected.

**App**

- No persistence: reloading the page clears everything (by design for v1).
- Processing timeout and cancellation stop the worker. In the main-thread
  fallback (browsers without worker canvas support) an image cannot be
  interrupted mid-way.
- No donation provider yet; the button is a placeholder (`APP_CONFIG.supportUrl`).
