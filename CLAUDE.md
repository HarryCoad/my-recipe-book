# My Recipe Book API

Express + TypeScript + Mongoose (MongoDB Atlas) backend for a recipe book app. The UI is a separate project. **`docs/API.md` is the API reference: keep it up to date whenever endpoints, request bodies, responses or error codes change.**

## Commands

- `npm run dev`: runs `server.ts` with nodemon on port 8000 (from `config.env`)
- `npm test`: Vitest suite against an in-memory MongoDB (`npm run test:watch` to rerun on save)
- `npx tsc --noEmit -p tsconfig.json`: type-check, including tests
- `npm run build`: compiles to `dist/` using `tsconfig.build.json`, which leaves the tests out
- ESLint is set up but doesn't parse TypeScript yet, so it can't be used for linting. Prettier uses single quotes.

## Structure

- `routes/` → `controllers/` → `models/`. Recipe routes are in `routes/recipeRoutes.ts`, and every route except signup, login and password reset requires auth through `authController.protect`.
- `utils/recipeUtils.ts` holds request payload builders, Zod schemas, and shared recipe logic (`applyEditToRecipe`, `releaseRecipeFromAuthor`, `removeRecipe`).
- `translations/errorCodes.ts`: the error codes the API returns.
- `utils/recipeImport/`: recipe import from a URL or an image. `fetchPage` (SSRF-safe fetch), `parsePage` (JSON-LD or main text), `extract` (Claude call), `normalise` (maps units and categories). Handlers are in `controllers/importController.ts`.
- `dev-data/` and `config.env` are gitignored.
- `scripts/`: one-off maintenance scripts that run against the real database. They're dry runs unless passed `--apply`.

## Conventions

- Wrap handlers in `catchAsync`. Return errors with `next(new AppError(ErrorCode.X, status))`, using an `ErrorCode` rather than an English message, so the UI can translate it.
- Responses are `{ status: Status.Success, data: ... }`. `transformIdMiddleware` renames every `_id` in a response to `id`.
- Boolean fields and query params start with `b` (`bPrivate`, `bOnlySaved`). Query params are strings, so compare them with `=== 'true'`.
- Mutating routes are mostly `POST` with the ID in the body, matching the existing style.
- Imports use the `@models/`, `@controllers/`, `@utils/` and `@routes/` aliases, or `baseUrl` paths such as `translations/errorCodes`.
- Some existing names are misspelled (`viweRecipe`, `userContrroller.ts`). Leave them unless asked to rename them.

## Domain rules

These were decided deliberately. Keep them consistent:

- **Personal edits vs suggestions:** both are `Edit` documents. A personal edit (`isSuggestion: false`, one per user per recipe) overlays ingredients, steps and tags for that user only. Suggestions go to the author, who accepts or rejects each one; accepting applies it to the recipe.
- **Tags** are user-created free text, normalised by `normaliseTags` in `utils/tagUtils.ts` (trim, lowercase, collapse spaces, dedupe). This happens in the payload builders before validation (limits in `recipeConstants.ts`), and again in a Mongoose setter on `Recipe.tags` and `Edit.tags` that catches any other write. `GET /recipes/tags` powers autocomplete, so users reuse existing tags.
- `Edit.tags` defaults to `undefined`, not `[]`, so "tags not edited" is different from "all tags removed". Empty `ingredients` or `steps` mean "not edited".
- **Saves live only on `Recipe.savedBy`**, as `{ userId, savedAt }` entries (indexed on `savedBy.userId`). Users don't keep their own list, so there's only one side to update. Authors are added as savers when they create a recipe and can't unsave it (`AUTHOR_CANT_UNSAVE`). They delete it instead, so a user's saved list is their whole recipe book. Query with `'savedBy.userId': userId`.
- Users must save a recipe before editing or suggesting. Unsaving deletes their personal edit, and requires `bConfirmLoseEdits: true` if one exists.
- **Recipes without an author:** deleting a recipe, or an account, goes through `releaseRecipeFromAuthor`. With other savers, the recipe stays with `authorId: null`, is frozen, has suggestions turned off and is hidden from general search. It's removed once nobody has it saved. Account deletion also unsaves the user everywhere and deletes their edits.
- **Responses never include `savedBy`** (it would expose other users' IDs). Every recipe response goes through `formatRecipesForUser` in `recipeController.ts`, which adds `authorName`, `bSaved` and `savedCount`, and groups ingredients by subheader. Edit responses go through `formatEdits`, which adds `userName` and also groups ingredients. Grouping only happens in responses: stored order is unchanged.
- Recipe visibility: the author, or `bPrivate: false`. Recipes without an author are also visible to their savers.
- **Ingredients:** `quantity` and `unit` are nullable ("salt, to taste"). A quantity without a unit is a count.
- **Imports** (`/recipes/import-url`, `/recipes/import-image`) return `{ draft, issues, recipe }`. Normally `recipe` is `null` and the user checks the draft, then submits it to `/recipes/create`.
  - With `bSkipReview` (`true`, or `'true'` from multipart), a draft with no issues is created through `createRecipeForUser`, the same path as `/recipes/create`. A draft with issues is never created.
  - Image imports take up to `MAX_IMAGES` (4) files in the `image` field, read as one recipe.
  - **Duplicate check before calling Claude:** it looks only in the user's own book (`savedBy.userId`). URLs match on `sourceUrl`, stored through `normaliseSourceUrl` (no anchor or tracking params). Images match on `sourceImageHash`, the SHA-256 of the files in order.
  - A match returns `draft: null` and `duplicateOf`, unless `bAllowDuplicate`.
  - `sourceImageHash` is accepted on create, so it survives review. `formatRecipesForUser` strips it from responses.
  - Drafts are `bPrivate: true`, and URL imports set `sourceUrl`.
  - Missing values come back as `0` or `null` and are listed in `issues`, rather than guessed.
- **Claude for imports:** `IMPORT_MODEL` in `utils/recipeImport/extract.ts` is `claude-haiku-5-5` at low effort, to keep imports cheap (about $0.001 each). Don't switch to a pricier model without asking. Needs `ANTHROPIC_API_KEY` in `config.env`.
  - The Claude-facing schema uses plain strings for `category` and `unit`. The SDK doesn't enforce enums, and its parse throws on any value outside one, which would fail the whole import over one odd unit. `normalise.ts` maps close values and validation flags the rest.
- **Fetching user URLs:** `fetchPage` only reaches public http(s) addresses on default ports.
  - It resolves with `dns.resolve*` (not `lookup`, which is broken here), checks every address, re-checks each redirect, and connects to the checked IP.
  - Keep these checks if you change it. Its `isBlocked` and `allowAnyPort` options exist only for tests.
- **Profiles:** `GET /users/:id` returns only public fields (never email). A profile's recipes come from `search?savedBy=<id>`, which is filtered by the *viewer's* visibility and refused with `SAVES_PRIVATE` when the owner has `bPrivateSaves: true` (default `false`).

## Gotchas

- Recipes are soft deleted (`bDeleted`). A query hook in `recipeModel.ts` filters them out of `find*` and `countDocuments`, using `this.where()`. Don't use `setQuery({...$or})`, which overwrites the caller's `$or`. **Aggregates skip this hook**, so add `bDeleted: { $ne: true }` to them yourself.
- `Recipe.aggregate` doesn't cast types, so convert IDs with `new Types.ObjectId(...)` first (see `searchRecipes`).
- Recipes have no `createdAt`. Sort by `_id` for creation order.
- `server.ts` and `dev-data/importData.ts` call `dns.setServers(['8.8.8.8', '1.1.1.1'])`, because Node on this machine resolves DNS through 127.0.0.1, which breaks `mongodb+srv://` lookups.
- `updateMe` uses `user.save({ validateModifiedOnly: true })` so the duplicate username handler runs and the `passwordConfirm` validator doesn't.

## Tests

- `tests/setup.ts` starts an in-memory MongoDB per test file and empties it before each test. `tests/helpers.ts` has `createUser`, `createRecipe`, `saveRecipe` and `as(user).get/post/patch/delete`.
- Tests go through HTTP with Supertest. Each test sets up its own data and follows set up → act → check, with blank lines between the steps.
- Add or update tests alongside behaviour changes, and run `npm test` before finishing.
- Tests never call Claude or the internet. `tests/import.test.ts` mocks `extract` and `fetchPage`, `tests/extract.test.ts` mocks the Anthropic client, and `tests/fetchPage.test.ts` uses a local server.
- Multipart uploads can't go through `as()`, whose `.send()` can't be mixed with `.attach()`. Use Supertest directly, as in `tests/import.test.ts`.
