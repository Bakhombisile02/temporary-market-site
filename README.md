## Radley Marketing Site

### Repository Layout
- `site/` – primary Jekyll source (layouts, includes, Sass, page collections).
- `functions/` – Firebase Cloud Functions used for API endpoints (`/api/pipedrive/*`, eligibility forms).
- `build.sh` – reproducible build helper that installs Ruby/Node deps and runs the production Jekyll build.
- `firebase.json` – Firebase Hosting & Functions configuration (deploy destinations, headers, rewrites).
- `_site/` – generated output; removed from source control and rebuilt on demand via `npm run build`.
- `site/assets/favicon/` – favicon bundle (ICO, PNG, SVG, manifest) referenced in the HTML head.

### Development Workflow
1. Install Node packages: `npm install`
2. Install Ruby gems (from repo root): `BUNDLE_GEMFILE=site/Gemfile bundle install`
3. Start local server with live reload: `npm start`

### Building & Deploying
1. Production build (outputs to `_site/`): `npm run build`
2. Deploy to Firebase Hosting: `firebase deploy --only hosting`

> **Tip:** never run the build or deploy scripts with `sudo`. If earlier runs produced root-owned artifacts, fix them with  
> `sudo chown -R "$USER":"$(id -gn)" _site site/.jekyll-cache site/vendor` before rebuilding.
