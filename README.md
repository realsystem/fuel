# fuel

Reading fuel pump displays from photos.

**Live app: https://realsystem.github.io/fuel/**. It runs entirely in your browser; photos are never uploaded.

- `web/`: **Fuel Photo Log**, a browser app that reads pump photos locally and
  exports a CSV. Start here: [web/README.md](web/README.md), plus
  [web/TECHNICAL.md](web/TECHNICAL.md) for how detection works and its limits.
- `images/`: git-ignored, local only. Put sample pump photos here to run the
  accuracy checks; photos are not kept in the repository because they can carry
  location data.
- `src/`: the original Python + OpenCV experiments (`pump_ocr.py`,
  `ocr_segment.py`). Kept for reference; the web app's detector is a TypeScript
  port of their approach.
