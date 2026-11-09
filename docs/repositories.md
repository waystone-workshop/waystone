# Workshop repositories

- [waystone](https://github.com/waystone-workshop/waystone): Electron client,
  Phoenix API, LiveKit setup, installers and update feeds.
- [waystone-website](https://github.com/waystone-workshop/waystone-website): static
  landing page and joining/download information. Built and deployed separately.
- [design-system](https://github.com/waystone-workshop/design-system): shared
  tokens, CSS primitives, sparkle mark, curated Heroicons and a visual gallery.

The desktop client and website both pin design-system v0.1.0 through a GitHub
release-tag tarball, with integrity hashes in their npm lockfiles. Builds copy
the assets into their own output; they need no live CDN, npm publishing account,
or adjacent clone. Never change an existing library tag. Make a new version and
update each consuming project's dependency and lockfile deliberately.

The design system owns palette, typography, spacing, radii, focus/motion and
reusable controls. Products own their content, layouts, behavior and any
specialized interfaces. Extend the existing Heroicons outline family; preserve
the MIT attribution shipped with the assets.

Local checkouts created during the split are under `repositories/` (ignored by
this app repo), each with its own Git remote. They are not Git submodules. You
can clone them anywhere else without changing a build.

## Local commands

- App backend: `cd backend` then `mix phx.server` (API on port 4000).
- Desktop: `cd frontend` then `npm ci` and `npm start`.
- Website clone: `npm ci` and `npm start` (port 4173).
- Design-system clone: `npm test` and `npm start` (gallery on port 4174).

The backend no longer serves the landing page or installer files. Configure the
website's `WINDOWS_DOWNLOAD_URL` at build time once the first installer is
published in the app repository. Registration stays an explicit placeholder.
